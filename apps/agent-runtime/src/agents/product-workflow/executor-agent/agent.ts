import {
  type ExecutorAgentResult,
  type TaskExecutionNode,
} from "@repo/shared";
import {
  TEXT_AGENT_MODEL_OPTIONS,
  runTextAgent,
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
  const fileHandle = createKnowledgeGraphFileHandle(input.knowledgeGraph.markdown);
  const tools = createToolsForAgent(
    definition.agentType,
    getKnowledgeGraphFileToolNames(),
    { knowledgeGraphFile: fileHandle },
  );

  const patch = yield* runTextAgent({
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
}: {
  task: TaskExecutionNode;
  agentType: ExecutorAgentType;
  focusLayer: ExecutorAgentResult["focus_layer"];
  displayName: string;
  patch: string;
  finalMarkdown: string;
}): ExecutorAgentResult {
  return {
    task_id: task.task_id,
    agent_type: agentType,
    focus_layer: focusLayer,
    summary: `${displayName} 已更新至知识图谱。`,
    entities: [],
    relations: [],
    decisions: [`已将 ${task.title} 的图谱补丁写入 product-knowledge-graph.md。`],
    risks: [],
    open_questions: [],
    quality_result: {
      passed: true,
      notes: "Executor 产出已作为 markdown patch 合并到当前知识图谱。",
    },
    knowledge_graph_patch: patch,
    knowledge_graph_markdown: finalMarkdown,
  };
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
