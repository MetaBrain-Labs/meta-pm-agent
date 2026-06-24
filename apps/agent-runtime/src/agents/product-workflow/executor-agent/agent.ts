/**
 * Executor Agent 实现
 *
 * 单个 Executor Agent 的流式执行器，负责接收 Planner 分配的任务、
 * 读取当前知识图谱、通过文件工具维护 product-knowledge-graph.md，
 * 并输出任务结果和推理过程。支持从强类型结构化工具调用中收集
 * entities/relations 数据，填充到 ExecutorAgentResult。
 *
 * Responsibilities:
 * - streamExecutorAgent()：执行单个任务并产出图谱补丁
 * - 根据 task.assigned_agent 查找对应 ExecutorDefinition 配置
 * - 为 Executor 附加知识图谱文件工具（含结构化工具）
 * - 使用 runTextAgent 通用执行器（文本输出而非 JSON）
 * - 从 tool-call 事件中收集结构化数据填充 ExecutorAgentResult
 *
 * Notes:
 * - 每个 Executor 只处理分配给自己的任务，不跨越职责边界
 * - 结构化工具优先，文本工具保留作为回退
 */

import {
  type ExecutorAgentResult,
  type TaskExecutionNode,
  type KnowledgeGraphEntity,
  type KnowledgeGraphRelation,
} from "@repo/shared";
import {
  TEXT_AGENT_MODEL_OPTIONS,
  runTextAgent,
  type TextAgentEvent,
} from "../../common/run-text-agent";
import { createKnowledgeGraphFileHandle } from "../../common/knowledge-graph-file-tool";
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
  "kg_file_add_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
]);

/**
 * Executor Agent：读取当前 markdown 知识图谱并产出本任务的图谱补丁。
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
    content: `${definition.displayName} 正在读取 product-knowledge-graph.md 并准备图谱补丁。\n`,
  };
  const fileHandle = createKnowledgeGraphFileHandle(
    input.knowledgeGraph.markdown,
    input.workspaceId,
  );
  const tools = createToolsForAgent(
    definition.agentType,
    getKnowledgeGraphFileToolNames(),
    { knowledgeGraphFile: fileHandle },
  );

  // 从结构化工具调用中收集数据，用于填充 ExecutorAgentResult 的 entities/relations 等字段
  let collectedEntities: KnowledgeGraphEntity[] = [];
  let collectedRelations: KnowledgeGraphRelation[] = [];
  let collectedDecisionTexts: string[] = [];
  let collectedRiskTexts: string[] = [];
  let collectedQuestionTexts: string[] = [];

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
      product_knowledge_graph_markdown: input.knowledgeGraph.markdown,
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

    // 从强类型工具的 tool-call 事件中收集结构化数据
    if (
      event.type === "tool-call" &&
      STRUCTURED_TOOL_NAMES.has(event.toolName)
    ) {
      collectFromToolCall(
        event.toolName,
        event.toolArgs ?? {},
        collectedEntities,
        collectedRelations,
        collectedDecisionTexts,
        collectedRiskTexts,
        collectedQuestionTexts,
      );
    }

    yield event as ProductWorkflowStreamEvent;
    genResult = await textGen.next();
  }
  patch = genResult.value;
  const finalMarkdown =
    fileHandle.read() === input.knowledgeGraph.markdown
      ? mergeFallbackPatch(input.knowledgeGraph.markdown, input.task, patch)
      : fileHandle.read();

  return createExecutorResult({
    task: input.task,
    agentType: definition.agentType,
    focusLayer: definition.focusLayer,
    displayName: definition.displayName,
    patch,
    finalMarkdown,
    entities: collectedEntities,
    relations: collectedRelations,
    decisions: collectedDecisionTexts,
    risks: collectedRiskTexts,
    openQuestions: collectedQuestionTexts,
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
  finalMarkdown,
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
  finalMarkdown: string;
  entities: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
  decisions: string[];
  risks: string[];
  openQuestions: string[];
}): ExecutorAgentResult {
  return {
    task_id: task.task_id,
    agent_type: agentType,
    focus_layer: focusLayer,
    summary: `${displayName} 已更新至知识图谱。`,
    entities,
    relations,
    decisions: decisions.length > 0 ? decisions : [],
    risks: risks.length > 0 ? risks : [],
    open_questions: openQuestions.length > 0 ? openQuestions : [],
    quality_result: {
      passed: true,
      notes: "Executor 产出已作为结构化补丁写入当前知识图谱。",
    },
    knowledge_graph_patch: patch,
    knowledge_graph_markdown: finalMarkdown,
  };
}

/**
 * 从结构化工具调用的参数中提取数据，填充到收集器数组中。
 */
function collectFromToolCall(
  toolName: string,
  args: Record<string, unknown>,
  entities: KnowledgeGraphEntity[],
  relations: KnowledgeGraphRelation[],
  decisions: string[],
  risks: string[],
  questions: string[],
): void {
  try {
    switch (toolName) {
      case "kg_file_add_nodes": {
        const nodes = args.nodes;
        if (!Array.isArray(nodes)) break;
        for (const node of nodes) {
          if (node && typeof node === "object") {
            const n = node as Record<string, unknown>;
            entities.push({
              id: String(n.id ?? ""),
              type: String(n.type ?? "Custom") as KnowledgeGraphEntity["type"],
              name: String(n.name ?? ""),
              description: typeof n.description === "string" ? n.description : "",
              source_task_id:
                typeof n.source_task_id === "string" ? n.source_task_id : "",
              status: typeof n.status === "string"
                ? (n.status as KnowledgeGraphEntity["status"])
                : "proposed",
            });
          }
        }
        break;
      }
      case "kg_file_add_relations": {
        const rels = args.relations;
        if (!Array.isArray(rels)) break;
        for (const rel of rels) {
          if (rel && typeof rel === "object") {
            const r = rel as Record<string, unknown>;
            relations.push({
              id: String(r.id ?? ""),
              type: String(r.type ?? "Custom") as KnowledgeGraphRelation["type"],
              source: String(r.source ?? ""),
              target: String(r.target ?? ""),
              description:
                typeof r.description === "string" ? r.description : "",
              source_task_id:
                typeof r.source_task_id === "string" ? r.source_task_id : "",
            });
          }
        }
        break;
      }
      case "kg_file_add_decisions": {
        const decs = args.decisions;
        if (!Array.isArray(decs)) break;
        for (const dec of decs) {
          if (dec && typeof dec === "object") {
            const d = dec as Record<string, unknown>;
            decisions.push(
              `**${String(d.id ?? "")}**：${String(d.text ?? "")}`,
            );
          }
        }
        break;
      }
      case "kg_file_add_risks": {
        const riskArr = args.risks;
        if (!Array.isArray(riskArr)) break;
        for (const risk of riskArr) {
          if (risk && typeof risk === "object") {
            const r = risk as Record<string, unknown>;
            risks.push(`**${String(r.id ?? "")}**：${String(r.text ?? "")}`);
          }
        }
        break;
      }
      case "kg_file_add_open_questions": {
        const qs = args.questions;
        if (!Array.isArray(qs)) break;
        for (const q of qs) {
          if (q && typeof q === "object") {
            const oq = q as Record<string, unknown>;
            questions.push(
              `**${String(oq.id ?? "")}**：${String(oq.text ?? "")}`,
            );
          }
        }
        break;
      }
    }
  } catch {
    // 工具参数解析失败不阻断主流程，结构化数据回退为空
  }
}

/**
 * 当模型没有调用文件工具时，使用模型文本作为补丁追加到图谱，保证流程可继续。
 */
function mergeFallbackPatch(
  markdown: string,
  task: TaskExecutionNode,
  patch: string,
): string {
  const normalizedPatch = isCompletionOnlyText(patch)
    ? createFallbackKnowledgeGraphPatch(task)
    : patch.trim() || createFallbackKnowledgeGraphPatch(task);

  return [
    markdown.trimEnd(),
    "",
    `## ${task.task_id} · ${task.assigned_agent}`,
    "",
    normalizedPatch,
    "",
  ].join("\n");
}

/**
 * 判断模型是否只返回了完成提示而没有实际图谱内容。
 */
function isCompletionOnlyText(value: string): boolean {
  const normalized = value.trim().replace(/[。.!！\s]/g, "");
  return normalized === "已更新至知识图谱";
}

/**
 * 在模型不可用时生成最小可追踪的 markdown 图谱补丁。
 */
function createFallbackKnowledgeGraphPatch(task: TaskExecutionNode): string {
  return [
    "### Summary",
    `- ${task.title}`,
    "",
    "### Nodes",
    "| id | type | name | description | source_task_id | status |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${task.task_id}-placeholder | Custom | ${escapeMarkdownCell(task.title)} | ${escapeMarkdownCell(task.description)} | ${task.task_id} | proposed |`,
    "",
    "### Relations",
    "- 无",
    "",
    "### Decisions",
    "- 无",
    "",
    "### Risks",
    "- 模型不可用，本任务只写入最小占位节点。",
    "",
    "### Open Questions",
    "- 是否接受该任务的图谱建模方向？",
  ].join("\n");
}

/**
 * 转义 markdown 表格单元格，避免任务文本破坏图谱表格。
 */
function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * 保护运行时分派边界，避免 Planner 输出未知 Agent 类型时静默进入错误节点。
 */
function assertExecutorAgentType(agentType: string): ExecutorAgentType {
  if (isExecutorAgentType(agentType)) return agentType;
  throw new Error(`Unknown executor agent type: ${agentType}`);
}
