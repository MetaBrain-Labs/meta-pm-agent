/**
 * Agent 工具访问控制
 *
 * 集中管理所有 Agent 的工具授权策略。定义每个 Agent 可使用的工具白名单，
 * 并提供 createToolsForAgent() 按授权表构建可见工具列表。
 *
 * Responsibilities:
 * - 维护 AGENT_TOOL_ACCESS：Agent → 授权工具集合的映射表
 * - createToolsForAgent()：根据 agentType 和启用的用户工具构建工具数组
 * - getKnowledgeGraphFileToolNames()：返回知识图谱文件工具名称列表
 *
 * Notes:
 * - web_search 仅授权给 conversation Agent
 * - 知识图谱工具（1 读取 + 6 结构化写入）授权给 planner 和全部 10 个 executor Agent
 * - 工具基于内存 ProductKnowledgeGraph 状态对象，不再依赖文件系统
 */

import type { StructuredTool } from "langchain";
import type { AgentRuntimeTool, ProductKnowledgeGraph } from "@repo/shared";
import type { AgentMessageType } from "../../types";
import {
  createKnowledgeGraphTools,
  type StructuredToolCallResult,
} from "./knowledge-graph-file-tool";
import { createWebSearchTool } from "./web-search-tool";

type ToolOwningAgent = AgentMessageType;

const KNOWLEDGE_GRAPH_FILE_TOOLS: AgentRuntimeTool[] = [
  "kg_file_read",
  "kg_file_read_summary",
  "kg_file_query_nodes",
  "kg_file_query_relations",
  "kg_file_read_task_delta",
  "kg_file_read_by_source_task",
  "kg_file_add_summary",
  "kg_file_add_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
];

const EXECUTOR_BLOCKER_TOOLS: AgentRuntimeTool[] = [
  "kg_file_raise_blocker",
];

const EXECUTOR_AGENT_TYPES = [
  "executor-product-strategy",
  "executor-market-research",
  "executor-gtm",
  "executor-product-discovery",
  "executor-product-execution",
  "executor-marketing-growth",
  "executor-data-analytics",
  "executor-ai-shipping",
  "executor-toolkit",
  "executor-interface-craft",
];

const AGENT_TOOL_ACCESS: Record<string, ReadonlySet<AgentRuntimeTool>> = {
  conversation: new Set(["web_search"]),
  request: new Set(),
  planner: new Set(KNOWLEDGE_GRAPH_FILE_TOOLS),
  ...Object.fromEntries(
    EXECUTOR_AGENT_TYPES.map((agentType) => [
      agentType,
      new Set([...KNOWLEDGE_GRAPH_FILE_TOOLS, ...EXECUTOR_BLOCKER_TOOLS]),
    ]),
  ),
};

interface CreateToolsForAgentOptions {
  /** 当前产品知识图谱状态对象，工具调用会直接变更该引用。 */
  knowledgeGraph?: ProductKnowledgeGraph;
}

/**
 * 按本轮启用工具和统一授权表，为指定 Agent 构建可见工具列表。
 */
export function createToolsForAgent(
  agentType: ToolOwningAgent,
  enabledTools: AgentRuntimeTool[] = [],
  options: CreateToolsForAgentOptions = {},
): StructuredTool[] {
  const allowedTools = AGENT_TOOL_ACCESS[agentType] ?? new Set();
  const enabledToolSet = new Set(enabledTools);
  const tools: StructuredTool[] = [];

  if (enabledToolSet.has("web_search") && allowedTools.has("web_search")) {
    tools.push(createWebSearchTool());
  }

  if (
    options.knowledgeGraph &&
    [...KNOWLEDGE_GRAPH_FILE_TOOLS, ...EXECUTOR_BLOCKER_TOOLS].some(
      (toolName) => enabledToolSet.has(toolName) && allowedTools.has(toolName),
    )
  ) {
    tools.push(
      ...createKnowledgeGraphTools(options.knowledgeGraph).filter(
        (toolItem) =>
          enabledToolSet.has(toolItem.name as AgentRuntimeTool) &&
          allowedTools.has(toolItem.name as AgentRuntimeTool),
      ),
    );
  }

  return tools;
}

/**
 * 判断指定 Agent 本轮是否拥有某个运行时工具。
 */
export function canAgentUseTool(
  agentType: ToolOwningAgent,
  toolName: AgentRuntimeTool,
  enabledTools: AgentRuntimeTool[] = [],
): boolean {
  return (
    enabledTools.includes(toolName) &&
    Boolean(AGENT_TOOL_ACCESS[agentType]?.has(toolName))
  );
}

/**
 * Planner/Executor 内部默认启用的知识图谱文件工具名称列表。
 */
export function getKnowledgeGraphFileToolNames(): AgentRuntimeTool[] {
  return [...KNOWLEDGE_GRAPH_FILE_TOOLS, ...EXECUTOR_BLOCKER_TOOLS];
}

export type { StructuredToolCallResult };
