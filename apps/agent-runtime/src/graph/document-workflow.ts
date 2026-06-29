/**
 * 文档生成 LangGraph 工作流
 *
 * 构建独立于产品知识图谱生产链路的 Document Agent 图，固定阶段为
 * parseKg → normalizeGraph → buildSectionDossiers → draftSection →
 * crossCheck → humanReview → exportPrd。图状态由 checkpointer 保存，
 * 便于后续恢复、回放与 thread 级连续性扩展。
 *
 * Responsibilities:
 * - 定义文档生成图输入、输出和流事件
 * - 组装 Document Agent PRD 工作流节点
 * - 将 Deep Agents write_todos/task 事件透传给 API 后台任务
 *
 * Notes:
 * - 当前 PRD 后台生成不主动打断等待人工审核；humanReview 节点先做自动通过，
 *   后续可在该节点接入 interrupt/resume 表单。
 */

import {
  END,
  MemorySaver,
  START,
  StateGraph,
  getWriter,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type {
  DocumentGenerationResult,
  DocumentKind,
  DocumentSectionDraft,
  DocumentWorkflowStage,
  DocumentTodo,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
} from "@repo/shared";
import {
  streamPrdDocumentAgent,
  type DocumentAgentStreamEvent,
} from "../agents/document-agent/agent";
import { getWorkflowCheckpointer } from "./workflow-checkpointer";
import {
  DocumentWorkflowGraphState,
  type DocumentCrossCheck,
  type DocumentSectionDossier,
  type DocumentWorkflowGraphSnapshot,
  type DocumentWorkflowGraphStateValue,
} from "./document-workflow-state";

/**
 * 文档生成图输入。
 */
export interface DocumentWorkflowInput {
  workspaceId: string;
  runId: string;
  kind: DocumentKind;
  graph: DocumentWorkflowGraphSnapshot;
  workflowThreadId?: string;
  signal?: AbortSignal;
}

/**
 * 文档生成图流式事件。
 */
export type DocumentWorkflowStreamEvent =
  | DocumentAgentStreamEvent
  | {
      type: "document-stage";
      stage: DocumentWorkflowStage;
      status: "started" | "completed";
      label: string;
    }
  | {
      type: "document-complete";
      result: DocumentGenerationResult;
    };

/**
 * 文档生成图的最终结果。
 */
export interface DocumentWorkflowResult {
  result: DocumentGenerationResult;
  todos: DocumentTodo[];
}

/**
 * 本地内存图实例，供无持久化场景和类型推断使用。
 */
export const documentGraph = createDocumentWorkflowGraph(new MemorySaver());

let durableDocumentGraphPromise: Promise<typeof documentGraph> | null = null;

const STAGE_LABELS: Record<DocumentWorkflowStage, string> = {
  parseKg: "读取当前知识图谱",
  normalizeGraph: "规范化图谱结构",
  buildSectionDossiers: "构建 PRD 章节材料",
  draftSection: "Document Agent 生成 PRD",
  crossCheck: "交叉检查文档一致性",
  humanReview: "人工审核节点",
  exportPrd: "导出 PRD 文档",
};

/**
 * 创建 Document Agent 独立 LangGraph。
 */
function createDocumentWorkflowGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(DocumentWorkflowGraphState)
    .addNode("parseKg", parseKgNode)
    .addNode("normalizeGraph", normalizeGraphNode)
    .addNode("buildSectionDossiers", buildSectionDossiersNode)
    .addNode("draftSection", draftSectionNode)
    .addNode("crossCheck", crossCheckNode)
    .addNode("humanReview", humanReviewNode)
    .addNode("exportPrd", exportPrdNode)
    .addEdge(START, "parseKg")
    .addEdge("parseKg", "normalizeGraph")
    .addEdge("normalizeGraph", "buildSectionDossiers")
    .addEdge("buildSectionDossiers", "draftSection")
    .addEdge("draftSection", "crossCheck")
    .addEdge("crossCheck", "humanReview")
    .addEdge("humanReview", "exportPrd")
    .addEdge("exportPrd", END)
    .compile({ checkpointer });
}

/**
 * 获取带持久化 checkpointer 的文档生成图。
 */
async function getDurableDocumentWorkflowGraph(): Promise<typeof documentGraph> {
  durableDocumentGraphPromise ??= getWorkflowCheckpointer().then((checkpointer) =>
    createDocumentWorkflowGraph(checkpointer),
  );
  return durableDocumentGraphPromise;
}

/**
 * 流式运行文档生成图。
 */
export async function* streamDocumentWorkflow(
  input: DocumentWorkflowInput,
): AsyncGenerator<DocumentWorkflowStreamEvent, DocumentWorkflowResult, void> {
  const workflowGraph = await getDurableDocumentWorkflowGraph();
  const stream = await workflowGraph.stream(
    createDocumentWorkflowInitialState(input),
    createDocumentWorkflowRunConfig(input),
  );
  let result: DocumentGenerationResult | null = null;
  let todos: DocumentTodo[] = [];

  for await (const event of stream) {
    const typedEvent = event as DocumentWorkflowStreamEvent;
    if (typedEvent.type === "document-complete") {
      result = typedEvent.result;
    }
    if (typedEvent.type === "todo-update") {
      todos = typedEvent.todos;
    }
    yield typedEvent;
  }

  if (!result) {
    throw new Error("Document workflow completed without a document result.");
  }

  return { result, todos };
}

/**
 * 创建文档生成图初始状态。
 */
function createDocumentWorkflowInitialState(input: DocumentWorkflowInput) {
  return {
    workspaceId: input.workspaceId,
    runId: input.runId,
    kind: input.kind,
    sourceGraph: input.graph,
  };
}

/**
 * 创建 LangGraph 运行配置。
 */
function createDocumentWorkflowRunConfig(input: DocumentWorkflowInput) {
  return {
    signal: input.signal,
    streamMode: "custom" as const,
    durability: "sync" as const,
    configurable: {
      thread_id:
        input.workflowThreadId ??
        createDocumentWorkflowThreadId({
          workspaceId: input.workspaceId,
          runId: input.runId,
          kind: input.kind,
        }),
    },
  };
}

/**
 * 构造文档生成工作流 thread_id。
 */
export function createDocumentWorkflowThreadId({
  workspaceId,
  runId,
  kind,
}: {
  workspaceId: string;
  runId: string;
  kind: DocumentKind;
}): string {
  return `document:${workspaceId}:${kind}:${runId}`;
}

/**
 * 读取并校验输入知识图谱。
 */
function parseKgNode(
  state: DocumentWorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  emitStage(config, "parseKg", "started");
  if (state.kind !== "prd") {
    throw new Error(`Document workflow '${state.kind}' is not implemented yet.`);
  }
  if (state.sourceGraph.nodes.length === 0) {
    throw new Error("Cannot generate a PRD without product knowledge graph nodes.");
  }

  emitStage(config, "parseKg", "completed");
  return {};
}

/**
 * 规范化图谱结构，去除悬空关系并按 ID 去重。
 */
function normalizeGraphNode(
  state: DocumentWorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  emitStage(config, "normalizeGraph", "started");

  const nodes = dedupeByKey(state.sourceGraph.nodes, (node) => node.id);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relations = dedupeByKey(
    state.sourceGraph.relations.filter(
      (relation) =>
        nodeIds.has(relation.source) && nodeIds.has(relation.target),
    ),
    (relation) =>
      relation.id ||
      `${relation.type}:${relation.source}:${relation.target}:${relation.source_task_id ?? ""}`,
  );

  emitStage(config, "normalizeGraph", "completed");
  return {
    normalizedGraph: { nodes, relations },
  };
}

/**
 * 按 PRD 章节构建图谱证据材料包。
 */
function buildSectionDossiersNode(
  state: DocumentWorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  emitStage(config, "buildSectionDossiers", "started");
  const graph = requireNormalizedGraph(state);
  const dossiers = createPrdSectionDossiers(graph);

  emitStage(config, "buildSectionDossiers", "completed");
  return { dossiers };
}

/**
 * 调用 Document Agent 生成 PRD Markdown。
 */
async function draftSectionNode(
  state: DocumentWorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  emitStage(config, "draftSection", "started");
  const writer = getWriter(config);
  const graph = requireNormalizedGraph(state);
  let todos = state.todos;
  const markdown = await consumeDocumentAgentStream(
    streamPrdDocumentAgent({
      workspaceId: state.workspaceId,
      runId: state.runId,
      graph,
      dossiers: state.dossiers,
      signal: config?.signal,
    }),
    (event) => {
      if (event.type === "todo-update") {
        todos = event.todos;
      }
      writer?.(event);
    },
  );
  const sectionDrafts = extractSectionDrafts(markdown, state.dossiers);

  emitStage(config, "draftSection", "completed");
  return {
    draftMarkdown: markdown,
    sectionDrafts,
    todos,
  };
}

/**
 * 检查 PRD 草稿是否覆盖关键章节和图谱证据。
 */
function crossCheckNode(
  state: DocumentWorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  emitStage(config, "crossCheck", "started");
  const notes: string[] = [];
  const markdown = state.draftMarkdown;

  for (const keyword of ["目标", "需求", "用户", "风险", "指标"]) {
    if (!markdown.includes(keyword)) {
      notes.push(`PRD 可能缺少“${keyword}”相关内容。`);
    }
  }
  if (state.sectionDrafts.length < 4) {
    notes.push("PRD 章节识别较少，建议人工复核文档结构。");
  }

  const crossCheckResult: DocumentCrossCheck = {
    passed: notes.length === 0,
    notes: notes.length > 0 ? notes : ["PRD 草稿已完成基础一致性检查。"],
  };

  emitStage(config, "crossCheck", "completed");
  return { crossCheckResult };
}

/**
 * 人工审核占位节点，当前后台生成不阻塞等待审核。
 */
function humanReviewNode(
  _state: DocumentWorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  emitStage(config, "humanReview", "started");
  // 当前 PRD 后台任务不自动弹出人工审核；后续可在此接入 interrupt()。
  emitStage(config, "humanReview", "completed");
  return { reviewStatus: "auto_approved" as const };
}

/**
 * 汇总最终 PRD 结果并发出完成事件。
 */
function exportPrdNode(
  state: DocumentWorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  emitStage(config, "exportPrd", "started");
  const graph = requireNormalizedGraph(state);
  const result: DocumentGenerationResult = {
    kind: "prd",
    title: createDocumentTitle(graph.nodes),
    markdown: state.draftMarkdown,
    sections: state.sectionDrafts,
    sourceGraphStats: {
      nodeCount: graph.nodes.length,
      relationCount: graph.relations.length,
    },
    crossCheck: state.crossCheckResult ?? {
      passed: false,
      notes: ["PRD 生成结束，但未获得交叉检查结果。"],
    },
  };

  getWriter(config)?.({ type: "document-complete", result });
  emitStage(config, "exportPrd", "completed");
  return { result };
}

/**
 * 消费 Document Agent 流并取得最终 Markdown。
 */
async function consumeDocumentAgentStream<T>(
  stream: AsyncGenerator<DocumentAgentStreamEvent, T, void>,
  onEvent: (event: DocumentAgentStreamEvent) => void,
): Promise<T> {
  let next = await stream.next();
  while (!next.done) {
    onEvent(next.value);
    next = await stream.next();
  }
  return next.value;
}

/**
 * 向 LangGraph custom stream 写入阶段事件。
 */
function emitStage(
  config: LangGraphRunnableConfig | undefined,
  stage: DocumentWorkflowStage,
  status: "started" | "completed",
) {
  getWriter(config)?.({
    type: "document-stage",
    stage,
    status,
    label: STAGE_LABELS[stage],
  });
}

/**
 * 读取已规范化图谱，缺失时说明工作流状态损坏。
 */
function requireNormalizedGraph(
  state: DocumentWorkflowGraphStateValue,
): DocumentWorkflowGraphSnapshot {
  if (!state.normalizedGraph) {
    throw new Error("Document workflow missing normalized graph state.");
  }

  return state.normalizedGraph;
}

/**
 * 为 PRD 章节构建证据包。
 */
function createPrdSectionDossiers(
  graph: DocumentWorkflowGraphSnapshot,
): DocumentSectionDossier[] {
  return [
    createDossier(graph, {
      id: "overview",
      title: "背景与问题",
      purpose: "Explain the product context, target problem, and source evidence.",
      types: ["Goal", "Evidence", "Decision"],
    }),
    createDossier(graph, {
      id: "requirements",
      title: "功能需求",
      purpose: "Convert requirements and features into implementable PRD requirements.",
      types: ["Requirement", "Feature", "Component"],
    }),
    createDossier(graph, {
      id: "stories",
      title: "用户故事与验收标准",
      purpose: "Draft user stories and acceptance criteria from goals and requirements.",
      types: ["Goal", "Requirement", "Feature"],
    }),
    createDossier(graph, {
      id: "metrics",
      title: "指标与验证",
      purpose: "Define measurable success signals and validation methods.",
      types: ["Metric", "Evidence"],
    }),
    createDossier(graph, {
      id: "risks",
      title: "依赖、约束与风险",
      purpose: "Summarize constraints, dependencies, decisions, and open risks.",
      types: ["Decision", "Component", "Custom"],
    }),
  ];
}

/**
 * 按节点类型创建单个章节材料包。
 */
function createDossier(
  graph: DocumentWorkflowGraphSnapshot,
  options: {
    id: string;
    title: string;
    purpose: string;
    types: string[];
  },
): DocumentSectionDossier {
  const nodes = graph.nodes.filter((node) => options.types.includes(node.type));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relations = graph.relations.filter(
    (relation) => nodeIds.has(relation.source) || nodeIds.has(relation.target),
  );

  return {
    id: options.id,
    title: options.title,
    purpose: options.purpose,
    nodeIds: nodes.map((node) => node.id),
    relationIds: relations.map((relation) => relation.id),
    evidence: [
      ...nodes.slice(0, 24).map(formatNodeEvidence),
      ...relations.slice(0, 24).map(formatRelationEvidence),
    ],
  };
}

/**
 * 从 Markdown 草稿中生成章节摘要。
 */
function extractSectionDrafts(
  markdown: string,
  dossiers: DocumentSectionDossier[],
): DocumentSectionDraft[] {
  const headings = markdown
    .split(/\r?\n/)
    .filter((line) => /^#{2,3}\s+/.test(line))
    .map((line) => line.replace(/^#{2,3}\s+/, "").trim())
    .filter(Boolean);

  const source = headings.length > 0
    ? headings.slice(0, 12).map((title, index) => ({
        id: `section-${index + 1}`,
        title,
        summary: `PRD section generated from Document Agent draft: ${title}`,
        nodeIds: dossiers[index]?.nodeIds ?? [],
        relationIds: dossiers[index]?.relationIds ?? [],
      }))
    : dossiers.map((dossier) => ({
        id: dossier.id,
        title: dossier.title,
        summary: dossier.purpose,
        nodeIds: dossier.nodeIds,
        relationIds: dossier.relationIds,
      }));

  return source;
}

/**
 * 根据图谱目标节点创建文档标题。
 */
function createDocumentTitle(nodes: KnowledgeGraphEntity[]): string {
  const goal = nodes.find((node) => node.type === "Goal") ?? nodes[0];
  return goal ? `${goal.name} PRD` : "产品需求文档 PRD";
}

/**
 * 按稳定 key 去重，保留后出现的更完整对象。
 */
function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item).trim();
    if (!key) continue;
    merged.set(key, item);
  }

  return [...merged.values()];
}

/**
 * 将节点转换为简短证据文本。
 */
function formatNodeEvidence(node: KnowledgeGraphEntity): string {
  return `[${node.id}] ${node.type} ${node.name}: ${node.description ?? ""}`;
}

/**
 * 将关系转换为简短证据文本。
 */
function formatRelationEvidence(relation: KnowledgeGraphRelation): string {
  return `[${relation.id}] ${relation.type}: ${relation.source} -> ${relation.target}. ${relation.description ?? ""}`;
}
