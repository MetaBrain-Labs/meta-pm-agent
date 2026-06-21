import type { ChatMessage } from "@repo/shared";
import {
  createConversationWithInitialRequestForm,
  listActiveConversations,
  updateFirstTurnConversationTitle,
} from "../repositories/chat-repository";
import {
  listConversationMessages,
  persistAssistantMessage,
  persistConversationMessages,
} from "../repositories/message-repository";
import {
  finishAnsweredDecisionItems,
  getPendingDecisionQuestionForm,
  persistExecutorProposalItems,
  persistProposalDecisionItem,
  persistProductWorkflowConfirmationDecision,
  persistRequestAnalysisItems,
  updateRequestFormStatus,
} from "../repositories/request-form-repository";
import { persistTaskExecutionPlan } from "../repositories/task-execution-repository";
import { parseRequestAnalysisPayload } from "../utils/request-analysis";
import { parseTaskExecutionPlanPayload } from "../utils/task-execution";
import {
  parseExecutorResultPayload,
  parseProductWorkflowPayload,
} from "../utils/product-workflow";
import {
  parseUserInputPayload,
  type UserInputRecord,
} from "../utils/user-input";

const DEFAULT_CHAT_TITLE = "New Chat";
const MAX_GENERATED_TITLE_LENGTH = 36;

/**
 * 单个 Agent 在一轮对话中的输出，用于分 Agent 持久化消息和推理过程。
 */
export interface AgentConversationOutput {
  type: string;
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
  }>;
}

/**
 * 会话标题更新结果，供 SSE 通知前端同步侧边栏列表。
 */
export interface ConversationTitleUpdate {
  id: string;
  title: string;
}

/**
 * 获取指定工作区内的活跃会话列表。
 */
export function listChats(workspaceId: string) {
  return listActiveConversations(workspaceId);
}

/**
 * 获取指定会话的所有历史消息。
 */
export function listMessages(conversationId: string) {
  return listConversationMessages(conversationId);
}

/**
 * 获取请求表单中下一组待 Conversation Agent 提问的决策表单。
 */
export function loadPendingDecisionQuestionForm(requestFormId?: string) {
  return getPendingDecisionQuestionForm(requestFormId);
}

/**
 * 标记请求表单的当前处理阶段。
 */
export function markRequestFormStatus(
  requestFormId: string | undefined,
  status: string,
) {
  return updateRequestFormStatus(requestFormId, status);
}

/**
 * 在指定工作区中创建新会话，同时初始化一条请求表单记录。
 */
export async function createChat(
  workspaceId: string,
  title = DEFAULT_CHAT_TITLE,
) {
  const { conversation, requestForm } =
    await createConversationWithInitialRequestForm(workspaceId, title);

  return {
    chat: conversation,
    requestForm,
  };
}

/**
 * 在 Agent 开始处理前，持久化用户发送的消息列表。
 */
export async function persistConversationStart(
  conversationId: string | undefined,
  requestFormId: string | undefined,
  messages: ChatMessage[],
): Promise<void> {
  if (!conversationId) return;

  await finishAnsweredDecisionItems(requestFormId, messages);

  // 只持久化用户消息，助手回复由 persistConversationResult 统一写入。
  await persistConversationMessages(
    conversationId,
    messages.filter((message) => message.role === "user"),
  );
}

/**
 * 在 Agent 完成一轮处理后，按 Agent 类型分别持久化回复、推理和结构化结果。
 */
export async function persistConversationResult({
  conversationId,
  requestFormId,
  agentOutputs,
  messages,
}: {
  conversationId?: string;
  requestFormId?: string;
  agentOutputs: AgentConversationOutput[];
  messages: ChatMessage[];
}): Promise<ConversationTitleUpdate | null> {
  if (!conversationId || agentOutputs.length === 0) return null;

  const conversationOutput = agentOutputs.find(
    (output) => output.type === "conversation",
  );
  const requestOutput = agentOutputs.find((output) => output.type === "request");
  const plannerOutput = agentOutputs.find((output) => output.type === "planner");
  const productDirectorOutput = agentOutputs.find(
    (output) => output.type === "product_director",
  );
  const items = conversationOutput
    ? parseUserInputPayload(conversationOutput.content)
    : null;
  const requestAnalysis = requestOutput
    ? parseRequestAnalysisPayload(requestOutput.content)
    : null;
  const taskExecutionPlan = plannerOutput
    ? parseTaskExecutionPlanPayload(plannerOutput.content)
    : null;
  const executorResults = agentOutputs
    .map((output) => parseExecutorResultPayload(output.content))
    .filter((result) => result !== null);
  const productWorkflow = productDirectorOutput
    ? parseProductWorkflowPayload(productDirectorOutput.content)
    : null;

  // 每个 Agent 单独落库，message.type 用于前端恢复正确的展示位置。
  for (const output of agentOutputs) {
    if (
      output.content.trim().length === 0 &&
      !output.reasoningContent?.trim()
    ) {
      continue;
    }

    await persistAssistantMessage({
      conversationId,
      content: output.content,
      userInput: output.type === "conversation" ? items : null,
      reasoningContent: output.reasoningContent,
      toolCalls: output.toolCalls,
      type: output.type,
    });
  }

  await persistRequestAnalysisItems(requestFormId, requestAnalysis);
  await persistTaskExecutionPlan({
    conversationId,
    requestFormId,
    plan: taskExecutionPlan,
  });
  await persistExecutorProposalItems(requestFormId, executorResults);
  await persistProposalDecisionItem(requestFormId, productWorkflow);
  await persistProductWorkflowConfirmationDecision(
    requestFormId,
    productWorkflow,
  );

  const generatedTitle = buildFirstTurnConversationTitle(items, messages);
  if (!generatedTitle) return null;

  const updatedConversation = await updateFirstTurnConversationTitle(
    conversationId,
    generatedTitle,
  );

  return updatedConversation
    ? { id: updatedConversation.id, title: updatedConversation.title }
    : null;
}

/**
 * 根据 Conversation Agent 整理出的用户意图生成短标题；缺少结构化结果时用首条用户消息兜底。
 */
export function buildFirstTurnConversationTitle(
  userInput: UserInputRecord[] | null,
  messages: ChatMessage[],
): string | null {
  const userMessages = messages.filter((message) => message.role === "user");
  if (userMessages.length !== 1) return null;

  const intentText =
    userInput?.find((item) => item.type === "请求")?.content ??
    userInput?.[0]?.content ??
    userMessages[0]?.content;

  return intentText ? normalizeConversationTitle(intentText) : null;
}

/**
 * 将用户意图压缩成适合侧边栏展示的标题，避免表单前缀、换行和过长文本撑开列表。
 */
function normalizeConversationTitle(text: string): string | null {
  const cleaned = text
    .replace(/^\[form answers[^\]]*\]\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’。！？!?.,，、：:；;]+$/g, "");

  if (!cleaned) return null;
  if (cleaned.length <= MAX_GENERATED_TITLE_LENGTH) return cleaned;

  return `${cleaned.slice(0, MAX_GENERATED_TITLE_LENGTH - 3).trim()}...`;
}
