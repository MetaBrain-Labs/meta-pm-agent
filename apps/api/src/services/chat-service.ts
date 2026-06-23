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
import { persistTokenUsage } from "../repositories/token-usage-repository";
import { parseRequestAnalysisPayload } from "../utils/request-analysis";
import { parseTaskExecutionPlanPayload } from "../utils/task-execution";
import {
  formatExecutorResultPayload,
  formatProductWorkflowPayload,
  parseExecutorResultPayload,
  parseProductWorkflowPayload,
  sanitizeExecutorResultForPersistence,
  sanitizeProductWorkflowForPersistence,
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
    agentType?: string;
  }>;
  /** 该 Agent 本次模型调用的 token 用量 */
  tokenUsage?: {
    inputTokens: number;
    cacheHitInputTokens: number;
    cacheMissInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costInput: number;
    costOutput: number;
    costTotal: number;
  };
  /** 该 Agent 本次执行的耗时（毫秒） */
  durationMs?: number;
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
  const productWorkflow =
    parseProductWorkflowPayload(plannerOutput?.content ?? "") ??
    parseProductWorkflowPayload(
      agentOutputs.find((output) => output.type === "product_director")
        ?.content ?? "",
    );
  const sanitizedExecutorResults = executorResults.map(
    sanitizeExecutorResultForPersistence,
  );
  const sanitizedProductWorkflow = productWorkflow
    ? sanitizeProductWorkflowForPersistence(productWorkflow)
    : null;

  // 每个 Agent 单独落库，message.type 用于前端恢复正确的展示位置。
  const messageIds = new Map<string, string>();

  for (const output of agentOutputs) {
    if (
      output.content.trim().length === 0 &&
      !output.reasoningContent?.trim()
    ) {
      continue;
    }
    const outputContent = sanitizeAgentOutputContent(
      output,
      sanitizedProductWorkflow,
    );

    const messageId = await persistAssistantMessage({
      conversationId,
      content: outputContent,
      userInput: output.type === "conversation" ? items : null,
      reasoningContent: output.reasoningContent,
      toolCalls: output.toolCalls,
      type: output.type,
    });
    messageIds.set(output.type, messageId);
  }

  // 持久化各 Agent 的 token 用量记录。
  const tokenUsageRecords = agentOutputs
    .filter(
      (output) =>
        output.tokenUsage && output.tokenUsage.totalTokens > 0,
    )
    .map((output) => ({
      conversationId,
      messageId: messageIds.get(output.type) ?? undefined,
      agentType: output.type,
      inputTokens: output.tokenUsage!.inputTokens,
      cacheHitInputTokens: output.tokenUsage!.cacheHitInputTokens,
      cacheMissInputTokens: output.tokenUsage!.cacheMissInputTokens,
      outputTokens: output.tokenUsage!.outputTokens,
      totalTokens: output.tokenUsage!.totalTokens,
      costInput: output.tokenUsage!.costInput,
      costOutput: output.tokenUsage!.costOutput,
      costTotal: output.tokenUsage!.costTotal,
      durationMs: output.durationMs ?? 0,
    }));

  await persistTokenUsage(tokenUsageRecords);

  await persistRequestAnalysisItems(requestFormId, requestAnalysis);
  await persistTaskExecutionPlan({
    conversationId,
    requestFormId,
    plan: taskExecutionPlan,
  });
  await persistExecutorProposalItems(requestFormId, sanitizedExecutorResults);
  await persistProposalDecisionItem(requestFormId, sanitizedProductWorkflow);
  await persistProductWorkflowConfirmationDecision(
    requestFormId,
    sanitizedProductWorkflow,
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
 * 生成可落库的 Agent 输出正文，避免把知识图谱正文写入 message 表。
 */
function sanitizeAgentOutputContent(
  output: AgentConversationOutput,
  productWorkflow: ReturnType<typeof sanitizeProductWorkflowForPersistence> | null,
): string {
  const executorResult = parseExecutorResultPayload(output.content);
  if (executorResult) {
    return formatExecutorResultPayload(
      sanitizeExecutorResultForPersistence(executorResult),
    );
  }

  if (productWorkflow) {
    return replaceProductWorkflowPayload(output.content, productWorkflow);
  }

  return output.content;
}

/**
 * 将消息中的产品工作流结构块替换为已清洗的持久化版本。
 */
function replaceProductWorkflowPayload(
  content: string,
  productWorkflow: ReturnType<typeof sanitizeProductWorkflowForPersistence>,
): string {
  const startMarker = "<product-workflow";
  const endMarker = "</product-workflow>";
  const startIndex = content.search(new RegExp(escapeRegExp(startMarker), "i"));
  if (startIndex === -1) return content;

  const openEnd = content.indexOf(">", startIndex);
  const endIndex = content.indexOf(endMarker, openEnd + 1);
  if (openEnd === -1 || endIndex === -1) return content;

  const blockEnd = endIndex + endMarker.length;
  return `${content.slice(0, startIndex)}${formatProductWorkflowPayload(
    productWorkflow,
  )}${content.slice(blockEnd)}`;
}

/**
 * 转义正则特殊字符，保证 tagged block marker 按字面量匹配。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
