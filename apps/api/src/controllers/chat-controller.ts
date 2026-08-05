/**
 * 聊天 API 控制器
 *
 * 负责账号、工作区、会话和聊天 SSE 请求的 HTTP 入口处理。
 * 聊天流中会收集 Agent 输出用于最终消息持久化，并在每个 Agent 结束时即时写入 token 用量。
 *
 * Responsibilities:
 * - 校验请求并转发到业务服务
 * - 管理聊天 SSE 生命周期和停止信号
 * - 按 Agent 类型聚合输出、工具调用、推理内容与 token 用量
 *
 * Notes:
 * - LangGraph 和 Agent 编排仍由 agent-runtime 负责，本控制器只做 API 边界处理。
 */

import type { Context } from "hono";
import { stream } from "hono/streaming";
import {
  createDocumentEvidenceAnswerResult,
  createDocumentEvidenceResolutionThreadId,
  createHumanInTheLoopThreadId,
  createWorkflowThreadId,
  extractQuestionFormId,
  getFormAnswerId,
  isAcceptedDocumentEvidenceWorkflowResult,
  isProductWorkflowOptionalStopAnswer,
  isPreOrchGraphConflictFormId,
  parseGraphConflictAction,
  releaseQuestionFormHumanInterrupt,
  resolveAnsweredGraphOpenQuestions,
  resumeDocumentEvidenceResolutionWorkflow,
  resumeQuestionFormHumanInterrupt,
  streamConversation,
} from "@repo/agent-runtime";
import type { ProductKnowledgeGraph, ProductWorkflowResult } from "@repo/shared";
import {
  ChatRequestSchema,
  CreateChatRequestSchema,
  CreateWorkspaceRequestSchema,
  ListChatsQuerySchema,
  StopChatRequestSchema,
} from "../schemas";
import { toApiEvent } from "../services/agent-stream-service";
import {
  type AgentConversationOutput,
  createChat,
  listMessages,
  listChats,
  loadExecutorRetryFailure,
  loadPendingDecisionQuestionForm,
  markRequestFormStatus,
  persistAgentTokenUsage,
  persistConversationResult,
  persistConversationStart,
} from "../services/chat-service";
import { loadProductRuntimeContextForConversation } from "../services/product-context-service";
import {
  clearWorkspaceKnowledgeGraph,
  finalizeWorkspaceKnowledgeGraph,
  getWorkspaceKnowledgeGraph,
} from "../services/product-knowledge-graph-service";
import {
  createWorkspace,
  getAccount,
  listWorkspaces,
} from "../services/workspace-service";
import { writeSse, writeSseDone } from "../utils/sse";
import {
  abortChatRun,
  registerChatRun,
  unregisterChatRun,
} from "../services/chat-run-registry";
import { getConversationModelProfile } from "../repositories/model-profile-repository";
import {
  completeDocumentEvidenceResolutionItem,
  getDocumentEvidenceResolutionByConversationId,
  getDocumentEvidenceResolutionByRequestFormId,
  markDocumentEvidenceSupplementRunning,
  persistDocumentEvidenceResolutionPlan,
  type DocumentEvidenceResolutionRecord,
} from "../repositories/request-form-repository";

/**
 * SSE 处理期间的 Agent 输出累加器，内部始终保留可写的工具调用数组和 token 用量。
 */
type AgentOutputAccumulator = AgentConversationOutput & {
  reasoningContent: string;
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>;
  tokenUsage: Required<NonNullable<AgentConversationOutput["tokenUsage"]>>;
  durationMs: number;
  tokenUsageRecordIds: string[];
};

/**
 * 使用服务端会话关联选择专用补证上下文，并拒绝客户端表单串线。
 */
export function resolveDocumentEvidenceResolutionContext({
  chatId,
  requestFormId,
  resolutionByConversation,
  resolutionByRequestForm,
}: {
  chatId: string | undefined;
  requestFormId: string | undefined;
  resolutionByConversation: DocumentEvidenceResolutionRecord | null;
  resolutionByRequestForm: DocumentEvidenceResolutionRecord | null;
}): {
  resolution: DocumentEvidenceResolutionRecord | null;
  effectiveRequestFormId: string | undefined;
} {
  if (
    resolutionByRequestForm &&
    resolutionByRequestForm.conversationId !== chatId
  ) {
    throw new Error(
      "Document evidence resolution request form does not belong to this conversation.",
    );
  }
  if (
    resolutionByConversation &&
    requestFormId &&
    resolutionByConversation.requestFormId !== requestFormId
  ) {
    throw new Error(
      "Document evidence resolution conversation has a different request form.",
    );
  }
  const resolution = resolutionByConversation ?? resolutionByRequestForm;
  return {
    resolution,
    effectiveRequestFormId: resolution?.requestFormId ?? requestFormId,
  };
}

/**
 * 获取当前本地用户的账户信息。
 */
export async function getAccountHandler(c: Context) {
  return c.json({
    account: await getAccount(),
  });
}

/**
 * 获取当前本地用户的所有工作区列表。
 */
export async function listWorkspacesHandler(c: Context) {
  return c.json({
    workspaces: await listWorkspaces(),
  });
}

/**
 * 创建新工作区，校验并解析请求体中的名称和本地路径。
 */
export async function createWorkspaceHandler(c: Context) {
  const body = await readJsonBody(c.req.raw);
  const parsed = CreateWorkspaceRequestSchema.safeParse(body ?? {});

  // 请求体校验失败时返回 400 及详细错误信息
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  return c.json(
    {
      workspace: await createWorkspace(
        parsed.data.name,
        parsed.data.localPath,
      ),
    },
    201,
  );
}

/**
 * 按工作区 ID 查询当前用户的活跃会话列表。
 */
export async function listChatsHandler(c: Context) {
  const parsed = ListChatsQuerySchema.safeParse({
    workspaceId: c.req.query("workspaceId"),
  });

  // 查询参数校验失败时返回 400
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  return c.json({
    chats: await listChats(parsed.data.workspaceId),
  });
}

/**
 * 获取指定会话的所有历史消息。
 */
export async function listMessagesHandler(c: Context) {
  return c.json({
    messages: await listMessages(c.req.param("id")!),
  });
}

/**
 * 在指定工作区中创建新会话，校验请求体后调用业务服务。
 */
export async function createChatHandler(c: Context) {
  const body = await readJsonBody(c.req.raw);
  const parsed = CreateChatRequestSchema.safeParse(body ?? {});

  // 请求体校验失败时返回 400
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { chat, requestForm } = await createChat(
    parsed.data.workspaceId,
    parsed.data.title,
  );

  return c.json({ chat, requestForm }, 201);
}

/**
 * 停止指定会话当前运行中的 Agent 流，并向运行时传播 abort 信号。
 */
export async function stopChatHandler(c: Context) {
  const body = await readJsonBody(c.req.raw);
  const parsed = StopChatRequestSchema.safeParse(body ?? {});

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  return c.json({ stopped: abortChatRun(parsed.data.chatId) });
}

/**
 * 处理 SSE 流式对话请求，负责消息持久化、上下文加载和流式事件转发。
 */
export async function chatStreamHandler(c: Context) {
  const body = await readJsonBody(c.req.raw);
  const parsed = ChatRequestSchema.safeParse(body);

  // 请求体校验失败时返回 400
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // 设置 SSE 响应头
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (writer) => {
    const runtimeController = new AbortController();
    const abortRuntime = () => runtimeController.abort();
    const chatId = parsed.data.chatId;
    let effectiveRequestFormId = parsed.data.requestFormId;
    let requestFormStatus: string | null = null;

    if (chatId) {
      registerChatRun(chatId, runtimeController);
    }
    c.req.raw.signal.addEventListener("abort", abortRuntime, { once: true });

    const markStatus = async (status: string) => {
      if (requestFormStatus === status) return;
      requestFormStatus = status;
      await markRequestFormStatus(effectiveRequestFormId, status);
    };

    // 发送 SSE 开始事件
    await writeSse(writer, { type: "start" });

    let responseLength = 0;
    const agentOutputs = new Map<string, AgentOutputAccumulator>();
    let currentWorkflowRoundId: string | undefined;
    let productWorkflowResult: unknown = null;
    let latestKnowledgeGraph: ProductKnowledgeGraph | null = null;
    let runtimeWorkspaceId: string | undefined;
    let autoFinalizedWorkflowRound = false;
    let documentEvidenceCompletionPending = false;
    let terminalStreamError = false;
    const shouldFinalizeWorkflowRound = isProductWorkflowFinalConfirmationAnswer(
      parsed.data.messages,
    );

    try {
      const [resolutionByConversation, resolutionByRequestForm] =
        await Promise.all([
          getDocumentEvidenceResolutionByConversationId(chatId),
          getDocumentEvidenceResolutionByRequestFormId(
            parsed.data.requestFormId,
          ),
        ]);
      const resolvedEvidenceContext = resolveDocumentEvidenceResolutionContext({
        chatId,
        requestFormId: parsed.data.requestFormId,
        resolutionByConversation,
        resolutionByRequestForm,
      });
      const documentEvidenceResolution = resolvedEvidenceContext.resolution;
      effectiveRequestFormId =
        resolvedEvidenceContext.effectiveRequestFormId;
      let documentEvidenceAnswer = null;
      if (parsed.data.hitlResume) {
        // 先恢复 LangGraph HITL 中断，再让现有 Conversation Agent 消费表单答案。
        if (parsed.data.hitlResume.threadId.startsWith("document-evidence:")) {
          const expectedThreadId = documentEvidenceResolution
            ? createDocumentEvidenceResolutionThreadId({
                conversationId: documentEvidenceResolution.conversationId,
                runId: documentEvidenceResolution.runId,
              })
            : null;
          if (
            !expectedThreadId ||
            parsed.data.hitlResume.threadId !== expectedThreadId
          ) {
            throw new Error(
              "Document evidence resolution does not belong to this request form.",
            );
          }
          documentEvidenceAnswer =
            await resumeDocumentEvidenceResolutionWorkflow(
              parsed.data.hitlResume,
            );
          await markDocumentEvidenceSupplementRunning(
            effectiveRequestFormId,
            documentEvidenceAnswer.answerText,
          );
        } else {
          await resumeQuestionFormHumanInterrupt(parsed.data.hitlResume);
        }
      } else if (
        documentEvidenceResolution?.status === "supplement_running" &&
        documentEvidenceResolution.resolution &&
        documentEvidenceResolution.answer
      ) {
        // 下游失败重试时复用已持久化答案，避免要求用户重复填写已消费的 Question Form。
        documentEvidenceAnswer = createDocumentEvidenceAnswerResult({
          runId: documentEvidenceResolution.runId,
          sourceGraphVersion: documentEvidenceResolution.sourceGraphVersion,
          answerText: documentEvidenceResolution.answer,
          resolution: documentEvidenceResolution.resolution,
        });
      }

      // 持久化用户发送的消息
      const workflowAnswerResolution = parsed.data.workflowRetry
        ? null
        : await persistConversationStart(
            parsed.data.chatId,
            effectiveRequestFormId,
            parsed.data.messages,
          );
      const submittedWorkflowFormId = getFormAnswerId(
        parsed.data.messages
          .filter((message) => message.role === "user")
          .at(-1)?.content ?? "",
      );
      // 产品工作流表单必须命中服务端待处理决策，禁止过期答案退回普通编排。
      if (
        submittedWorkflowFormId?.endsWith("-proposal-decision") &&
        !workflowAnswerResolution
      ) {
        throw new Error(
          "The submitted product workflow question form is stale or does not match a pending decision.",
        );
      }
      const workflowRetryFailure = parsed.data.workflowRetry
        ? await loadExecutorRetryFailure(
            parsed.data.chatId,
            parsed.data.workflowRetry.taskId,
          )
        : undefined;
      await markStatus(
        parsed.data.workflowRetry ? "workflow_running" : "received",
      );

      const pendingDecisionForm =
        shouldFinalizeWorkflowRound || parsed.data.workflowRetry
        ? null
        : await loadPendingDecisionQuestionForm(effectiveRequestFormId);
      if (pendingDecisionForm) {
        await markStatus("pending_user_confirmation");
        const promptText =
          "Conversation Agent 正在根据 Planner SubAgent 的决策项向你确认信息。";
        const output = getAgentOutput(
          agentOutputs,
          "conversation_confirmation",
        );
        output.content += `${promptText}\n${pendingDecisionForm}`;
        responseLength += promptText.length + pendingDecisionForm.length;

        await writeSse(writer, {
          type: "text",
          content: promptText,
          agentType: "conversation_confirmation",
        });
        await writeSse(writer, {
          type: "question-form-start",
          agentType: "conversation_confirmation",
        });
        await writeSse(writer, {
          type: "question-form-complete",
          content: pendingDecisionForm,
          agentType: "conversation_confirmation",
        });
        const pendingInterrupt = await releaseQuestionFormHumanInterrupt({
          threadId: createHumanInTheLoopThreadId({
            scopeId: effectiveRequestFormId ?? parsed.data.chatId,
            formId: extractQuestionFormId(pendingDecisionForm),
          }),
          questionForm: pendingDecisionForm,
          agentType: "conversation_confirmation",
        });
        if (pendingInterrupt) {
          await writeSse(writer, {
            type: "human-interrupt",
            interrupt: pendingInterrupt,
            agentType: "conversation_confirmation",
          });
        }

        await persistConversationResult({
          conversationId: parsed.data.chatId,
          requestFormId: effectiveRequestFormId,
          agentOutputs: [...agentOutputs.values()],
          messages: parsed.data.messages,
        });
        await writeSseDone(writer);
        return;
      }

      // Request Agent 需要产品概述上下文；按会话加载工作区概述文档
      const runtimeContext = await loadProductRuntimeContextForConversation(
        parsed.data.chatId,
      );
      const answeredOpenQuestionIds = [
        ...new Set(
          (workflowAnswerResolution?.questions ?? []).flatMap((question) =>
            question.answered
              ? question.sources.flatMap((source) =>
                  source.open_question_id ? [source.open_question_id] : [],
                )
              : [],
          ),
        ),
      ];
      // 在启动下一轮 Agent 前归档回答状态，确保失败重试也不会复活旧问题。
      if (runtimeContext.knowledgeGraph && answeredOpenQuestionIds.length > 0) {
        const resolvedKnowledgeGraph = resolveAnsweredGraphOpenQuestions(
          runtimeContext.knowledgeGraph,
          answeredOpenQuestionIds,
          workflowAnswerResolution,
        );
        if (!resolvedKnowledgeGraph) {
          throw new Error("Failed to apply resolved product workflow questions.");
        }
        runtimeContext.knowledgeGraph = resolvedKnowledgeGraph;
        await finalizeWorkspaceKnowledgeGraph({
          workspaceId: runtimeContext.workspaceId,
          conversationId: parsed.data.chatId,
          requestFormId: effectiveRequestFormId,
          knowledgeGraph: runtimeContext.knowledgeGraph,
          advanceVersion: false,
        });
      }
      // 在 SSE 开始执行 Agent 前只解析一次，保证本轮剩余节点使用同一不可变快照。
      const modelProfile = await getConversationModelProfile(
        parsed.data.chatId!,
      );
      runtimeWorkspaceId = runtimeContext.workspaceId;
      if (
        parseLatestExistingGraphNewProjectAction(parsed.data.messages) ===
        "replace_current_graph"
      ) {
        await clearWorkspaceKnowledgeGraph(runtimeContext.workspaceId);
        runtimeContext.knowledgeGraph = null;
        runtimeContext.contextSource = "none";
      }

      // 启动 agent-runtime 流式对话
      for await (const event of streamConversation(
        parsed.data.messages,
        {
          enabledTools: parsed.data.enabledTools,
          workspaceId: runtimeContext.workspaceId,
          requestFormId: effectiveRequestFormId,
          workflowThreadId: createWorkflowThreadId({
            conversationId: parsed.data.chatId,
            requestFormId: effectiveRequestFormId,
          }),
          productContext: runtimeContext.productContext,
          contextSource: runtimeContext.contextSource,
          knowledgeGraph: runtimeContext.knowledgeGraph,
          modelProfile,
          workflowAnswerResolution,
          workflowRetry: parsed.data.workflowRetry,
          workflowRetryFailure,
          documentEvidenceResolution:
            documentEvidenceResolution &&
            documentEvidenceResolution.status !== "completed"
            ? {
                conversationId: documentEvidenceResolution.conversationId,
                runId: documentEvidenceResolution.runId,
                sourceGraphVersion:
                  documentEvidenceResolution.sourceGraphVersion,
                blockers: documentEvidenceResolution.blockers,
              }
            : undefined,
          documentEvidenceAnswer: documentEvidenceAnswer ?? undefined,
          signal: runtimeController.signal,
        },
      )) {
        if (event.type === "document-evidence-resolution-plan") {
          await persistDocumentEvidenceResolutionPlan(
            effectiveRequestFormId,
            event.resolution,
          );
          continue;
        }
        if (event.type === "document-evidence-resolution-complete") {
          documentEvidenceCompletionPending = true;
          continue;
        }
        if (event.type === "workflow-round-start") {
          currentWorkflowRoundId = event.roundId;
          await writeSse(writer, toApiEvent(event));
          continue;
        }
        if (event.type === "complete") {
          // 捕获工作流完整结构化结果，供最终知识图谱归档使用
          productWorkflowResult = event.result;
          autoFinalizedWorkflowRound = event.result.status === "completed";
          if (
            documentEvidenceResolution?.status === "supplement_running" &&
            isAcceptedDocumentEvidenceWorkflowResult(event.result)
          ) {
            documentEvidenceCompletionPending = true;
          }
          continue;
        }
        if (
          event.type === "question-form-complete" &&
          event.agentType === "conversation_confirmation"
        ) {
          autoFinalizedWorkflowRound = false;
        }
        if (event.type === "knowledge-graph-update") {
          latestKnowledgeGraph = event.knowledgeGraph;
          // 每个 Executor 完成后增量写入知识图谱，中断时已完成的 Executor 结果不丢失
          await finalizeWorkspaceKnowledgeGraph({
            workspaceId: runtimeContext.workspaceId,
            conversationId: parsed.data.chatId,
            requestFormId: effectiveRequestFormId,
            knowledgeGraph: event.knowledgeGraph,
            advanceVersion: false,
          });
          continue;
        }
        if (event.type === "error") {
          if (event.terminal) {
            terminalStreamError = true;
            const output = getAgentOutput(
              agentOutputs,
              getEventAgentType(event),
              currentWorkflowRoundId,
            );
            output.agentError = {
              agentType: event.agentType,
              message: event.error,
              retryAction: event.retryAction,
            };
            await markStatus("failed");
          }
        }
        const nextStatus = getRequestFormStatusForEvent(event);
        if (nextStatus) {
          await markStatus(nextStatus);
        }

        if ("content" in event && event.type === "reasoning") {
          getAgentOutput(
            agentOutputs,
            getEventAgentType(event),
            currentWorkflowRoundId,
          ).reasoningContent += event.content;
        }
        if (event.type === "tool-call") {
          const output = getAgentOutput(
            agentOutputs,
            getEventAgentType(event),
            currentWorkflowRoundId,
          );
          upsertToolCall(output.toolCalls, {
            id: event.toolCallId,
            name: event.toolName,
            args: event.toolArgs,
            agentType: getEventAgentType(event),
            status: "running",
          });
        }
        if (event.type === "tool-result") {
          const output = getAgentOutput(
            agentOutputs,
            getEventAgentType(event),
            currentWorkflowRoundId,
          );
          attachToolResult(
            output.toolCalls,
            event.toolCallId,
            event.toolName,
            event.toolResult,
            getEventAgentType(event),
          );
        }
        if (event.type === "subagent-start") {
          const output = getAgentOutput(
            agentOutputs,
            getEventAgentType(event),
            currentWorkflowRoundId,
          );
          const traces = ensureSubagentTraces(output);
          upsertSubagentTrace(traces, {
            id: event.toolCallId,
            parentAgentType: getEventAgentType(event),
            subagentType: event.subagentType,
            description: event.description,
            status: "running",
          });
        }
        if (event.type === "subagent-thinking") {
          const output = getAgentOutput(
            agentOutputs,
            getEventAgentType(event),
            currentWorkflowRoundId,
          );
          const traces = ensureSubagentTraces(output);
          appendSubagentThinking(traces, {
            id: event.toolCallId,
            parentAgentType: getEventAgentType(event),
            subagentType: event.subagentType,
            content: event.content,
          });
        }
        if (event.type === "subagent-result") {
          const output = getAgentOutput(
            agentOutputs,
            getEventAgentType(event),
            currentWorkflowRoundId,
          );
          const traces = ensureSubagentTraces(output);
          attachSubagentResult(traces, {
            id: event.toolCallId,
            parentAgentType: getEventAgentType(event),
            subagentType: event.subagentType,
            result: event.result,
          });
        }
        if (event.type === "agent-status" && event.status === "completed") {
          markPendingToolCallsComplete(
            getAgentOutput(
              agentOutputs,
              getEventAgentType(event),
              currentWorkflowRoundId,
            ).toolCalls,
            getEventAgentType(event),
          );
        }
        if (event.type === "token-usage") {
          const agentType = getEventAgentType(event);
          const output = getAgentOutput(
            agentOutputs,
            agentType,
            currentWorkflowRoundId,
          );
          output.tokenUsage = {
            inputTokens: event.inputTokens,
            cacheHitInputTokens: event.cacheHitInputTokens,
            cacheMissInputTokens: event.cacheMissInputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
            costInput: event.costInput,
            costOutput: event.costOutput,
            costTotal: event.costTotal,
          };
          output.durationMs = event.durationMs;

          const tokenUsageId = await persistAgentTokenUsage(
            parsed.data.chatId
              ? {
                  conversationId: parsed.data.chatId,
                  agentType,
                  inputTokens: event.inputTokens,
                  cacheHitInputTokens: event.cacheHitInputTokens,
                  cacheMissInputTokens: event.cacheMissInputTokens,
                  outputTokens: event.outputTokens,
                  totalTokens: event.totalTokens,
                  costInput: event.costInput,
                  costOutput: event.costOutput,
                  costTotal: event.costTotal,
                  durationMs: event.durationMs,
                }
              : null,
          );
          if (tokenUsageId) {
            output.tokenUsageRecordIds.push(tokenUsageId);
          }

          await writeSse(writer, {
            ...toApiEvent(event),
            id: tokenUsageId ?? undefined,
            createdAt: new Date().toISOString(),
          });
          continue;
        }
        if (
          "content" in event &&
          event.type !== "reasoning" &&
          event.type !== "subagent-thinking"
        ) {
          responseLength += event.content.length;
          getAgentOutput(
            agentOutputs,
            getEventAgentType(event),
            currentWorkflowRoundId,
          ).content += event.content;
        }
        await writeSse(writer, toApiEvent(event));
      }

      // Agent 完成后持久化结果
      const titleUpdate = await persistConversationResult({
        conversationId: parsed.data.chatId,
        requestFormId: effectiveRequestFormId,
        agentOutputs: [...agentOutputs.values()],
        messages: parsed.data.messages,
        // 是否跳过待确认条目由结构化 workflow 状态决定；新表单会重置该标记。
        skipPendingDecisionItems: autoFinalizedWorkflowRound,
        productWorkflowResult: isProductWorkflowResult(productWorkflowResult)
          ? productWorkflowResult
          : null,
      });

      if (!terminalStreamError) {
        await finalizeWorkspaceKnowledgeGraph({
          workspaceId: runtimeContext.workspaceId,
          conversationId: parsed.data.chatId,
          requestFormId: effectiveRequestFormId,
          advanceVersion: true,
          // 最终归档优先使用运行时累计快照，避免 Critique Agent 的模型汇总覆盖成局部图谱。
          knowledgeGraph:
            latestKnowledgeGraph ??
            (isProductWorkflowResult(productWorkflowResult)
              ? productWorkflowResult.knowledge_graph_update
              : undefined),
        });

        if (
          documentEvidenceCompletionPending &&
          documentEvidenceResolution &&
          isProductWorkflowResult(productWorkflowResult) &&
          isAcceptedDocumentEvidenceWorkflowResult(productWorkflowResult)
        ) {
          const resolvedGraph = await getWorkspaceKnowledgeGraph(
            runtimeContext.workspaceId!,
          );
          if (
            resolvedGraph &&
            resolvedGraph.version >
              documentEvidenceResolution.sourceGraphVersion
          ) {
            await completeDocumentEvidenceResolutionItem({
              requestFormId: effectiveRequestFormId,
              resolvedGraphVersion: resolvedGraph.version,
            });
            await writeSse(writer, {
              type: "document-evidence-resolution-complete",
              runId: documentEvidenceResolution.runId,
              workspaceId: runtimeContext.workspaceId,
            });
          }
        }

        if (titleUpdate) {
          await writeSse(writer, {
            type: "conversation-title",
            chatId: titleUpdate.id,
            title: titleUpdate.title,
          });
        }

        if (requestFormStatus !== "pending_user_confirmation") {
          await markStatus("completed");
        }
      }

      console.log(
        `[chat] Stream complete, response length: ${responseLength}`,
      );
    } catch (error) {
      if (runtimeWorkspaceId && latestKnowledgeGraph) {
        try {
          await finalizeWorkspaceKnowledgeGraph({
            workspaceId: runtimeWorkspaceId,
            conversationId: parsed.data.chatId,
            requestFormId: effectiveRequestFormId,
            knowledgeGraph: latestKnowledgeGraph,
            advanceVersion: true,
          });
        } catch (archiveError) {
          console.error("[chat] Failed to finalize knowledge graph:", archiveError);
        }
      }

      if (isAbortError(error) || runtimeController.signal.aborted) {
        await persistConversationResult({
          conversationId: parsed.data.chatId,
          requestFormId: effectiveRequestFormId,
          agentOutputs: [...agentOutputs.values()],
          messages: parsed.data.messages,
          skipPendingDecisionItems: true,
        });
        await markStatus("stopped");
        await writeSse(writer, { type: "abort" });
      } else {
        await markStatus("failed");
        console.error("[chat] Error:", error);
        await writeSse(writer, {
          type: "error",
          error: getErrorMessage(error),
        });
      }
    } finally {
      if (chatId) unregisterChatRun(chatId, runtimeController);
      c.req.raw.signal.removeEventListener("abort", abortRuntime);
    }

    // 发送 SSE 结束信号
    await writeSseDone(writer);
  });
}

/**
 * 安全地将请求体解析为 JSON，解析失败时返回 undefined 而非抛出异常。
 */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * 将 unknown 类型的错误对象转换为可读字符串。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 根据流式事件推导 request_form 的阶段状态。
 */
function getRequestFormStatusForEvent(event: {
  type: string;
  agentType?: string;
}): string | null {
  if (event.type === "user-input-complete") return "conversation_consumed";
  if (event.type === "request-analysis-start") return "request_agent_running";
  if (event.type === "request-analysis-complete") return "request_analyzed";
  if (
    (event.type === "reasoning" ||
      event.type === "agent-status" ||
      event.type.startsWith("subagent-")) &&
    event.agentType &&
    event.agentType !== "conversation" &&
    event.agentType !== "request"
  ) {
    return "workflow_running";
  }
  if (event.type === "question-form-complete") return "pending_user_confirmation";
  if (event.type === "human-interrupt") return "pending_user_confirmation";
  return null;
}

/**
 * 判断异常是否来自用户或客户端主动中止。
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 按事件来源推断 Agent 类型，确保后续新增 Agent 时可以优先使用事件自带标识。
 */
function getEventAgentType(event: { type: string; agentType?: string }): string {
  if (event.agentType) return event.agentType;
  if (event.type.startsWith("request-analysis")) return "request";
  return "conversation";
}

/**
 * 获取指定 Agent 的输出累加器，统一收集正文和推理内容。
 */
function getAgentOutput(
  outputs: Map<string, AgentOutputAccumulator>,
  type: string,
  workflowRoundId?: string,
): AgentOutputAccumulator {
  const key = `${workflowRoundId ?? "global"}:${type}`;
  const existing = outputs.get(key);
  if (existing) return existing;

  const created = {
    type,
    ...(workflowRoundId ? { workflowRoundId } : {}),
    content: "",
    reasoningContent: "",
    toolCalls: [],
    subagentTraces: [],
    tokenUsage: {
      inputTokens: 0,
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costInput: 0,
      costOutput: 0,
      costTotal: 0,
    },
    durationMs: 0,
    tokenUsageRecordIds: [],
  };
  outputs.set(key, created);
  return created;
}

/**
 * 将工具结果挂到最近一次同名工具调用上，恢复历史消息时可重新展示工具卡片。
 */
function attachToolResult(
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>,
  toolCallId: string | undefined,
  toolName: string,
  toolResult: unknown,
  agentType: string,
): void {
  const targetIndex = findPendingToolCallIndex(
    toolCalls,
    toolCallId,
    toolName,
    agentType,
  );

  if (targetIndex === -1) {
    toolCalls.push({
      id: toolCallId,
      name: toolName,
      result: toolResult,
      agentType,
      status: "complete",
    });
    return;
  }

  toolCalls[targetIndex] = {
    ...toolCalls[targetIndex],
    result: toolResult,
    status: "complete",
  };
}

/**
 * 按工具调用 ID 合并流式 tool-call 事件，避免重复片段落库后显示多条 pending 工具。
 */
function upsertToolCall(
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>,
  nextToolCall: NonNullable<AgentConversationOutput["toolCalls"]>[number],
): void {
  if (nextToolCall.id) {
    const existingIndex = toolCalls.findIndex(
      (toolCall) => toolCall.id === nextToolCall.id,
    );
    if (existingIndex !== -1) {
      toolCalls[existingIndex] = {
        ...toolCalls[existingIndex],
        ...nextToolCall,
      };
      return;
    }
  }

  toolCalls.push(nextToolCall);
}

/**
 * 从后往前查找同名未完成工具调用，避免依赖较新的数组运行时 API。
 */
function findPendingToolCallIndex(
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>,
  toolCallId: string | undefined,
  toolName: string,
  agentType: string,
): number {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const toolCall = toolCalls[index];
    if (
      toolCallId &&
      toolCall?.id === toolCallId &&
      !Object.prototype.hasOwnProperty.call(toolCall, "result")
    ) {
      return index;
    }
    if (
      toolCall?.name === toolName &&
      (!toolCall.agentType || toolCall.agentType === agentType) &&
      !Object.prototype.hasOwnProperty.call(toolCall, "result")
    ) {
      return index;
    }
  }

  return -1;
}

/**
 * Agent 完成时收敛仍未收到结果的工具调用，避免历史消息恢复后继续显示转圈。
 */
function markPendingToolCallsComplete(
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>,
  agentType: string,
): void {
  for (let index = 0; index < toolCalls.length; index++) {
    const toolCall = toolCalls[index];
    if (
      toolCall?.agentType === agentType &&
      !Object.prototype.hasOwnProperty.call(toolCall, "result")
    ) {
      toolCalls[index] = {
        ...toolCall,
        status: "complete",
      };
    }
  }
}

/**
 * 确保 Agent 输出持有可写的 SubAgent 轨迹数组。
 */
function ensureSubagentTraces(
  output: AgentConversationOutput,
): NonNullable<AgentConversationOutput["subagentTraces"]> {
  if (!output.subagentTraces) {
    output.subagentTraces = [];
  }

  return output.subagentTraces;
}

/**
 * 记录 SubAgent 调用开始，供 Orchestrator 过程卡片内嵌展示。
 */
function upsertSubagentTrace(
  traces: NonNullable<AgentConversationOutput["subagentTraces"]>,
  nextTrace: NonNullable<AgentConversationOutput["subagentTraces"]>[number],
): void {
  const existingIndex = findSubagentTraceIndex(
    traces,
    nextTrace.id,
    nextTrace.subagentType,
  );

  if (existingIndex === -1) {
    traces.push(nextTrace);
    return;
  }

  traces[existingIndex] = {
    ...traces[existingIndex],
    ...nextTrace,
  };
}

/**
 * 追加 SubAgent reasoning，保留流式输出的原始顺序。
 */
function appendSubagentThinking(
  traces: NonNullable<AgentConversationOutput["subagentTraces"]>,
  event: {
    id?: string;
    parentAgentType?: string;
    subagentType: string;
    content: string;
  },
): void {
  const index = findSubagentTraceIndex(traces, event.id, event.subagentType);
  if (index === -1) {
    traces.push({
      id: event.id,
      parentAgentType: event.parentAgentType,
      subagentType: event.subagentType,
      thinking: event.content,
      status: "running",
    });
    return;
  }

  traces[index] = {
    ...traces[index],
    thinking: `${traces[index]?.thinking ?? ""}${event.content}`,
  };
}

/**
 * 写入 SubAgent 返回给主 Agent 的结果，并关闭该内嵌卡片的运行态。
 */
function attachSubagentResult(
  traces: NonNullable<AgentConversationOutput["subagentTraces"]>,
  event: {
    id?: string;
    parentAgentType?: string;
    subagentType: string;
    result: unknown;
  },
): void {
  const index = findSubagentTraceIndex(traces, event.id, event.subagentType);
  if (index === -1) {
    traces.push({
      id: event.id,
      parentAgentType: event.parentAgentType,
      subagentType: event.subagentType,
      result: event.result,
      status: "complete",
    });
    return;
  }

  traces[index] = {
    ...traces[index],
    result: event.result,
    status: "complete",
  };
}

/**
 * 优先按 task 调用 ID 匹配；无 ID 时匹配最近一个同类型 SubAgent。
 */
function findSubagentTraceIndex(
  traces: NonNullable<AgentConversationOutput["subagentTraces"]>,
  id: string | undefined,
  subagentType: string,
): number {
  if (id) {
    const byId = traces.findIndex((trace) => trace.id === id);
    if (byId !== -1) return byId;
  }

  for (let index = traces.length - 1; index >= 0; index -= 1) {
    if (traces[index]?.subagentType === subagentType) return index;
  }

  return -1;
}

/**
 * 判断一个 unknown 值是否为 ProductWorkflowResult 类型。
 */
function isProductWorkflowResult(value: unknown): value is ProductWorkflowResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "knowledge_graph_update" in value
  );
}

/**
 * 判断本轮用户消息是否为产品工作流最终确认，用于避免恢复执行完成后再次生成待确认条目。
 */
function isProductWorkflowFinalConfirmationAnswer(
  messages: { role: string; content: string }[],
): boolean {
  const latestUserMessage = messages
    .filter((message) => message.role === "user")
    .at(-1);
  return (
    getFormAnswerId(latestUserMessage?.content ?? "") ===
      "product-workflow-confirmation" ||
    isProductWorkflowOptionalStopAnswer(latestUserMessage?.content ?? "")
  );
}

/**
 * 识别用户是否在 Pre-Orchestrator 知识图谱冲突确认表单中选择替换当前图谱。
 */
function parseLatestExistingGraphNewProjectAction(
  messages: { role: string; content: string }[],
): ReturnType<typeof parseGraphConflictAction> {
  const latestUserMessage = messages
    .filter((message) => message.role === "user")
    .at(-1);
  if (!latestUserMessage) return null;
  const formId = getFormAnswerId(latestUserMessage.content);
  if (!formId || !isPreOrchGraphConflictFormId(formId)) {
    return null;
  }
  return parseGraphConflictAction(latestUserMessage.content);
}

/**
 * 获取指定工作区的产品知识图谱数据。
 * 返回 hasData、结构化图谱数据和按参考格式生成的 markdown。
 */
export async function getWorkspaceKnowledgeGraphHandler(c: Context) {
  const workspaceId = c.req.param("workspaceId");
  if (!workspaceId) {
    return c.json({ error: "缺少工作区 ID" }, 400);
  }

  const data = await getWorkspaceKnowledgeGraph(workspaceId);

  // 数据库无记录，返回空状态让前端禁用按钮
  if (!data) {
    return c.json({ hasData: false, markdown: "", nodes: [], relations: [], version: 0, updatedAt: "" });
  }

  return c.json(data);
}
