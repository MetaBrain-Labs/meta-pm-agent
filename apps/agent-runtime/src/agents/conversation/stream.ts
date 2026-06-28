/**
 * Conversation Agent 流式主通道
 *
 * 实现从用户消息到完整响应的 SSE 流式管道，包括：
 * - Conversation Agent 深度对话阶段
 * - 标记块检测与分段（question-form、user-input）
 * - user-input 完成后自动触发产品工作流图
 * - 工作流确认表单的流式转发
 *
 * Responsibilities:
 * - streamConversation()：主入口，接收历史消息和选项，产出 SSE 事件流
 * - streamAgentEvents()：驱动 Conversation Agent 并过滤仅用户授权的工具事件
 * - 在 user-input-complete 后驱动 streamWorkflowGraph
 * - 在工作流完成后格式化并输出最终结果 block
 */

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "langchain";
import type { ChatMessage } from "@repo/shared";
import { calculateCost } from "../../config";
import { createConversationAgent } from "./agent";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
  toLangChainMessages,
} from "../../utils/message-adapter";
import { streamTaggedBlock } from "../../utils/tagged-block-stream";
import { getFormAnswerId, isFormAnswer } from "../../utils/form-parser";
import {
  formatProductWorkflowConfirmationQuestionForm,
  formatProductWorkflowProposalQuestionForm,
} from "../product-workflow/agent";
import {
  isExecutorHumanInputRequiredError,
  type ExecutorHumanInputRequired,
} from "../product-workflow/executor-agent/agent";
import { createWorkflowResumeContextFromMessages } from "./workflow-resume";
import { streamWorkflowGraph } from "../../graph/workflow";
import {
  createHumanInTheLoopThreadId,
  extractQuestionFormId,
  releaseQuestionFormHumanInterrupt,
} from "../../graph/human-in-the-loop";
import type {
  AgentMessageType,
  ConversationStreamEvent,
  ConversationStreamOptions,
} from "../../types";

const PRODUCT_WORKFLOW_CONFIRMATION_FORM_ID = "product-workflow-confirmation";
const EXECUTOR_BLOCKER_FORM_PREFIX = "executor-blocker-";

/**
 * 流式获取 Conversation Agent 的原始消息事件。
 *  注：此处拼接最底层的文本内容，yield { type: "reasoning/text", content: reasoning };
 *        后续如果遇到需要标签块的场景，重新封装并抛出，例如：yield { type: "question-form-start" }
 *        否则可以直接使用 yield chunk 的形式抛出原始内容，而无需再次封装
 */
async function* streamAgentEvents(
  messages: (HumanMessage | AIMessage)[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;

  const agent = createConversationAgent({
    enabledTools: options.enabledTools,
  });
  const run = await agent.stream(
    { messages },
    { streamMode: "messages", signal: options.signal },
  );
  const visibleToolNames = new Set<string>(options.enabledTools ?? []);

  for await (const [message] of run) {
    for (const toolCall of getToolCalls(message).filter((item) =>
      visibleToolNames.has(item.name),
    )) {
      yield {
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        agentType: "conversation",
      };
    }

    const toolResult = getToolResult(message);
    if (toolResult && visibleToolNames.has(toolResult.name)) {
      yield {
        type: "tool-result",
        toolCallId: toolResult.id,
        toolName: toolResult.name,
        toolResult: toolResult.content,
        agentType: "conversation",
      };
      // 工具响应只进入工具卡片，不作为普通助手正文继续输出。
      continue;
    }
    if (toolResult) {
      // DeepAgents 内置工具响应只保留给内部状态，避免污染用户可见流。
      continue;
    }

    const reasoning = getReasoningContent(message);
    if (reasoning) {
      yield {
        type: "reasoning",
        content: reasoning,
        agentType: "conversation",
      };
    }

    const text = getTextContent(message);
    const cleanText = stripInternalNoise(text);
    if (cleanText) {
      yield { type: "text", content: cleanText, agentType: "conversation" };
    }

    // 从每次 AIMessage 中累积 token 用量。
    const usage = getTokenUsage(message);
    if (usage) {
      tokenUsage = usage;
    }
  }

  // 在流结束时输出 Conversation Agent 的 token 用量和耗时。
  if (tokenUsage) {
    const cost = calculateCost(
      tokenUsage.cacheMissInputTokens,
      tokenUsage.cacheHitInputTokens,
      tokenUsage.outputTokens,
    );
    yield {
      type: "token-usage",
      agentType: "conversation",
      inputTokens: tokenUsage.inputTokens,
      cacheHitInputTokens: tokenUsage.cacheHitInputTokens,
      cacheMissInputTokens: tokenUsage.cacheMissInputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      costInput: cost.costInput,
      costOutput: cost.costOutput,
      costTotal: cost.costTotal,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * 处理完整会话流，并在表单答案整合后接入 Request Agent。
 */
export async function* streamConversation(
  messages: ChatMessage[],
  options: ConversationStreamOptions = {},
): AsyncGenerator<ConversationStreamEvent> {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("At least one chat message is required.");
  }

  if (lastMessage.role === "user" && isFormAnswer(lastMessage.content)) {
    const formId = getFormAnswerId(lastMessage.content);
    if (formId && isProductWorkflowResumeFormId(formId)) {
      yield* streamWorkflowResumeAfterFormAnswer(messages, options, formId);
      return;
    }

    yield* streamUserInputIntegration(messages, options);
    return;
  }

  for await (const event of streamTaggedBlock(
    streamAgentEvents(toLangChainMessages(messages), options),
    [
      {
        startMarker: "<question-form",
        endMarker: "</question-form>",
        startEvent: "question-form-start",
        completeEvent: "question-form-complete",
      },
      {
        startMarker: "<user-input",
        endMarker: "</user-input>",
        startEvent: "user-input-start",
        completeEvent: "user-input-complete",
      },
    ],
  )) {
    yield event;

    if (event.type === "question-form-complete") {
      yield* streamHumanInterruptForQuestionForm(
        event.content,
        event.agentType,
        options,
      );
    }

    if (event.type === "user-input-complete") {
      yield* streamPlanningAfterUserInput(event.content, options, messages);
    }
  }
}

async function* streamUserInputIntegration(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  let textBuffer = "";
  let started = false;

  for await (const chunk of streamAgentEvents(
    toLangChainMessages(messages),
    options,
  )) {
    if (
      chunk.type === "tool-call" ||
      chunk.type === "tool-result" ||
      chunk.type === "token-usage"
    ) {
      yield chunk;
      continue;
    }

    if (chunk.type === "reasoning") {
      yield chunk;
      continue;
    }
    if (chunk.type !== "text") {
      continue;
    }

    // 保存非推理内容。
    textBuffer += chunk.content;
    // 第一次收到非推理内容时，触发 user-input-start 事件，表示用户输入的整理开始。
    if (!started) {
      started = true;
      yield { type: "user-input-start" };
    }
  }

  if (started) {
    const userInputBlock = ensureUserInputBlock(textBuffer);
    yield {
      type: "user-input-complete",
      content: userInputBlock,
    };

    yield* streamPlanningAfterUserInput(userInputBlock, options, messages);
  }
}

/**
 * 产品工作流表单答案不再交给 Conversation Agent 重新整理，直接恢复原 DAG 上下文继续执行。
 */
async function* streamWorkflowResumeAfterFormAnswer(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
  formId: string,
): AsyncGenerator<ConversationStreamEvent> {
  const resumeContext = createWorkflowResumeContextFromMessages({
    messages,
    knowledgeGraph: options.knowledgeGraph,
  });

  if (!resumeContext) {
    yield* streamUserInputIntegration(messages, options);
    return;
  }

  const latestUserMessage = messages.at(-1);
  const userInputBlock = createFormAnswerUserInputBlock(
    latestUserMessage?.content ?? "",
  );

  yield* streamPlanningAfterUserInput(userInputBlock, options, messages, {
    resumeContext,
    suppressRestoredRequestAnalysis: true,
    finalizeOnComplete: formId === PRODUCT_WORKFLOW_CONFIRMATION_FORM_ID,
  });
}

/**
 * Conversation Agent 产出 user_input 后，统一进入 LangGraph 规划流程。
 */
async function* streamPlanningAfterUserInput(
  userInputBlock: string,
  options: ConversationStreamOptions,
  messages: ChatMessage[] = [],
  resumeOptions: {
    resumeContext?: ReturnType<typeof createWorkflowResumeContextFromMessages>;
    suppressRestoredRequestAnalysis?: boolean;
    finalizeOnComplete?: boolean;
  } = {},
): AsyncGenerator<ConversationStreamEvent> {
  try {
    const resumeContext =
      resumeOptions.resumeContext ??
      createWorkflowResumeContextFromMessages({
        messages,
        knowledgeGraph: options.knowledgeGraph,
      }) ??
      undefined;

    for await (const event of streamWorkflowGraph({
      workspaceId: options.workspaceId,
      productContext: options.productContext,
      knowledgeGraph: options.knowledgeGraph,
      userInputBlock,
      resumeContext,
      signal: options.signal,
    })) {
      if (
        resumeOptions.suppressRestoredRequestAnalysis &&
        event.type === "request-analysis-complete"
      ) {
        continue;
      }

      if (
        event.type === "agent-status" ||
        event.type === "reasoning" ||
        event.type === "request-analysis-start" ||
        event.type === "request-analysis-complete" ||
        event.type === "tool-call" ||
        event.type === "tool-result" ||
        event.type === "token-usage" ||
        event.type === "knowledge-graph-update"
      ) {
        yield event;
        continue;
      }

      if (event.type === "agent-output") {
        yield {
          type: "text",
          content: event.content,
          agentType: event.agentType,
        };
        continue;
      }

      if (event.type === "complete") {
        // 将结构化工作流结果转发给 API 持久化层，供知识图谱归档
        yield { type: "complete", result: event.result };

        if (resumeOptions.finalizeOnComplete) {
          yield {
            type: "text",
            content:
              "本轮产品工作流已正式结束，相关 Executor Agent 的知识图谱修正/补充已完成并归档。",
            agentType: "conversation_confirmation",
          };
          continue;
        }

        const proposalForm = formatProductWorkflowProposalQuestionForm(
          event.result,
        );
        const questionForm =
          proposalForm ??
          formatProductWorkflowConfirmationQuestionForm(event.result);

        // Planner 只发起确认/补充请求，由 Conversation Agent 面向用户提问。
        yield {
          type: "text",
          content: proposalForm
            ? "Planner Agent 汇总了需要补充确认的信息，我需要你先回答这些问题。"
            : "Planner Agent 已完成本轮汇总，我需要你确认下一步处理方式。",
          agentType: "conversation_confirmation",
        };
        yield {
          type: "question-form-start",
          agentType: "conversation_confirmation",
        };
        yield {
          type: "question-form-complete",
          content: questionForm,
          agentType: "conversation_confirmation",
        };
        yield* streamHumanInterruptForQuestionForm(
          questionForm,
          "conversation_confirmation",
          options,
        );
      }
    }
  } catch (error) {
    if (isExecutorHumanInputRequiredError(error)) {
      const questionForm = formatExecutorHumanInputQuestionForm(
        error.interrupt,
      );
      yield {
        type: "text",
        content:
          "Planner Agent 暂停了当前 Executor 批次，需要先由你补充阻塞信息后再继续运行。",
        agentType: "conversation_confirmation",
      };
      yield {
        type: "question-form-start",
        agentType: "conversation_confirmation",
      };
      yield {
        type: "question-form-complete",
        content: questionForm,
        agentType: "conversation_confirmation",
      };
      yield* streamHumanInterruptForQuestionForm(
        questionForm,
        "conversation_confirmation",
        options,
      );
      return;
    }
    yield {
      type: "error",
      error: getErrorMessage(error),
      agentType: "request",
    };
  }
}

/**
 * 将 Question Form 转换为 LangGraph Human-in-the-Loop interrupt 事件。
 */
async function* streamHumanInterruptForQuestionForm(
  questionForm: string,
  agentType: AgentMessageType | undefined,
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  const formId = extractQuestionFormId(questionForm);
  const interrupt = await releaseQuestionFormHumanInterrupt({
    threadId: createHumanInTheLoopThreadId({
      scopeId: options.requestFormId ?? options.workspaceId,
      formId,
    }),
    questionForm,
    agentType,
  });

  if (!interrupt) return;

  yield {
    type: "human-interrupt",
    interrupt,
    agentType,
  };
}

/**
 * 格式化为 <user-input> 块，如果已经是该块则直接返回。
 */
/**
 * 将 Executor 硬阻塞转换为 Conversation Agent 对用户展示的 HITL 表单。
 */
function formatExecutorHumanInputQuestionForm(
  interrupt: ExecutorHumanInputRequired,
): string {
  const form = {
    description: [
      `来源：${interrupt.displayName} / ${interrupt.taskId}`,
      `原因：${interrupt.title}`,
      `关键详情：${compactUserVisibleText(interrupt.details)}`,
    ].join("\n"),
    questions: [
      {
        id: "resolution",
        label: interrupt.neededUserInput,
        type: "textarea",
        required: true,
        placeholder: "请补充事实、取舍或修正信息，提交后系统会基于已有上下文继续运行。",
      },
    ],
    submitLabel: "提交并继续运行",
  };

  return `<question-form id="${escapeAttribute(
    `executor-blocker-${interrupt.taskId}`,
  )}" title="${escapeAttribute(interrupt.title)}">\n${JSON.stringify(
    form,
    null,
    2,
  )}\n</question-form>`;
}

/**
 * 压缩展示给用户的阻塞详情，只保留关键一行。
 */
function compactUserVisibleText(text: string, maxLength = 180): string {
  const compacted = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/\s+/g, " ") ?? "";
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength).trimEnd()}...`
    : compacted;
}

/**
 * 格式化为 <user-input> 块，如果已经是该块则直接返回。
 */
function ensureUserInputBlock(content: string): string {
  const trimmed = content.trim();
  if (/^<user-input\b/i.test(trimmed)) {
    return trimmed;
  }

  return `<user-input>\n${trimmed}\n</user-input>`;
}

/**
 * 剪切内部噪声
 */
function stripInternalNoise(content: string): string {
  return content
    .replace(/(^|\n)No files found in\s+\/\s*/g, "$1")
    .replace(/(^|\n)No files found in\s+\.\s*/g, "$1");
}

/**
 * 将 Request Agent 等下游异常转成用户可理解的错误文本。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 从模型消息中提取已完成的工具调用。
 */
/**
 * 转义 tagged block 属性值，避免标题或 ID 破坏 question-form 标签。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * 从模型消息中提取已完成的工具调用。
 */
function getToolCalls(
  message: BaseMessage,
): Array<{ id?: string; name: string; args?: Record<string, unknown> }> {
  if (!AIMessage.isInstance(message)) return [];

  return (message.tool_calls ?? [])
    .filter((toolCall) => toolCall.name)
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      args:
        typeof toolCall.args === "object" && toolCall.args !== null
          ? (toolCall.args as Record<string, unknown>)
          : undefined,
    }));
}

/**
 * 从工具响应消息中提取前端可展示的结果摘要。
 */
function getToolResult(
  message: BaseMessage,
): { id?: string; name: string; content: unknown } | null {
  if (!ToolMessage.isInstance(message)) return null;

  return {
    id: (message as { tool_call_id?: string }).tool_call_id,
    name: message.name ?? "unknown",
    content: message.content,
  };
}

/**
 * 判断表单答案是否属于产品工作流恢复路径，而不是普通 Conversation 问答表单。
 */
function isProductWorkflowResumeFormId(formId: string): boolean {
  return (
    formId === PRODUCT_WORKFLOW_CONFIRMATION_FORM_ID ||
    formId.endsWith("-proposal-decision") ||
    formId.startsWith(EXECUTOR_BLOCKER_FORM_PREFIX)
  );
}

/**
 * 将原始表单答案包装成合法 user_input，供恢复后的 Executor Agent 读取用户补充信息。
 */
function createFormAnswerUserInputBlock(content: string): string {
  return `<user-input>\n${JSON.stringify(
    {
      user_input: [
        {
          index: 1,
          content: content.trim(),
          type: "表单答复",
        },
      ],
    },
    null,
    2,
  )}\n</user-input>`;
}
