/**
 * Executor Agent 实现
 *
 * 单个 Executor Agent 的流式执行器，负责接收 Planner 分配的任务、
 * 读取当前知识图谱结构化状态、通过工具维护图谱数据，并输出任务结果和推理过程。
 * 从强类型结构化工具调用的 args 中收集 entities/relations/decisions/risks/questions
 * 数据，填充到 ExecutorAgentResult。
 *
 * Responsibilities:
 * - streamExecutorAgent()：执行单个任务并产出结构化图谱补丁
 * - 根据 task.assigned_agent 查找对应 ExecutorDefinition 配置
 * - 为 Executor 附加知识图谱工具（基于内存状态对象，不写文件）
 * - 使用 runTextAgent 通用执行器（文本输出而非 JSON）
 * - 从 tool-call 事件中收集结构化数据填充 ExecutorAgentResult
 *
 * Notes:
 * - 每个 Executor 只处理分配给自己的任务，不跨越职责边界
 * - 知识图谱状态通过对象引用在工具间共享，工具调用会直接变更该引用
 */

import {
  type ExecutorAgentResult,
  type TaskExecutionNode,
  type KnowledgeGraphEntity,
  type KnowledgeGraphRelation,
  type KnowledgeGraphDecisionInput,
  type KnowledgeGraphRiskInput,
  type KnowledgeGraphOpenQuestionInput,
  type ProductKnowledgeGraph,
} from "@repo/shared";
import {
  TEXT_AGENT_MODEL_OPTIONS,
  runTextAgent,
  type TextAgentEvent,
} from "../../common/run-text-agent";
import {
  createToolsForAgent,
  getKnowledgeGraphFileToolNames,
} from "../../common/tool-access";
import type { ExecutorAgentInput, ProductWorkflowStreamEvent } from "../types";
import {
  getExecutorDefinition,
  isExecutorAgentType,
  type ExecutorAgentType,
} from "./definitions";
import { createExecutorAgentPrompt } from "./prompt";

/**
 * 强类型结构化工具名称集合，用于识别需要从中收集数据的工具调用。
 */
const STRUCTURED_TOOL_NAMES = new Set([
  "kg_file_add_summary",
  "kg_file_add_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
]);

/**
 * Executor Agent：读取当前知识图谱结构化状态并产出本任务的图谱补丁。
 */
export async function* streamExecutorAgent(
  input: ExecutorAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, ExecutorAgentResult, void> {
  const definition = getExecutorDefinition(
    assertExecutorAgentType(input.task.assigned_agent),
  );

  yield {
    type: "reasoning",
    agentType: definition.agentType,
    content: `${definition.displayName} 正在读取知识图谱状态并准备图谱补丁。\n`,
  };
  // 工具在本轮工作副本上写入，外层节点统一用 appendKnowledgeGraphPatch 合并一次。
  const baseKnowledgeGraph = cloneKnowledgeGraph(input.knowledgeGraph);
  const toolKnowledgeGraph = cloneKnowledgeGraph(input.knowledgeGraph);
  const tools = createToolsForAgent(
    definition.agentType,
    getKnowledgeGraphFileToolNames(),
    { knowledgeGraph: toolKnowledgeGraph },
  );

  const textGen = runTextAgent({
    agentType: definition.agentType,
    agentLabel: definition.displayName,
    name: `${definition.agentType}-agent`,
    modelOptions: {
      ...TEXT_AGENT_MODEL_OPTIONS,
      maxTokens: 8192,
    },
    systemPrompt: createExecutorAgentPrompt(definition),
    tools,
    payload: {
      executor_profile: {
        agent_type: definition.agentType,
        domain: definition.domain,
        graph_role: definition.graphRole,
        allowed_entity_types: definition.allowedEntityTypes,
        allowed_relation_types: definition.allowedRelationTypes,
        skills: definition.skills,
      },
      product_context: input.productContext || "No product context provided.",
      product_knowledge_graph: input.knowledgeGraph,
      task: input.task,
      plan: input.plan,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
      previous_results: input.previousResults.map((result) => ({
        task_id: result.task_id,
        agent_type: result.agent_type,
        summary: result.summary,
      })),
    },
    fallback: () => createFallbackKnowledgeGraphPatch(input.task),
    signal: input.signal,
  });

  // 手动迭代生成器以在透传事件给上游的同时收集结构化数据
  let patch = "";
  let genResult = await textGen.next();
  while (!genResult.done) {
    const event = genResult.value as TextAgentEvent<string>;

    yield event as ProductWorkflowStreamEvent;
    if (
      event.type === "tool-result" &&
      STRUCTURED_TOOL_NAMES.has(event.toolName)
    ) {
      // 结构化写入工具完成后立即发出累计图谱快照，避免后续中断丢失已完成工具产物。
      yield {
        type: "knowledge-graph-update",
        knowledgeGraph: cloneKnowledgeGraph(toolKnowledgeGraph),
      };
    }
    genResult = await textGen.next();
  }
  patch = genResult.value;
  const graphDelta = getKnowledgeGraphDelta(
    baseKnowledgeGraph,
    toolKnowledgeGraph,
  );

  return createExecutorResult({
    task: input.task,
    agentType: definition.agentType,
    focusLayer: definition.focusLayer,
    displayName: definition.displayName,
    patch,
    summary: graphDelta.summary[0],
    entities: graphDelta.entities,
    relations: graphDelta.relations,
    decisions: graphDelta.decisions,
    risks: graphDelta.risks,
    openQuestions: graphDelta.open_questions,
  });
}

/**
 * 生成稳定的 Executor 执行结果，供 DAG 状态和持久化层使用。
 */
function createExecutorResult({
  task,
  agentType,
  focusLayer,
  displayName,
  patch,
  summary,
  entities,
  relations,
  decisions,
  risks,
  openQuestions,
}: {
  task: TaskExecutionNode;
  agentType: ExecutorAgentType;
  focusLayer: ExecutorAgentResult["focus_layer"];
  displayName: string;
  patch: string;
  summary?: string;
  entities: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
  decisions: KnowledgeGraphDecisionInput[];
  risks: KnowledgeGraphRiskInput[];
  openQuestions: KnowledgeGraphOpenQuestionInput[];
}): ExecutorAgentResult {
  return {
    task_id: task.task_id,
    agent_type: agentType,
    focus_layer: focusLayer,
    summary: summary?.trim() || `${displayName} 已更新至知识图谱。`,
    entities,
    relations,
    decisions: decisions.length > 0 ? decisions : [],
    risks: risks.length > 0 ? risks : [],
    open_questions: openQuestions.length > 0 ? openQuestions : [],
    quality_result: {
      passed: true,
      notes: "Executor 产出已作为结构化补丁写入当前知识图谱状态。",
    },
    knowledge_graph_patch: patch,
  };
}

/**
 * 克隆当前知识图谱，供单个 Executor 内部工具读取和写入，避免工具副作用污染全局状态。
 */
function cloneKnowledgeGraph(
  knowledgeGraph: ProductKnowledgeGraph,
): ProductKnowledgeGraph {
  return {
    entities: [...knowledgeGraph.entities],
    relations: [...knowledgeGraph.relations],
    decisions: [...knowledgeGraph.decisions],
    risks: [...knowledgeGraph.risks],
    open_questions: [...knowledgeGraph.open_questions],
    summary: [...knowledgeGraph.summary],
    markdown: knowledgeGraph.markdown,
    notes: [...knowledgeGraph.notes],
  };
}

/**
 * 从工具工作副本中计算本轮 Executor 实际写入的结构化增量。
 */
function getKnowledgeGraphDelta(
  base: ProductKnowledgeGraph,
  current: ProductKnowledgeGraph,
): Pick<
  ProductKnowledgeGraph,
  | "entities"
  | "relations"
  | "decisions"
  | "risks"
  | "open_questions"
  | "summary"
> {
  return {
    entities: current.entities.slice(base.entities.length),
    relations: current.relations.slice(base.relations.length),
    decisions: current.decisions.slice(base.decisions.length),
    risks: current.risks.slice(base.risks.length),
    open_questions: current.open_questions.slice(base.open_questions.length),
    summary: current.summary.slice(base.summary.length),
  };
}

/**
 * 在模型不可用时生成最小可追踪的结构化图谱补丁。
 */
function createFallbackKnowledgeGraphPatch(task: TaskExecutionNode): string {
  return JSON.stringify(
    {
      summary: [task.title],
      nodes: [
        {
          id: `${task.task_id}-placeholder`,
          type: "Custom",
          name: task.title,
          description: task.description,
          source_task_id: task.task_id,
          status: "proposed",
        },
      ],
      relations: [],
      decisions: [],
      risks: [
        {
          id: `${task.task_id}-risk-01`,
          text: "模型不可用，本任务只写入最小占位节点。",
        },
      ],
      open_questions: [
        {
          id: `${task.task_id}-oq-01`,
          text: "是否接受该任务的图谱建模方向？",
        },
      ],
    },
    null,
    2,
  );
}

/**
 * 保护运行时分派边界，避免 Planner 输出未知 Agent 类型时静默进入错误节点。
 */
function assertExecutorAgentType(agentType: string): ExecutorAgentType {
  if (isExecutorAgentType(agentType)) return agentType;
  throw new Error(`Unknown executor agent type: ${agentType}`);
}
