/**
 * 聊天模型工厂
 *
 * 所有 Agent 共享的 ChatOpenAI 实例创建入口，统一读取 LLM 配置
 * 并支持单个 Agent 按需覆盖 temperature、maxTokens、responseFormat 等参数。
 *
 * Responsibilities:
 * - createChatModel()：从 getLlmConfig 读取全局配置，允许 Agent 级覆盖
 * - 管理 thinking（推理模式）和 response_format（JSON 输出）的 modelKwargs
 * - 定义 ChatModelOptions 接口供各 Agent 传递自定义参数
 */

import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
  ToolMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type {
  ChatGenerationChunk,
  ChatResult,
} from "@langchain/core/outputs";
import { getLlmConfig } from "../../config";

// 在模型实例创建前，全局注册 HarnessProfile 排除 DeepAgents 文件系统工具。
import "./harness-profile";

/**
 * 单个 Agent 覆盖默认模型参数的配置。
 */
export interface ChatModelOptions {
  enableThinking?: boolean;
  maxTokens?: number;
  responseFormat?: "json_object";
  temperature?: number;
  /** 单次 LLM HTTP 请求超时（毫秒），覆盖全局默认 30s。 */
  timeout?: number;
}

/**
 * 将 OpenAI 兼容接口的 reasoning_content 提升为 v3 流协议可识别的内容块。
 *
 * LangChain 的兼容转换器只处理 message.content，DeepSeek 放在
 * additional_kwargs.reasoning_content 的推理片段否则会在 streamEvents v3 中丢失。
 */
export function promoteReasoningContent(message: BaseMessage): void {
  if (typeof message.content !== "string") return;

  const reasoning = message.additional_kwargs?.reasoning_content;
  if (typeof reasoning !== "string" || !reasoning) return;

  message.content = [
    {
      type: "reasoning",
      reasoning,
      // reasoning 与文本、tool_call 使用独立 block，避免增量合并串位。
      index: 1,
    },
    ...(message.content
      ? [{ type: "text", text: message.content, index: 0 }]
      : []),
  ];
}

/**
 * 清理发回模型供应商的历史 AI 消息中的 reasoning content block。
 *
 * Event Streaming v3 需要 reasoning block 才能生成思考事件，但 OpenAI 兼容
 * Chat Completions 接口不接受历史消息中的该 block。这里复制消息并仅清理
 * provider 输入，图状态和事件流中的真实思考内容保持不变。
 */
export function prepareMessagesForProvider(
  messages: BaseMessage[],
): BaseMessage[] {
  return messages.map((message) => {
    if (
      typeof message.content === "string" ||
      !message.content.some(
        (block) => block.type === "reasoning" || block.type === "thinking",
      )
    ) {
      return message;
    }

    // tool_call 已由 AIMessage.tool_calls 单独传输，不能重复进入 provider content。
    const content = message.content.filter(
      (block) =>
        block.type !== "reasoning" &&
        block.type !== "thinking" &&
        block.type !== "tool_call",
    );
    const providerContent = content.every((block) => block.type === "text")
      ? content.map((block) => block.text).join("")
      : content;
    const responseMetadata = {
      ...(message.response_metadata as Record<string, unknown>),
    };
    delete responseMetadata.output_version;
    const baseFields = {
      id: message.id,
      name: message.name,
      content: providerContent,
      additional_kwargs: message.additional_kwargs,
      // provider 副本回到 legacy completions 转换，避免 v1 再解释已清洗的 block。
      response_metadata: responseMetadata,
    };

    if (AIMessageChunk.isInstance(message)) {
      return new AIMessageChunk({
        ...baseFields,
        tool_calls: message.tool_calls,
        invalid_tool_calls: message.invalid_tool_calls,
        tool_call_chunks: message.tool_call_chunks,
        usage_metadata: message.usage_metadata,
      });
    }
    if (AIMessage.isInstance(message)) {
      return new AIMessage({
        ...baseFields,
        tool_calls: message.tool_calls,
        invalid_tool_calls: message.invalid_tool_calls,
        usage_metadata: message.usage_metadata,
      });
    }
    if (message instanceof ToolMessageChunk) {
      return new ToolMessageChunk({
        ...baseFields,
        tool_call_id: message.tool_call_id,
        artifact: message.artifact,
        status: message.status,
      });
    }
    if (ToolMessage.isInstance(message)) {
      return new ToolMessage({
        ...baseFields,
        tool_call_id: message.tool_call_id,
        artifact: message.artifact,
        metadata: message.metadata,
        status: message.status,
      });
    }
    return message;
  });
}

type ProviderCompletionRequest = {
  messages?: Array<{
    reasoning_content?: string;
    role?: string;
    tool_calls?: Array<{ id?: string }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

/**
 * 将工具调用消息的推理内容恢复到兼容供应商要求的顶层字段。
 */
export function restoreProviderReasoningContent<Request>(
  request: Request,
  history: BaseMessage[],
): Request {
  const providerRequest = request as ProviderCompletionRequest;
  if (!Array.isArray(providerRequest.messages)) return request;

  const reasoningByToolCallId = new Map<string, string>();
  for (const message of history) {
    if (!AIMessage.isInstance(message) || !message.tool_calls?.length) continue;
    const additionalReasoning =
      message.additional_kwargs?.reasoning_content;
    const blockReasoning =
      typeof message.content === "string"
        ? ""
        : message.content
            .map((block) =>
              block.type === "reasoning"
                ? block.reasoning
                : block.type === "thinking"
                  ? block.thinking
                  : "",
            )
            .join("");
    const reasoning =
      typeof additionalReasoning === "string"
        ? additionalReasoning
        : blockReasoning;
    if (!reasoning) continue;

    for (const toolCall of message.tool_calls) {
      if (toolCall.id) reasoningByToolCallId.set(toolCall.id, reasoning);
    }
  }
  if (reasoningByToolCallId.size === 0) return request;

  return {
    ...providerRequest,
    messages: providerRequest.messages.map((message) => {
      if (
        message.role !== "assistant" ||
        message.reasoning_content ||
        !message.tool_calls?.length
      ) {
        return message;
      }
      const reasoning = message.tool_calls
        .map((toolCall) =>
          toolCall.id ? reasoningByToolCallId.get(toolCall.id) : undefined,
        )
        .find((content) => content);
      return reasoning ? { ...message, reasoning_content: reasoning } : message;
    }),
  } as Request;
}

/**
 * 为 OpenAI 兼容模型补齐 reasoning_content 到 v3 content-block 的转换。
 */
class ReasoningCompatibleChatOpenAI extends ChatOpenAI {
  private providerHistory: BaseMessage[] = [];

  constructor(fields: ChatOpenAIFields = {}) {
    super(fields);
    const completionWithRetry =
      this.completions.completionWithRetry.bind(this.completions);
    const callProvider = completionWithRetry as unknown as (
      request: unknown,
      requestOptions?: unknown,
    ) => Promise<unknown>;
    this.completions.completionWithRetry = ((
      request: unknown,
      requestOptions?: unknown,
    ) =>
      callProvider(
        restoreProviderReasoningContent(request, this.providerHistory),
        requestOptions,
      )) as typeof this.completions.completionWithRetry;
  }

  override withConfig(
    config: Parameters<ChatOpenAI["withConfig"]>[0],
  ): ReasoningCompatibleChatOpenAI {
    const model = new ReasoningCompatibleChatOpenAI(this.fields ?? {});
    model.defaultOptions = {
      ...this.defaultOptions,
      ...config,
    };
    return model;
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    this.providerHistory = messages;
    try {
      for await (const chunk of super._streamResponseChunks(
        prepareMessagesForProvider(messages),
        options,
        runManager,
      )) {
        promoteReasoningContent(chunk.message);
        yield chunk;
      }
    } finally {
      this.providerHistory = [];
    }
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.providerHistory = messages;
    try {
      return await super._generate(
        prepareMessagesForProvider(messages),
        options,
        runManager,
      );
    } finally {
      this.providerHistory = [];
    }
  }
}

/**
 * 创建所有 Agent 共用的聊天模型实例，统一读取 LLM 配置，并允许特定 Agent 覆盖结构化输出参数。
 */
export function createChatModel(options: ChatModelOptions = {}) {
  const config = getLlmConfig();
  const modelKwargs: Record<string, unknown> = {};
  const enableThinking = options.enableThinking ?? config.enableThinking;

  if (enableThinking) {
    modelKwargs.thinking = { type: "enabled" };
    modelKwargs.reasoning_effort = config.reasoningEffort;
  }
  if (options.responseFormat) {
    modelKwargs.response_format = { type: options.responseFormat };
  }

  return new ReasoningCompatibleChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    temperature: options.temperature ?? config.temperature,
    maxTokens: options.maxTokens ?? config.maxTokens,
    timeout: options.timeout ?? config.timeout,
    configuration: { baseURL: config.baseURL },
    modelKwargs: Object.keys(modelKwargs).length > 0 ? modelKwargs : undefined,
  });
}
