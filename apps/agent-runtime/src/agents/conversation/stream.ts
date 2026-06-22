import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "langchain";
import type { ChatMessage } from "@repo/shared";
import { createConversationAgent } from "./agent";
import {
  getReasoningContent,
  getTextContent,
  toLangChainMessages,
} from "../../utils/message-adapter";
import { streamTaggedBlock } from "../../utils/tagged-block-stream";
import { isFormAnswer } from "../../utils/form-parser";
import {
  formatProductWorkflowConfirmationQuestionForm,
  formatProductWorkflowProposalQuestionForm,
} from "../product-workflow/agent";
import { streamWorkflowGraph } from "../../graph/workflow";
import type {
  ConversationStreamEvent,
  ConversationStreamOptions,
} from "../../types";

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
  const agent = createConversationAgent({
    enabledTools: options.enabledTools,
  });
  const run = await agent.stream(
    { messages },
    { streamMode: "messages", signal: options.signal },
  );

  for await (const [message] of run) {
    for (const toolCall of getToolCalls(message)) {
      yield {
        type: "tool-call",
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        agentType: "conversation",
      };
    }

    const toolResult = getToolResult(message);
    if (toolResult) {
      yield {
        type: "tool-result",
        toolName: toolResult.name,
        toolResult: toolResult.content,
        agentType: "conversation",
      };
      // 工具响应只进入工具卡片，不作为普通助手正文继续输出。
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

    if (event.type === "user-input-complete") {
      yield* streamPlanningAfterUserInput(event.content, options);
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
    if (chunk.type === "tool-call" || chunk.type === "tool-result") {
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

    yield* streamPlanningAfterUserInput(userInputBlock, options);
  }
}

/**
 * Conversation Agent 产出 user_input 后，统一进入 LangGraph 规划流程。
 */
async function* streamPlanningAfterUserInput(
  userInputBlock: string,
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  try {
    for await (const event of streamWorkflowGraph({
      productContext: options.productContext,
      userInputBlock,
      signal: options.signal,
    })) {
      if (
        event.type === "reasoning" ||
        event.type === "request-analysis-start" ||
        event.type === "request-analysis-complete" ||
        event.type === "tool-call" ||
        event.type === "tool-result"
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
        const proposalForm = formatProductWorkflowProposalQuestionForm(
          event.result,
        );
        const questionForm =
          proposalForm ??
          formatProductWorkflowConfirmationQuestionForm(event.result);

        // ProductDirector 只发起确认/补充请求，由 Conversation Agent 面向用户提问。
        yield {
          type: "text",
          content: proposalForm
            ? "ProductDirector Agent 汇总了需要补充确认的信息，我需要你先回答这些问题。"
            : "ProductDirector Agent 已完成本轮验收，我需要你确认下一步处理方式。",
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
      }
    }
  } catch (error) {
    yield {
      type: "error",
      error: getErrorMessage(error),
      agentType: "request",
    };
  }
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
function getToolCalls(
  message: BaseMessage,
): Array<{ name: string; args?: Record<string, unknown> }> {
  if (!AIMessage.isInstance(message)) return [];

  return (message.tool_calls ?? [])
    .filter((toolCall) => toolCall.name)
    .map((toolCall) => ({
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
): { name: string; content: unknown } | null {
  if (!ToolMessage.isInstance(message)) return null;

  return {
    name: message.name ?? "unknown",
    content: message.content,
  };
}
