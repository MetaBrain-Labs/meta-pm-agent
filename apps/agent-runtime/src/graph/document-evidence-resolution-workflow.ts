/**
 * 文档证据阻断解决 LangGraph
 *
 * 独立于产品主图和文档生成图，负责加载可信阻断上下文、委托 Orchestrator 的
 * Resolver SubAgent 生成必填问题、释放 interrupt，并在恢复后归一化用户答案。
 *
 * Responsibilities:
 * - 实现 load_resolution_context -> orchestrator_evidence_resolution -> request_required_answers -> normalize_answers
 * - 使用稳定 document-evidence 线程持久化 interrupt/resume
 * - 将表单答案与 blocker/Executor 建议映射为后续 supplement DAG 上下文
 *
 * Notes:
 * - 本图不直接修改知识图谱；补图谱由现有产品 LangGraph Executor 完成。
 */

import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  START,
  StateGraph,
  getWriter,
  interrupt,
  isInterrupted,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type { ModelUsageProfile, ProductKnowledgeGraph } from "@repo/shared";
import {
  DOCUMENT_EVIDENCE_FORM_PREFIX,
  streamOrchestratorEvidenceResolution,
  type DocumentEvidenceBlocker,
  type DocumentEvidenceResolution,
} from "../agents/product-workflow/orchestrator-agent/document-evidence-resolver-subagent";
import type { ProductWorkflowStreamEvent } from "../agents/product-workflow/types";
import {
  getModelProfileFromRunnableConfig,
  MODEL_PROFILE_RUN_CONFIG_KEY,
} from "../agents/common/model-profile";
import type {
  HumanInTheLoopInterrupt,
  HumanInTheLoopRequest,
  HumanInTheLoopResponse,
} from "./human-in-the-loop";
import { getWorkflowCheckpointer } from "./workflow-checkpointer";

/** 专用证据解决图的启动输入。 */
export interface DocumentEvidenceResolutionWorkflowInput {
  conversationId: string;
  runId: string;
  workspaceId: string;
  sourceGraphVersion: number;
  blockers: DocumentEvidenceBlocker[];
  knowledgeGraph: ProductKnowledgeGraph;
  modelProfile?: ModelUsageProfile;
  signal?: AbortSignal;
}

/** interrupt 恢复后交给产品 supplement DAG 的归一化结果。 */
export interface DocumentEvidenceAnswerResult {
  runId: string;
  sourceGraphVersion: number;
  answerText: string;
  resolution: DocumentEvidenceResolution;
  suggestedAgentTypes: string[];
  relatedNodeIds: string[];
}

export type DocumentEvidenceResolutionStreamEvent =
  | ProductWorkflowStreamEvent
  | {
      type: "document-evidence-resolution-plan";
      runId: string;
      resolution: DocumentEvidenceResolution;
    };

const DocumentEvidenceResolutionState = Annotation.Root({
  conversationId: Annotation<string>(),
  runId: Annotation<string>(),
  workspaceId: Annotation<string>(),
  sourceGraphVersion: Annotation<number>(),
  blockers: Annotation<DocumentEvidenceBlocker[]>(),
  knowledgeGraph: Annotation<ProductKnowledgeGraph>(),
  resolution: Annotation<DocumentEvidenceResolution | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),
  response: Annotation<HumanInTheLoopResponse | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),
  answerResult: Annotation<DocumentEvidenceAnswerResult | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),
});

type DocumentEvidenceResolutionStateValue =
  typeof DocumentEvidenceResolutionState.State;

let durableGraphPromise: Promise<ReturnType<typeof createGraph>> | null = null;

/**
 * 启动专用流程并把 Resolver 的流事件透传给聊天流；返回 LangGraph interrupt。
 */
export async function* startDocumentEvidenceResolutionWorkflow(
  input: DocumentEvidenceResolutionWorkflowInput,
): AsyncGenerator<
  DocumentEvidenceResolutionStreamEvent,
  HumanInTheLoopInterrupt,
  void
> {
  const graph = await getDurableGraph();
  const threadId = createDocumentEvidenceResolutionThreadId(input);
  const stream = await graph.stream(
    {
      conversationId: input.conversationId,
      runId: input.runId,
      workspaceId: input.workspaceId,
      sourceGraphVersion: input.sourceGraphVersion,
      blockers: input.blockers,
      knowledgeGraph: input.knowledgeGraph,
    },
    createRunConfig(input, threadId),
  );

  for await (const chunk of stream) {
    if (Array.isArray(chunk) && chunk[0] === "custom") {
      yield chunk[1] as DocumentEvidenceResolutionStreamEvent;
      continue;
    }
    const value = Array.isArray(chunk) && chunk[0] === "values" ? chunk[1] : chunk;
    if (isInterrupted<HumanInTheLoopRequest>(value)) {
      const graphInterrupt = value[INTERRUPT][0];
      if (graphInterrupt?.id && graphInterrupt.value) {
        return {
          id: graphInterrupt.id,
          threadId,
          value: graphInterrupt.value,
        };
      }
    }
  }

  throw new Error("Document evidence resolution completed without an interrupt.");
}

/**
 * 恢复专用 interrupt 并返回已归一化的答案上下文。
 */
export async function resumeDocumentEvidenceResolutionWorkflow({
  threadId,
  response,
}: {
  threadId: string;
  response: HumanInTheLoopResponse;
}): Promise<DocumentEvidenceAnswerResult> {
  if (!threadId.startsWith("document-evidence:")) {
    throw new Error("Invalid document evidence resolution thread.");
  }
  const graph = await getDurableGraph();
  const stream = await graph.stream(new Command({ resume: response }), {
    configurable: { thread_id: threadId },
    durability: "sync" as const,
    streamMode: "values" as const,
  });
  let answerResult: DocumentEvidenceAnswerResult | null = null;
  for await (const chunk of stream) {
    if (chunk?.answerResult) answerResult = chunk.answerResult;
  }
  if (!answerResult) {
    throw new Error("Document evidence resolution resumed without answers.");
  }
  return answerResult;
}

/**
 * 构造稳定线程，保证刷新与重复提交不会创建另一条 interrupt 链。
 */
export function createDocumentEvidenceResolutionThreadId({
  conversationId,
  runId,
}: Pick<DocumentEvidenceResolutionWorkflowInput, "conversationId" | "runId">) {
  return `document-evidence:${conversationId}:${runId}`;
}

/**
 * 将 Resolver 结果格式化为前端现有 Question Form 协议。
 */
export function formatDocumentEvidenceQuestionForm({
  runId,
  resolution,
}: {
  runId: string;
  resolution: DocumentEvidenceResolution;
}): string {
  return `<question-form id="${DOCUMENT_EVIDENCE_FORM_PREFIX}-${escapeAttribute(
    runId,
  )}" title="解决 PRD 证据阻断">\n${JSON.stringify(
    {
      description: resolution.summary,
      questions: resolution.questions.map((question) => ({
        id: question.id,
        label: question.label,
        type: question.type,
        required: true,
        ...(question.placeholder ? { placeholder: question.placeholder } : {}),
        ...(question.options ? { options: question.options } : {}),
      })),
      submitLabel: "提交并补充产品知识图谱",
    },
    null,
    2,
  )}\n</question-form>`;
}

/**
 * 判断表单是否属于文档证据解决流程。
 */
export function isDocumentEvidenceResolutionFormId(formId: string): boolean {
  return formId.startsWith(`${DOCUMENT_EVIDENCE_FORM_PREFIX}-`);
}

/**
 * 组装专用图节点与边，使用调用方提供的持久化 checkpointer。
 */
function createGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(DocumentEvidenceResolutionState)
    .addNode("load_resolution_context", loadResolutionContextNode)
    .addNode("orchestrator_evidence_resolution", orchestratorEvidenceResolutionNode)
    .addNode("request_required_answers", requestRequiredAnswersNode)
    .addNode("normalize_answers", normalizeAnswersNode)
    .addEdge(START, "load_resolution_context")
    .addEdge("load_resolution_context", "orchestrator_evidence_resolution")
    .addEdge("orchestrator_evidence_resolution", "request_required_answers")
    .addEdge("request_required_answers", "normalize_answers")
    .addEdge("normalize_answers", END)
    .compile({ checkpointer });
}

/**
 * 延迟创建并复用可持久化图实例。
 */
function getDurableGraph() {
  durableGraphPromise ??= getWorkflowCheckpointer().then(createGraph);
  return durableGraphPromise;
}

/**
 * 校验服务端恢复的可信 run、workspace 与 blocker 上下文。
 */
function loadResolutionContextNode(state: DocumentEvidenceResolutionStateValue) {
  if (!state.runId || !state.workspaceId || state.blockers.length === 0) {
    throw new Error("Document evidence resolution requires persisted blockers.");
  }
  return {};
}

/**
 * 委托 Orchestrator 的唯一 Resolver SubAgent 生成结构化问题。
 */
async function orchestratorEvidenceResolutionNode(
  state: DocumentEvidenceResolutionStateValue,
  config?: LangGraphRunnableConfig,
) {
  const writer = getWriter(config);
  const stream = streamOrchestratorEvidenceResolution({
    runId: state.runId,
    workspaceId: state.workspaceId,
    sourceGraphVersion: state.sourceGraphVersion,
    blockers: state.blockers,
    knowledgeGraph: state.knowledgeGraph,
    modelProfile: getModelProfileFromRunnableConfig(config),
    signal: config?.signal,
  });
  let next = await stream.next();
  while (!next.done) {
    writer?.(next.value);
    next = await stream.next();
  }
  return { resolution: next.value };
}

/**
 * 释放包含全部必填问题的 LangGraph interrupt。
 */
function requestRequiredAnswersNode(
  state: DocumentEvidenceResolutionStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.resolution) throw new Error("Evidence questions were not generated.");
  const questionForm = formatDocumentEvidenceQuestionForm({
    runId: state.runId,
    resolution: state.resolution,
  });
  const request: HumanInTheLoopRequest = {
    actionRequests: [
      {
        name: "question_form",
        args: {
          questionForm,
          formId: `${DOCUMENT_EVIDENCE_FORM_PREFIX}-${state.runId}`,
          agentType: "orchestrator",
        },
        description: "Required facts or decisions are needed to resolve persisted PRD evidence blockers.",
      },
    ],
    reviewConfigs: [{ allowedDecisions: ["respond"] }],
  };
  getWriter(config)?.({
    type: "document-evidence-resolution-plan",
    runId: state.runId,
    resolution: state.resolution,
  });
  return { response: interrupt(request) };
}

/**
 * 把 respond 决策归一化为 supplement DAG 可消费的答案上下文。
 */
function normalizeAnswersNode(state: DocumentEvidenceResolutionStateValue) {
  if (!state.resolution || !state.response) {
    throw new Error("Evidence resolution answers are missing.");
  }
  const answerText = state.response.decisions.flatMap((decision) =>
    decision.type === "respond" && decision.message.trim()
      ? [decision.message.trim()]
      : [],
  ).join("\n");
  if (!answerText) throw new Error("Evidence resolution requires a response.");
  return {
    answerResult: {
      runId: state.runId,
      sourceGraphVersion: state.sourceGraphVersion,
      answerText,
      resolution: state.resolution,
      suggestedAgentTypes: [
        ...new Set(
          state.resolution.questions.flatMap(
            (question) => question.suggestedAgentTypes,
          ),
        ),
      ],
      relatedNodeIds: [
        ...new Set(
          state.resolution.questions.flatMap((question) => question.relatedNodeIds),
        ),
      ],
    },
  };
}

/**
 * 构造稳定线程、同步 durability 与模型快照配置。
 */
function createRunConfig(
  input: DocumentEvidenceResolutionWorkflowInput,
  threadId: string,
) {
  return {
    signal: input.signal,
    durability: "sync" as const,
    streamMode: ["custom", "values"] as Array<"custom" | "values">,
    configurable: {
      thread_id: threadId,
      [MODEL_PROFILE_RUN_CONFIG_KEY]: input.modelProfile,
    },
  };
}

/**
 * 转义 Question Form 标签属性。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
