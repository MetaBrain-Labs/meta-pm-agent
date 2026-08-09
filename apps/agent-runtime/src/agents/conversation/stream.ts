/**
 * Conversation Agent 流式主通道
 *
 * 实现从用户消息到完整响应的 SSE 流式管道，Conversation Agent 职责已收窄为用户输入分解、
 * 表单问答管理和知识图谱冲突检测。意图路由、工作流恢复、澄清表单均由 Pre-Orchestrator 负责，
 * 产品工作流调度与执行由 LangGraph workflow.ts 全权拥有。
 *
 * Responsibilities:
 * - streamConversation()：主入口，接收历史消息和选项，产出 SSE 事件流
 * - streamAgentEvents()：驱动 Conversation Agent 并过滤仅用户授权的工具事件
 * - streamNormalProjectFlow()：运行 Conversation Agent 完成 user_input 分解和 question-form 输出
 * - streamPlanningAfterUserInput()：在 user-input-complete 后驱动 LangGraph 工作流
 * - streamChatOnlyFlow()：闲聊模式纯文本回复
 * - 在工作流完成后格式化并输出最终结果 block 和确认表单
 */

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "langchain";
import type {
  ChatMessage,
  ProductKnowledgeGraph,
  ProductWorkflowResult,
  RequestAnalysis,
} from "@repo/shared";
import { calculateCost } from "../../config";
import { createAgentRunSummaryRecorder } from "../common/agent-run-summary";
import {
  createConversationAgent,
  createConversationAgentSystemPrompt,
  resolveConversationModel,
} from "./agent";
import {
  createModelSummarySnapshot,
  toLlmPricing,
} from "../common/model-profile";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
  toLangChainMessages,
} from "../../utils/message-adapter";
import { streamTaggedBlock } from "../../utils/tagged-block-stream";
import {
  getFormAnswerId,
  isFormAnswer,
  isProductWorkflowAcceptanceAnswer,
  isProductWorkflowOptionalStopAnswer,
} from "../../utils/form-parser";
import {
  formatProductWorkflowBlock,
  formatProductWorkflowConfirmationQuestionForm,
  formatProductWorkflowProposalQuestionForm,
} from "../product-workflow/agent";
import { updateProductContextMetadata } from "../product-workflow/common/context-metadata";
import {
  isExecutorHumanInputRequiredError,
  isExecutorRetryRequiredError,
  isSameTaskExecutorRetryable,
  type ExecutorHumanInputRequired,
} from "../product-workflow/executor-agent/agent";
import {
  createWorkflowContinuationResumeContextFromMessages,
  createWorkflowExecutorRetryResumeContextFromMessages,
  createWorkflowResumeContextFromMessages,
  resolveAnsweredGraphOpenQuestions,
} from "./workflow-resume";
import {
  hasRetryableWorkflowTaskCheckpoint,
  streamWorkflowGraph,
} from "../../graph/workflow";
import {
  createHumanInTheLoopThreadId,
  extractQuestionFormId,
  releaseQuestionFormHumanInterrupt,
} from "../../graph/human-in-the-loop";
import {
  isDocumentEvidenceResolutionFormId,
  startDocumentEvidenceResolutionWorkflow,
} from "../../graph/document-evidence-resolution-workflow";
import type {
  AgentMessageType,
  ConversationStreamEvent,
  ConversationStreamOptions,
} from "../../types";
import {
  formatPreOrchQuestionForm,
  isPreOrchClarificationFormId,
  isPreOrchGraphConflictFormId,
  parseGraphConflictAction,
  formatPreOrchGraphConflictForm,
  type PreOrchResult,
} from "../product-workflow/orchestrator-agent/pre-orchestrator-subagent";
import {
  streamOrchestratorPreCheck,
} from "../product-workflow/orchestrator-agent/agent";
import { isExecutorAgentType } from "../product-workflow/executor-agent/definitions";

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
  let outputText = "";
  let completed = false;
  let failedError: unknown = null;
  const baseAgentOptions = {
    enabledTools: options.enabledTools,
    modelProfile: options.modelProfile,
    mode: options.mode,
  };
  const modelSelection = resolveConversationModel(baseAgentOptions);
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: "Conversation Agent",
    agentName: "conversation-agent",
    agentType: "conversation",
    model: createModelSummarySnapshot(modelSelection),
    context: {
      enabledTools: options.enabledTools ?? [],
      knowledgeGraph: options.knowledgeGraph ?? null,
      payload: {
        messages: compactConversationMessages(messages),
      },
      productContext: options.productContext,
      requestFormId: options.requestFormId,
      systemPrompt: createConversationAgentSystemPrompt(baseAgentOptions),
      workspaceId: options.workspaceId,
      workflowThreadId: options.workflowThreadId,
    },
  });
  const agentOptions = {
    ...baseAgentOptions,
    summaryRecorder,
  };

  try {
    const agent = createConversationAgent(agentOptions);
    const run = await agent.stream(
      { messages },
      { streamMode: "messages", signal: options.signal },
    );
    for await (const [message] of run) {
      for (const toolCall of getToolCalls(message)) {
        summaryRecorder.recordToolCall({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolArgs: toolCall.args,
        });
        yield {
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolArgs: toolCall.args,
          agentType: "conversation",
        };
      }

      const toolResult = getToolResult(message);
      if (toolResult) {
        summaryRecorder.recordToolResult({
          toolCallId: toolResult.id,
          toolName: toolResult.name,
          toolResult: toolResult.content,
        });
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

      const reasoning = getReasoningContent(message);
      if (reasoning) {
        summaryRecorder.recordThinking(reasoning);
        yield {
          type: "reasoning",
          content: reasoning,
          agentType: "conversation",
        };
      }

      const text = getTextContent(message);
      const cleanText = stripInternalNoise(text);
      if (cleanText) {
        outputText += cleanText;
        summaryRecorder.recordOutput(cleanText);
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
        toLlmPricing(modelSelection),
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
    completed = true;
  } catch (error) {
    failedError = error;
    throw error;
  } finally {
    await summaryRecorder.finish({
      error: failedError,
      output: outputText,
      status: failedError ? "failed" : completed ? "completed" : "cancelled",
      tokenUsage: tokenUsage
        ? {
            ...tokenUsage,
            durationMs: Date.now() - startTime,
          }
        : undefined,
    });
  }
}

/**
 * 判断当前工作区是否存在有意义的项目上下文。
 */
function hasExistingProject(
  knowledgeGraph?: ProductKnowledgeGraph | null,
): boolean {
  if (!knowledgeGraph) return false;
  return (
    knowledgeGraph.entities.length > 0 ||
    knowledgeGraph.relations.length > 0 ||
    knowledgeGraph.decisions.length > 0
  );
}

/**
 * 处理完整会话流。先判断 checkpoint 恢复，再根据普通意图分类结果路由到闲聊、
 * 澄清问题表单或产品工作流。
 */
export async function* streamConversation(
  messages: ChatMessage[],
  options: ConversationStreamOptions = {},
): AsyncGenerator<ConversationStreamEvent> {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("At least one chat message is required.");
  }

  if (options.workflowRetry) {
    yield* streamWorkflowExecutorRetry(messages, options);
    return;
  }

  if (options.documentEvidenceResolution && !isFormAnswer(lastMessage.content)) {
    yield* streamDocumentEvidenceResolutionStart(options);
    return;
  }

  // 处理表单答案
  if (lastMessage.role === "user" && isFormAnswer(lastMessage.content)) {
    const formId = getFormAnswerId(lastMessage.content);

    if (formId && isDocumentEvidenceResolutionFormId(formId)) {
      yield* streamDocumentEvidenceResolutionAnswer(messages, options);
      return;
    }

    // Pre-Orchestrator 澄清表单答案 → 整合后直接进入产品工作流
    if (formId && isPreOrchClarificationFormId(formId)) {
      yield* streamPreOrchClarificationAnswer(messages, options);
      return;
    }

    // Pre-Orchestrator 知识图谱冲突表单答案 → 根据用户选择路由
    if (formId && isPreOrchGraphConflictFormId(formId)) {
      yield* streamPreOrchGraphConflictAnswer(messages, options);
      return;
    }

    if (formId && isProductWorkflowResumeFormId(formId)) {
      yield* streamWorkflowResumeAfterFormAnswer(messages, options, formId);
      return;
    }

    yield* streamUserInputIntegration(messages, options);
    return;
  }

  // 新消息先交给 Orchestrator 判断是否属于 checkpoint 恢复。
  yield* streamWithResumeCheckOrPreOrchestrator(messages, options, lastMessage);
}

/**
 * 启动专用证据解决图并把其必填 Question Form 与 interrupt 投影到聊天流。
 */
async function* streamDocumentEvidenceResolutionStart(
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  const context = options.documentEvidenceResolution;
  if (!context || !options.knowledgeGraph) {
    throw new Error("Document evidence resolution context is unavailable.");
  }
  const stream = startDocumentEvidenceResolutionWorkflow({
    conversationId: context.conversationId,
    runId: context.runId,
    workspaceId: options.workspaceId ?? "",
    sourceGraphVersion: context.sourceGraphVersion,
    blockers: context.blockers,
    knowledgeGraph: options.knowledgeGraph,
    modelProfile: options.modelProfile,
    signal: options.signal,
  });
  let next = await stream.next();
  while (!next.done) {
    yield next.value as ConversationStreamEvent;
    next = await stream.next();
  }
  const interrupt = next.value;
  const action = interrupt.value.actionRequests[0];
  const questionForm = action?.args.questionForm;
  if (!questionForm) throw new Error("Evidence resolution form is unavailable.");
  yield { type: "question-form-start", agentType: "orchestrator" };
  yield {
    type: "question-form-complete",
    content: questionForm,
    agentType: "orchestrator",
  };
  yield { type: "human-interrupt", interrupt, agentType: "orchestrator" };
}

/**
 * 将专用表单答案强制转为 supplement DAG，知识图谱写入仍由现有 Executor 完成。
 */
async function* streamDocumentEvidenceResolutionAnswer(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  const answer = options.documentEvidenceAnswer;
  if (!answer || !options.knowledgeGraph) {
    throw new Error("Document evidence resolution interrupt was not resumed.");
  }
  const supplementContext = createDocumentEvidenceSupplementContext(
    answer,
    options.knowledgeGraph,
  );
  const userInputBlock = createFormAnswerUserInputBlock([
    `Resolve persisted PRD evidence blockers for document run ${answer.runId}.`,
    answer.answerText,
    `Resolved OpenQuestion IDs: ${JSON.stringify(supplementContext.answeredOpenQuestionIds)}. These questions are already closed and must not be assigned to an Executor.`,
    `Blocker-to-question mapping: ${JSON.stringify(supplementContext.blockerQuestionMapping)}`,
  ].join("\n\n"));
  yield { type: "user-input-start" };
  yield { type: "user-input-complete", content: userInputBlock };

  const supplementAgentTypes = answer.suggestedAgentTypes.filter(
    isExecutorAgentType,
  );
  const selectedAgentTypes = supplementAgentTypes.length > 0
    ? supplementAgentTypes
    : ["executor-product-discovery" as const];
  for await (const event of streamPlanningAfterUserInput(
    userInputBlock,
    options,
    messages,
    {
      resumeContext: {
        userInputBlock,
        requestAnalysis: createDocumentEvidenceRequestAnalysis(),
        knowledgeGraph: supplementContext.knowledgeGraph,
        forceSupplementPlan: true,
        supplementAgentTypes: selectedAgentTypes,
        supplementSourceTaskIds: [`document-evidence:${answer.runId}`],
        supplementRelatedNodeIds: supplementContext.relatedNodeIds,
        answeredOpenQuestionIds: supplementContext.answeredOpenQuestionIds,
      },
      suppressRestoredRequestAnalysis: true,
    },
  )) {
    yield event;
    if (
      event.type === "complete" &&
      isAcceptedDocumentEvidenceWorkflowResult(event.result)
    ) {
      yield {
        type: "document-evidence-resolution-complete",
        runId: answer.runId,
        workspaceId: options.workspaceId ?? "",
      };
    }
  }
}

/**
 * 在补证答案进入 Planner 前精确关闭其关联的活动问题，并从 Executor 映射中移除问题 ID。
 * Resolver 负责语义关联；此处只对图中存在的完整 ID 做确定性交集。
 */
export function createDocumentEvidenceSupplementContext(
  answer: NonNullable<ConversationStreamOptions["documentEvidenceAnswer"]>,
  knowledgeGraph: ProductKnowledgeGraph,
) {
  const activeOpenQuestionIds = new Set(
    knowledgeGraph.open_questions.map((question) => question.id),
  );
  const validRelatedNodeIds = new Set([
    ...knowledgeGraph.entities.map((entity) => entity.id),
    ...knowledgeGraph.risks.map((risk) => risk.id),
    ...knowledgeGraph.open_questions.map((question) => question.id),
  ]);
  const relatedNodeIds = answer.relatedNodeIds.filter((nodeId) =>
    validRelatedNodeIds.has(nodeId),
  );
  const answeredOpenQuestionIds = relatedNodeIds.filter((nodeId) =>
    activeOpenQuestionIds.has(nodeId),
  );
  const answeredIdSet = new Set(answeredOpenQuestionIds);
  return {
    relatedNodeIds,
    answeredOpenQuestionIds,
    knowledgeGraph:
      resolveAnsweredGraphOpenQuestions(
        knowledgeGraph,
        answeredOpenQuestionIds,
      ) ?? knowledgeGraph,
    blockerQuestionMapping: answer.resolution.questions.map((question) => ({
      questionId: question.id,
      blockerIndexes: question.blockerIndexes,
      relatedNodeIds: question.relatedNodeIds.filter(
        (nodeId) => !answeredIdSet.has(nodeId),
      ),
    })),
  };
}

/**
 * 专用补证表单已完成语义解析，直接构造可信业务请求，避免 Request Agent 二次改写答案。
 */
export function createDocumentEvidenceRequestAnalysis(): RequestAnalysis {
  return {
    business_model: [
      {
        index: 1,
        user_goal:
          "Resolve persisted PRD evidence blockers with the submitted authoritative answers.",
        goal_constraints: [
          "Update only the related product knowledge graph facts and decisions.",
        ],
        missing_information: [],
        covered_user_input_indexes: [1],
      },
    ],
    questions: [],
    chitchat: [],
  };
}

/**
 * 新消息统一通过 Pre-Orchestrator 完成恢复判断和意图分类。
 * Pre-Orchestrator 会优先检测 checkpoint 恢复需求，再按意图分类路由。
 */
async function* streamWithResumeCheckOrPreOrchestrator(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
  lastMessage: ChatMessage,
): AsyncGenerator<ConversationStreamEvent> {
  yield* streamWithPreOrchestrator(messages, options, lastMessage);
}

/**
 * 通过 Orchestrator Agent 的 Pre-Orchestrator SubAgent 完成意图分类或恢复判断，并根据结果路由。
 */
async function* streamWithPreOrchestrator(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
  lastMessage: ChatMessage,
): AsyncGenerator<ConversationStreamEvent> {
  const orchStream = streamOrchestratorPreCheck({
    modelProfile: options.modelProfile,
    userMessage: lastMessage.content ?? "",
    productContext: options.productContext,
    knowledgeGraph: options.knowledgeGraph,
    workspaceId: options.workspaceId,
    hasExistingProject: hasExistingProject(options.knowledgeGraph),
    workflowThreadId: options.workflowThreadId,
    recentMessages: messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content ?? "",
    })),
    signal: options.signal,
  });

  let preOrchResult: PreOrchResult;
  try {
    let next = await orchStream.next();
    while (!next.done) {
      yield next.value as ConversationStreamEvent;
      next = await orchStream.next();
    }
    preOrchResult = next.value;
  } catch (error) {
    yield {
      type: "error",
      error: `意图分类失败：${getErrorMessage(error)}`,
      agentType: "orchestrator",
    };
    yield {
      type: "agent-status",
      agentType: "orchestrator",
      status: "completed",
      phase: "planning",
    };
    yield* streamNormalProjectFlow(messages, options);
    return;
  }

  // 恢复判断优先于意图分类：Pre-Orchestrator 判定需要从 checkpoint 恢复中断的工作流。
  if (preOrchResult.decision === "RESUME_WORKFLOW") {
    let emitted = false;
    for await (const event of streamWorkflowCheckpointResume(options, messages)) {
      emitted = true;
      yield event;
    }
    // 如果 checkpoint 恢复没有产出任何事件，回退到普通路由。
    if (emitted) return;
  }

  if (preOrchResult.decision === "HANDOFF_CHAT") {
    yield* streamChatOnlyFlow(messages, options);
    return;
  }

  if (preOrchResult.decision === "ASK_CLARIFICATION") {
    yield* streamOrchClarificationForm(preOrchResult, options);
    return;
  }

  if (preOrchResult.decision === "CHECK_GRAPH_CONFLICT") {
    yield* streamOrchGraphConflictForm(preOrchResult, options);
    return;
  }

  yield* streamNormalProjectFlow(messages, options);
}

/**
 * Pre-Orchestrator 澄清表单答案的处理路径。
 * 将用户答复整合为 user_input 后进入产品工作流。
 */
async function* streamPreOrchClarificationAnswer(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  yield {
    type: "agent-status",
    agentType: "orchestrator",
    status: "started",
    phase: "planning",
  };
  yield {
    type: "reasoning",
    content: "收到澄清问题答复，将整合信息后进入产品工作流。",
    agentType: "orchestrator",
  };
  yield {
    type: "agent-status",
    agentType: "orchestrator",
    status: "completed",
    phase: "planning",
  };

  yield* streamUserInputIntegration(messages, options);
}

/**
 * 闲聊模式：使用纯闲聊提示词驱动 Conversation Agent 进行自然对话。
 */
async function* streamChatOnlyFlow(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  for await (const event of streamAgentEvents(
    toLangChainMessages(messages),
    { ...options, mode: "chat" },
  )) {
    yield event;
  }
}

/**
 * Orch 澄清问题表单：直接输出 question-form 事件，不调用 Conversation Agent。
 * 仅当 intent 为 new_project 或 project_evolution 时生效，闲聊意图不会进入此路径。
 */
async function* streamOrchClarificationForm(
  result: PreOrchResult,
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  // 防御性检查：非产品意图不应输出 question-form
  if (result.intent === "casual_chat") {
    yield* streamChatOnlyFlow([], options);
    return;
  }

  const formContent = formatPreOrchQuestionForm(result);

  // 简短引导语
  if (result.form_description) {
    yield {
      type: "text",
      content: result.form_description,
      agentType: "orchestrator",
    };
  }

  yield {
    type: "question-form-start",
    agentType: "orchestrator",
  };
  // 给前端留出渲染加载卡片的时间，避免与 complete 事件在同一 SSE chunk 中被 React 批处理合并。
  await new Promise((resolve) => setTimeout(resolve, 80));
  yield {
    type: "question-form-complete",
    content: formContent,
    agentType: "orchestrator",
  };
}

/**
 * Pre-Orchestrator 知识图谱冲突表单：当 Pre-Orchestrator 检测到新项目与已有图谱冲突时输出。
 */
async function* streamOrchGraphConflictForm(
  _result: PreOrchResult,
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  const formContent = formatPreOrchGraphConflictForm();

  yield {
    type: "question-form-start",
    agentType: "orchestrator",
  };
  await new Promise((resolve) => setTimeout(resolve, 80));
  yield {
    type: "question-form-complete",
    content: formContent,
    agentType: "orchestrator",
  };
}

/**
 * 处理 Pre-Orchestrator 知识图谱冲突表单答案。
 * "创建新工作区" → 提示用户新建工作区并停止。
 * "替换当前图谱" → 直接进入产品工作流。
 */
async function* streamPreOrchGraphConflictAnswer(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  const lastMessage = messages.at(-1);
  const action = parseGraphConflictAction(lastMessage?.content ?? "");

  if (action === "create_new_workspace") {
    yield {
      type: "text",
      content:
        "当前工作区的知识图谱已保留。请在工作区列表中新建一个工作区，然后在新工作区中开始这个新项目。",
      agentType: "orchestrator",
    };
    return;
  }

  yield* streamUserInputIntegration(messages, options);
}

/**
 * 正常项目模式：运行 Conversation Agent 完成 user_input 分解并进入产品工作流。
 */
async function* streamNormalProjectFlow(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
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
    workflowAnswerResolution: options.workflowAnswerResolution,
  });
  const latestUserMessage = messages.at(-1);
  const acceptsCurrentResult = Boolean(
    latestUserMessage &&
      isProductWorkflowAcceptanceAnswer(latestUserMessage.content),
  );

  if (acceptsCurrentResult && !resumeContext?.productWorkflow) {
    yield {
      type: "error",
      error:
        "无法完成确认：服务端未找到对应的持久化产品工作流结果。请刷新后重试，不会将该确认作为新请求处理。",
      agentType: "conversation_confirmation",
      terminal: true,
    };
    return;
  }

  if (!resumeContext) {
    yield* streamUserInputIntegration(messages, options);
    return;
  }

  if (acceptsCurrentResult && resumeContext.productWorkflow) {
    const result = {
      ...resumeContext.productWorkflow,
      status: "completed" as const,
      confirmation_message: "用户已确认接受当前产品知识图谱结果。",
    };
    yield { type: "complete", result };
    yield {
      type: "text",
      content:
        "本轮产品工作流已正式结束，产品知识图谱结果已确认并归档。PRD、线框图等最终交付物需在文档规划页单独生成。",
      agentType: "conversation_confirmation",
    };
    return;
  }

  if (
    latestUserMessage &&
    resumeContext.productWorkflow &&
    isProductWorkflowOptionalStopAnswer(latestUserMessage.content)
  ) {
    const knowledgeGraph = updateProductContextMetadata({
      knowledgeGraph: resumeContext.productWorkflow.knowledge_graph_update,
      currentState: "stable",
      descriptionEntry:
        "User skipped optional follow-up questions and accepted the current result with its recorded review issues.",
    });
    const result: ProductWorkflowResult = {
      ...resumeContext.productWorkflow,
      status: "completed",
      proposal_questions: [],
      knowledge_graph_update: knowledgeGraph,
      confirmation_message:
        "用户已跳过可选优化问题，并接受当前已有成果及已记录的审查问题。",
    };
    yield { type: "knowledge-graph-update", knowledgeGraph };
    yield {
      type: "text",
      content: formatProductWorkflowBlock(result),
      agentType: "critique",
    };
    yield { type: "complete", result };
    yield {
      type: "text",
      content:
        "本轮产品工作流已正式结束。你已选择不再继续补充可选优化问题，当前成果及已记录的审查问题均已归档。",
      agentType: "conversation_confirmation",
    };
    return;
  }

  const userInputBlock = createFormAnswerUserInputBlock(
    latestUserMessage?.content ?? "",
  );

  yield* streamPlanningAfterUserInput(userInputBlock, options, messages, {
    resumeContext,
    suppressRestoredRequestAnalysis: true,
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
    resumeFromCheckpoint?: boolean;
  } = {},
): AsyncGenerator<ConversationStreamEvent> {
  try {
    const resumeContext = resumeOptions.resumeFromCheckpoint
      ? undefined
      : resumeOptions.resumeContext ??
        createWorkflowResumeContextFromMessages({
          messages,
          knowledgeGraph: options.knowledgeGraph,
        }) ??
        undefined;

    for await (const event of streamWorkflowGraph({
      modelProfile: options.modelProfile,
      workspaceId: options.workspaceId,
      productContext: options.productContext,
      contextSource: options.contextSource,
      knowledgeGraph: options.knowledgeGraph,
      userInputBlock,
      workflowThreadId: options.workflowThreadId,
      resumeFromCheckpoint: resumeOptions.resumeFromCheckpoint,
      resumeContext,
      retryFailure: options.workflowRetryFailure,
      signal: options.signal,
    })) {
      if (
        resumeOptions.suppressRestoredRequestAnalysis &&
        event.type === "request-analysis-complete"
      ) {
        continue;
      }

      if (
        event.type === "workflow-round-start" ||
        event.type === "agent-status" ||
        event.type === "reasoning" ||
        event.type === "request-analysis-start" ||
        event.type === "request-analysis-complete" ||
        event.type === "subagent-start" ||
        event.type === "subagent-thinking" ||
        event.type === "subagent-result" ||
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
        // Critique 的结构化状态是唯一完成依据，表单是否存在只决定交互形式。
        const proposalForm = formatProductWorkflowProposalQuestionForm(event.result);
        const shouldFinalize = isAcceptedWorkflowResult(event.result);
        const questionForm = shouldFinalize
          ? null
          : proposalForm ??
            formatProductWorkflowConfirmationQuestionForm(event.result);

        yield { type: "complete", result: event.result };

        if (shouldFinalize) {
          yield {
            type: "text",
            content:
              "本轮产品工作流已正式结束，相关 Executor Agent 的产品知识图谱修正/补充已完成并归档。PRD、线框图等最终交付物需在文档规划页单独生成。",
            agentType: "conversation_confirmation",
          };
          continue;
        }
        // Planner 只发起确认/补充请求，由 Conversation Agent 面向用户提问。
        yield {
          type: "text",
          content: proposalForm
            ? "Planner SubAgent 汇总了需要补充确认的信息，我需要你先回答这些问题。"
            : "Critique Agent 发现本轮结果仍需修正，我需要你确认下一步处理方式。",
          agentType: "conversation_confirmation",
        };
        yield {
          type: "question-form-start",
          agentType: "conversation_confirmation",
        };
        // 给前端留出渲染加载卡片的时间，避免与 complete 事件在同一 SSE chunk 中被 React 批处理合并。
        await new Promise((resolve) => setTimeout(resolve, 80));
        yield {
          type: "question-form-complete",
          content: questionForm!,
          agentType: "conversation_confirmation",
        };
        yield* streamHumanInterruptForQuestionForm(
          questionForm!,
          "conversation_confirmation",
          options,
        );
      }
    }
  } catch (error) {
    if (isExecutorRetryRequiredError(error)) {
      const sameTaskRetryable = isSameTaskExecutorRetryable(error.details);
      yield {
        type: "error",
        error: [
          `来源：${error.displayName} / ${error.taskId}`,
          sameTaskRetryable
            ? "原因：requires_executor_retry（Executor 当前运行未能完成）"
            : "原因：invalid_plan_reference（计划引用的图谱目标已失效，原任务无法重放修复）",
          `关键详情：${error.details}`,
          ...(sameTaskRetryable
            ? []
            : ["下一步：请重新启动“解决证据阻断”流程生成新的补充计划。"]),
        ].join("\n"),
        agentType: error.agentType,
        ...(sameTaskRetryable
          ? {
              retryAction: {
                type: "resume_executor_task" as const,
                taskId: error.taskId,
                agentType: error.agentType,
              },
            }
          : {}),
        terminal: true,
      };
      return;
    }
    if (isExecutorHumanInputRequiredError(error)) {
      const questionForm = formatExecutorHumanInputQuestionForm(
        error.interrupt,
      );
      yield {
        type: "text",
        content:
          "Planner SubAgent 暂停了当前 Executor 批次，需要先由你补充阻塞信息后再继续运行。",
        agentType: "conversation_confirmation",
      };
      yield {
        type: "question-form-start",
        agentType: "conversation_confirmation",
      };
      // 给前端留出渲染加载卡片的时间，避免与 complete 事件在同一 SSE chunk 中被 React 批处理合并。
      await new Promise((resolve) => setTimeout(resolve, 80));
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
      terminal: true,
    };
  }
}

/**
 * 从失败任务的 checkpoint 定点恢复；checkpoint 丢失时才使用消息中的已有 DAG 兜底。
 */
async function* streamWorkflowExecutorRetry(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  const retry = options.workflowRetry;
  if (!retry) return;

  let canResumeCheckpoint = false;
  if (options.workflowThreadId) {
    try {
      canResumeCheckpoint = await hasRetryableWorkflowTaskCheckpoint({
        workflowThreadId: options.workflowThreadId,
        taskId: retry.taskId,
      });
    } catch {
      // checkpoint 查询失败时继续使用已持久化消息恢复，不要求用户重新填写表单。
    }
  }

  if (canResumeCheckpoint) {
    yield* streamPlanningAfterUserInput(
      createEmptyUserInputBlock(),
      options,
      [],
      { resumeFromCheckpoint: true },
    );
    return;
  }

  const resumeContext =
    createWorkflowExecutorRetryResumeContextFromMessages({
      messages,
      knowledgeGraph: options.knowledgeGraph,
      taskId: retry.taskId,
    });
  if (!resumeContext) {
    yield {
      type: "error",
      error: `无法恢复 ${retry.taskId}：当前 checkpoint 与历史 DAG 中没有匹配的未完成任务。`,
      agentType: "orchestrator",
      terminal: true,
    };
    return;
  }

  yield* streamPlanningAfterUserInput(
    resumeContext.userInputBlock ?? createEmptyUserInputBlock(),
    options,
    messages,
    {
      resumeContext,
      suppressRestoredRequestAnalysis: true,
    },
  );
}

/**
 * 根据 Conversation Agent 的恢复意图优先从 checkpoint 继续，空跑时再使用历史 DAG 兜底。
 */
async function* streamWorkflowCheckpointResume(
  options: ConversationStreamOptions,
  messages: ChatMessage[],
): AsyncGenerator<ConversationStreamEvent> {
  let emittedCheckpointEvent = false;
  let checkpointError: ConversationStreamEvent | null = null;
  for await (const event of streamPlanningAfterUserInput(
    createEmptyUserInputBlock(),
    options,
    [],
    { resumeFromCheckpoint: true },
  )) {
    if (!emittedCheckpointEvent && event.type === "error") {
      checkpointError = event;
      continue;
    }

    if (checkpointError) {
      yield checkpointError;
      checkpointError = null;
    }
    emittedCheckpointEvent = true;
    yield event;
  }

  if (emittedCheckpointEvent) return;

  const resumeContext = createWorkflowContinuationResumeContextFromMessages({
    messages,
    knowledgeGraph: options.knowledgeGraph,
  });
  if (!resumeContext) {
    if (checkpointError) yield checkpointError;
    return;
  }

  yield* streamPlanningAfterUserInput(
    createEmptyUserInputBlock(),
    options,
    messages,
    {
      resumeContext,
      suppressRestoredRequestAnalysis: true,
    },
  );
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
/**
 * 判断 Critique 结果是否满足正式结束条件。
 */
export function isAcceptedWorkflowResult(
  result: ProductWorkflowResult,
): boolean {
  return (
    result.status === "completed" &&
    (result.review.retry_task_ids?.length ?? 0) === 0 &&
    ![...(result.review.issues ?? []), ...(result.knowledge_graph_review?.issues ?? [])].some(
      (issue) => issue.severity === "error",
    )
  );
}

/**
 * 文档补证必须通过更严格的证据消费门禁，不能把普通完成状态当作验收。
 */
export function isAcceptedDocumentEvidenceWorkflowResult(
  result: ProductWorkflowResult,
): boolean {
  return (
    isAcceptedWorkflowResult(result) &&
    ![
      ...(result.review.issues ?? []),
      ...(result.knowledge_graph_review?.issues ?? []),
    ].some((issue) => issue.code === "UNCONSUMED_EVIDENCE")
  );
}

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
 * 压缩会话上下文，避免把 LangChain Message 实例的内部状态写入汇总文件。
 */
function compactConversationMessages(messages: BaseMessage[]): Array<{
  content: unknown;
  type: string;
}> {
  return messages.map((message) => ({
    content: message.content,
    type: getMessageType(message),
  }));
}

/**
 * 读取 LangChain 消息类型，兼容不同版本的公开/内部方法差异。
 */
function getMessageType(message: BaseMessage): string {
  const maybeTypedMessage = message as BaseMessage & {
    _getType?: () => string;
    getType?: () => string;
  };
  if (typeof maybeTypedMessage.getType === "function") {
    return maybeTypedMessage.getType();
  }
  if (typeof maybeTypedMessage._getType === "function") {
    return maybeTypedMessage._getType();
  }

  return message.constructor.name;
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
export function createFormAnswerUserInputBlock(content: string): string {
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

/**
 * 将普通“继续/恢复”指令包装成合法 user_input，直接进入 workflow resume。
 */
function createEmptyUserInputBlock(): string {
  return `<user-input>\n${JSON.stringify(
    {
      user_input: [],
    },
    null,
    2,
  )}\n</user-input>`;
}

