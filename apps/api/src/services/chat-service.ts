/**
 * 聊天业务服务
 *
 * 负责会话列表、消息持久化、请求表单状态推进以及 Agent 输出结果落库。
 * 流式运行期间的 token 用量会即时写入，最终 assistant message 创建后再补充关联。
 *
 * Responsibilities:
 * - 持久化用户消息和各 Agent assistant 消息
 * - 解析并保存 Request Agent、Planner 和 Executor 的结构化产物
 * - 记录并关联每个 Agent 执行结束时产生的 token 用量
 *
 * Notes:
 * - 本文件不直接编排 LangGraph 节点，只处理 API 层业务持久化。
 */

import type {
  ChatMessage,
  ExecutorAgentResult,
  ProductWorkflowResult,
  WorkflowRetryAction,
} from "@repo/shared";
import {
  createRecoveredRequestAnalysis,
  isProductWorkflowCorrectionRetryAnswer,
  isProductWorkflowOptionalStopAnswer,
  isProductWorkflowStopWithIssuesAnswer,
  normalizeDocumentEvidenceWorkflowResult,
  type WorkflowAnswerResolution,
  type WorkflowPurpose,
  type WorkflowRecoveryContext,
} from "@repo/agent-runtime";
import {
  createConversationWithInitialRequestForm,
  listActiveConversations,
  updateFirstTurnConversationTitle,
} from "../repositories/chat-repository";
import {
  findLatestExecutorRetryError,
  findLatestProductWorkflowForForm,
  listConversationMessages,
  persistAssistantMessage,
  persistConversationMessages,
  type MessageDto,
  type SubagentTraceDto,
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
import {
  attachTokenUsageRecordsToMessage,
  persistTokenUsageRecord,
  type TokenUsageRecord,
} from "../repositories/token-usage-repository";
import { parseRequestAnalysisPayload } from "../utils/request-analysis";
import { parseTaskExecutionPlanPayload } from "../utils/task-execution";
import {
  createProductWorkflowDisplaySnapshot,
  formatExecutorResultPayload,
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
  workflowRoundId?: string;
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    id?: string;
    name: string;
    args?: Record<string, unknown>;
    result?: unknown;
    agentType?: string;
    status?: "running" | "complete";
  }>;
  subagentTraces?: SubagentTraceDto[];
  agentError?: {
    agentType?: string;
    message: string;
    retryAction?: WorkflowRetryAction;
  };
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
  /** 实时写入 token_usage 后返回的记录 ID，用于最终补充 message_id。 */
  tokenUsageRecordIds?: string[];
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
 * 在 Agent 结束时立即记录 token 用量，返回 token_usage 主键供后续关联消息。
 */
export async function persistAgentTokenUsage(
  record: TokenUsageRecord | null,
): Promise<string | null> {
  if (!record || record.totalTokens <= 0) return null;

  return persistTokenUsageRecord(record);
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
  workflowPurpose: WorkflowPurpose = "standard",
): Promise<WorkflowAnswerResolution | null> {
  if (!conversationId) return null;

  const workflowAnswerResolution = await finishAnsweredDecisionItems(
    requestFormId,
    messages,
  );
  const persistedWorkflow =
    workflowAnswerResolution && !workflowAnswerResolution.workflow
      ? await findLatestProductWorkflowForForm(
          conversationId,
          workflowAnswerResolution.formId,
        )
      : null;
  const recoveredWorkflow =
    workflowAnswerResolution?.workflow ?? persistedWorkflow;
  const authoritativeWorkflow =
    recoveredWorkflow && workflowPurpose === "document_evidence_resolution"
      ? normalizeDocumentEvidenceWorkflowResult(recoveredWorkflow)
      : recoveredWorkflow;
  const serverRecoveryContext =
    workflowAnswerResolution && authoritativeWorkflow
      ? createServerWorkflowRecoveryContext({
          messages: await listConversationMessages(conversationId),
          workflow: authoritativeWorkflow,
          resolution: workflowAnswerResolution,
          workflowPurpose,
        })
      : null;
  const resolvedWorkflowAnswer = workflowAnswerResolution
    ? {
        ...workflowAnswerResolution,
        ...(authoritativeWorkflow ? { workflow: authoritativeWorkflow } : {}),
        ...(serverRecoveryContext
          ? { serverRecoveryContext }
          : {}),
      }
    : null;

  // 只持久化用户消息，助手回复由 persistConversationResult 统一写入。
  await persistConversationMessages(
    conversationId,
    messages.filter(
      (message) =>
        message.role === "user" &&
        !isProductWorkflowCorrectionRetryAnswer(message.content) &&
        !isProductWorkflowOptionalStopAnswer(message.content) &&
        !isProductWorkflowStopWithIssuesAnswer(message.content),
    ),
  );

  return resolvedWorkflowAnswer;
}

/**
 * 将历史上误标 completed 的 Document 补证结果恢复为 Critique 修正决策。
 *
 * 只复用已持久化的 Critique 快照，不重新运行 Request Agent、Resolver 或 Executor。
 */
export async function recoverDocumentEvidenceCorrectionDecision({
  conversationId,
  requestFormId,
}: {
  conversationId: string | undefined;
  requestFormId: string | undefined;
}): Promise<ProductWorkflowResult | null> {
  if (!conversationId || !requestFormId) return null;
  const messages = await listConversationMessages(conversationId);
  const latestWorkflow = messages
    .map((message) => message.productWorkflow)
    .filter((workflow) => workflow !== null && workflow !== undefined)
    .at(-1);
  if (!latestWorkflow) {
    const claimedTerminalCompletion = messages.some(
      (message) =>
        message.type === "conversation_confirmation" &&
        message.content.includes("本轮产品工作流已正式结束"),
    );
    if (claimedTerminalCompletion) {
      throw new Error(
        "Document evidence resolution cannot recover its persisted Critique result. The historical answer will not be replayed as a new product request.",
      );
    }
    return null;
  }

  const normalized = normalizeDocumentEvidenceWorkflowResult(latestWorkflow);
  if (normalized.status !== "requires_executor_retry") return null;
  await persistProposalDecisionItem(requestFormId, normalized);
  await updateRequestFormStatus(requestFormId, "pending_user_confirmation");
  return normalized;
}

/**
 * 从服务端消息快照组装表单恢复所需的最小权威上下文。
 *
 * 图谱正文不进入该对象；运行时仍从工作区图谱存储读取最新版本。
 */
export function createServerWorkflowRecoveryContext({
  messages,
  workflow,
  resolution,
  workflowPurpose = "standard",
}: {
  messages: MessageDto[];
  workflow: ProductWorkflowResult;
  resolution: WorkflowAnswerResolution;
  workflowPurpose?: WorkflowPurpose;
}): WorkflowRecoveryContext {
  const requestAnalysis =
    messages
      .map((message) => message.requestAnalysis)
      .filter((analysis) => analysis !== null && analysis !== undefined)
      .at(-1) ?? createRecoveredRequestAnalysis(workflow);
  const planner =
    messages
      .map((message) => message.taskExecutionPlan)
      .filter((plan) => plan !== null && plan !== undefined)
      .at(-1) ?? workflow.planner;
  const executorByTaskId = new Map<string, ExecutorAgentResult>();
  for (const message of messages) {
    if (message.executorResult) {
      executorByTaskId.set(message.executorResult.task_id, message.executorResult);
    }
    for (const result of message.executorResults ?? []) {
      executorByTaskId.set(result.task_id, result);
    }
  }

  return {
    workflowPurpose,
    requestAnalysis,
    planner,
    executorResults: [...executorByTaskId.values()],
    critique: workflow,
    correctionSource: {
      formId: resolution.formId,
      action: resolution.action,
      retryTaskIds:
        resolution.correctionTaskIds ?? workflow.review.retry_task_ids ?? [],
    },
  };
}

/**
 * 为定点重试加载服务端可信的上一轮错误，避免接受客户端可篡改文本。
 */
export async function loadExecutorRetryFailure(
  conversationId: string | undefined,
  taskId: string | undefined,
): Promise<{ taskId: string; error: string } | undefined> {
  if (!conversationId || !taskId) return undefined;
  const error = await findLatestExecutorRetryError(conversationId, taskId);
  return error && isPersistedExecutorRetryFailureRetryable(error)
    ? { taskId, error }
    : undefined;
}

/** 失效的废弃目标无法通过重放同一任务修复，不应继续作为可信重试入口。 */
export function isPersistedExecutorRetryFailureRetryable(
  error: string,
): boolean {
  return !error.includes("missing_deprecation_target");
}

/**
 * 仅把当前请求真正提交但未命中待处理记录的产品工作流表单判定为过期。
 * Executor 重试携带的是只读历史消息，不得把其中的旧表单答案再次消费。
 */
export function shouldRejectStaleWorkflowFormSubmission({
  isWorkflowRetry,
  submittedFormId,
  answerResolved,
}: {
  isWorkflowRetry: boolean;
  submittedFormId: string | null;
  answerResolved: boolean;
}): boolean {
  return (
    !isWorkflowRetry &&
    Boolean(submittedFormId?.endsWith("-proposal-decision")) &&
    !answerResolved
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
  skipPendingDecisionItems = false,
  productWorkflowResult,
}: {
  conversationId?: string;
  requestFormId?: string;
  agentOutputs: AgentConversationOutput[];
  messages: ChatMessage[];
  skipPendingDecisionItems?: boolean;
  productWorkflowResult?: ProductWorkflowResult | null;
}): Promise<ConversationTitleUpdate | null> {
  if (!conversationId || agentOutputs.length === 0) return null;

  const conversationOutput = agentOutputs.find(
    (output) => output.type === "conversation",
  );
  const requestOutput = agentOutputs.find((output) => output.type === "request");
  const plannerOutputs = agentOutputs.filter(
    (output) => output.type === "planner",
  );
  const items = conversationOutput
    ? parseUserInputPayload(conversationOutput.content)
    : null;
  const requestAnalysis = requestOutput
    ? parseRequestAnalysisPayload(requestOutput.content)
    : null;
  const taskExecutionPlan =
    plannerOutputs
      .map((output) => parseTaskExecutionPlanPayload(output.content))
      .filter((plan) => plan !== null)
      .at(-1) ?? null;
  const executorResults = agentOutputs
    .map((output) => parseExecutorResultPayload(output.content))
    .filter((result) => result !== null);
  const productWorkflow =
    productWorkflowResult ??
    agentOutputs
      .map((output) => parseProductWorkflowPayload(output.content))
      .filter((workflow) => workflow !== null)
      .at(-1) ??
    null;
  const sanitizedExecutorResults = executorResults.map(
    sanitizeExecutorResultForPersistence,
  );
  const sanitizedProductWorkflow = productWorkflow
    ? sanitizeProductWorkflowForPersistence(productWorkflow)
    : null;
  const finalProductWorkflow =
    skipPendingDecisionItems &&
    sanitizedProductWorkflow?.status === "pending_user_confirmation"
      ? { ...sanitizedProductWorkflow, status: "completed" as const }
      : sanitizedProductWorkflow;
  // 每个 Agent 单独落库，message.type 用于前端恢复正确的展示位置。
  for (const output of agentOutputs) {
    if (
      output.content.trim().length === 0 &&
      !output.reasoningContent?.trim() &&
      !output.subagentTraces?.length &&
      !output.agentError
    ) {
      continue;
    }
    const outputProductWorkflow = parseProductWorkflowPayload(output.content);
    const outputTaskExecutionPlan =
      output.type === "planner"
        ? parseTaskExecutionPlanPayload(output.content)
        : null;
    const persistedOutputWorkflow = outputProductWorkflow
      ? sanitizeProductWorkflowForPersistence(outputProductWorkflow)
      : null;
    const outputContent = sanitizeAgentOutputContent(
      output,
      persistedOutputWorkflow ?? finalProductWorkflow,
    );
    const outputDisplayProductWorkflow = persistedOutputWorkflow
      ? createProductWorkflowDisplaySnapshot(persistedOutputWorkflow)
      : null;

    const messageId = await persistAssistantMessage({
      conversationId,
      workflowRoundId: output.workflowRoundId,
      content: outputContent,
      userInput: output.type === "conversation" ? items : null,
      reasoningContent: output.reasoningContent,
      toolCalls: sanitizeToolCallsForPersistence(output.toolCalls),
      subagentTraces: output.subagentTraces,
      agentError: output.agentError,
      taskExecutionPlan: outputTaskExecutionPlan,
      productWorkflow: outputDisplayProductWorkflow,
      type: output.type,
    });

    // token_usage 已在流式事件到达时写入，这里只补充最终 message_id 关联。
    await attachTokenUsageRecordsToMessage(
      output.tokenUsageRecordIds ?? [],
      messageId,
    );
  }

  await persistRequestAnalysisItems(requestFormId, requestAnalysis);
  await persistTaskExecutionPlan({
    conversationId,
    requestFormId,
    plan: taskExecutionPlan,
  });
  // 终局确认恢复执行完成后，本轮已经结束，不能再生成新的待用户确认条目。
  if (!skipPendingDecisionItems) {
    await persistExecutorProposalItems(requestFormId, sanitizedExecutorResults);
    await persistProposalDecisionItem(requestFormId, finalProductWorkflow);
    if (shouldPersistProductWorkflowConfirmation(finalProductWorkflow)) {
      await persistProductWorkflowConfirmationDecision(
        requestFormId,
        finalProductWorkflow,
      );
    }
  }

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
 * 判断 Critique 是否需要持久化最终处理确认，而不是补充信息表单。
 */
export function shouldPersistProductWorkflowConfirmation(
  result: ProductWorkflowResult | null,
): result is ProductWorkflowResult {
  return (
    result?.status === "pending_user_confirmation" &&
    result.proposal_questions.length === 0 &&
    !result.knowledge_graph_update.open_questions.some(
      (question) => question.blocking,
    )
  );
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

  const outputProductWorkflow = parseProductWorkflowPayload(output.content);
  const persistedProductWorkflow =
    productWorkflow ??
    (outputProductWorkflow
      ? sanitizeProductWorkflowForPersistence(outputProductWorkflow)
      : null);
  if (persistedProductWorkflow) {
    return removeProductWorkflowPayload(output.content);
  }

  return output.content;
}

/**
 * 从消息正文移除已写入结构化 meta 的产品工作流块。
 */
function removeProductWorkflowPayload(content: string): string {
  const startMarker = "<product-workflow";
  const endMarker = "</product-workflow>";
  let result = content;
  while (true) {
    const startIndex = result.search(
      new RegExp(escapeRegExp(startMarker), "i"),
    );
    if (startIndex === -1) return result.trim();
    const openEnd = result.indexOf(">", startIndex);
    const endIndex = result.indexOf(endMarker, openEnd + 1);
    if (openEnd === -1 || endIndex === -1) return result.trim();
    const blockEnd = endIndex + endMarker.length;
    result = `${result.slice(0, startIndex)}${result.slice(blockEnd)}`;
  }
}

/**
 * 裁剪持久化到 message.meta 的工具调用结果，避免知识图谱全文和大块工具输出重复进入消息表。
 */
function sanitizeToolCallsForPersistence(
  toolCalls: AgentConversationOutput["toolCalls"],
): AgentConversationOutput["toolCalls"] {
  if (!toolCalls?.length) return toolCalls;

  return toolCalls.map((toolCall) => ({
    ...toolCall,
    result: sanitizeToolResultForPersistence(toolCall.name, toolCall.result),
  }));
}

/**
 * 知识图谱工具只保留可展示摘要；完整图谱以 product_knowledge_graph 表为准。
 */
function sanitizeToolResultForPersistence(
  toolName: string,
  result: unknown,
): unknown {
  if (!toolName.startsWith("kg_file_")) {
    return sanitizeGenericToolResultForPersistence(result);
  }

  const parsed = parseToolResultObject(result);
  if (!parsed) {
    return {
      action: toolName,
      summary: typeof result === "string" ? truncateText(result, 240) : "",
    };
  }

  return {
    action: typeof parsed.action === "string" ? parsed.action : toolName,
    count: typeof parsed.count === "number" ? parsed.count : undefined,
    entityCount: Array.isArray(parsed.entities)
      ? parsed.entities.length
      : undefined,
    relationCount: Array.isArray(parsed.relations)
      ? parsed.relations.length
      : undefined,
    decisionCount: Array.isArray(parsed.decisions)
      ? parsed.decisions.length
      : undefined,
    riskCount: Array.isArray(parsed.risks) ? parsed.risks.length : undefined,
    openQuestionCount: Array.isArray(parsed.open_questions)
      ? parsed.open_questions.length
      : undefined,
    summaryCount: Array.isArray(parsed.summary) ? parsed.summary.length : undefined,
    preview: createToolResultPreview(parsed),
  };
}

/**
 * DeepAgents 内置工具保留可恢复展示的轻量结果，避免大型子任务报告撑大 message.meta。
 */
function sanitizeGenericToolResultForPersistence(result: unknown): unknown {
  if (typeof result === "string") {
    return truncateText(result, 1200);
  }

  try {
    return truncateText(JSON.stringify(result), 1200);
  } catch {
    return truncateText(String(result), 1200);
  }
}

/**
 * 解析工具结果中的 JSON 对象，兼容 LangChain ToolMessage 的字符串内容。
 */
function parseToolResultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }

  if (typeof result !== "string") return null;

  try {
    const parsed = JSON.parse(result) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 生成工具结果预览，保留调试线索但不写入完整图谱正文。
 */
function createToolResultPreview(result: Record<string, unknown>): string {
  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length > 0) {
    return truncateText(JSON.stringify(items.slice(0, 3)), 360);
  }

  const summary = Array.isArray(result.summary)
    ? result.summary.slice(-3).join("\n")
    : "";
  return truncateText(summary, 360);
}

/**
 * 按字符数裁剪文本，避免 meta 字段保存非必要长内容。
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
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
