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
 * - getStructuredKnowledgeGraphFileToolNames()：返回结构化写入工具名称列表
 *
 * Notes:
 * - web_search 仅授权给 conversation Agent
 * - 知识图谱文件工具授权给 planner 和全部 10 个 executor Agent
 * - 结构化工具和文本工具同时可用，prompt 层引导优先使用结构化工具
 */

import type { StructuredTool } from "langchain";
import type { AgentRuntimeTool } from "@repo/shared";
import type { AgentMessageType } from "../../types";
import {
  createKnowledgeGraphFileTools,
  createStructuredKnowledgeGraphFileTools,
  type KnowledgeGraphFileHandle,
  type StructuredToolCallResult,
} from "./knowledge-graph-file-tool";
import { createWebSearchTool } from "./web-search-tool";

type ToolOwningAgent = AgentMessageType;

const KNOWLEDGE_GRAPH_FILE_TOOLS = [
  "kg_file_create",
  "kg_file_read",
  "kg_file_insert",
  "kg_file_update",
  "kg_file_delete_content",
] satisfies AgentRuntimeTool[];

const STRUCTURED_KNOWLEDGE_GRAPH_FILE_TOOLS = [
  "kg_file_add_summary",
  "kg_file_add_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
] satisfies AgentRuntimeTool[];

const ALL_KNOWLEDGE_GRAPH_FILE_TOOLS: AgentRuntimeTool[] = [
  ...KNOWLEDGE_GRAPH_FILE_TOOLS,
  ...STRUCTURED_KNOWLEDGE_GRAPH_FILE_TOOLS,
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
  planner: new Set(ALL_KNOWLEDGE_GRAPH_FILE_TOOLS),
  ...Object.fromEntries(
    EXECUTOR_AGENT_TYPES.map((agentType) => [
      agentType,
      new Set(ALL_KNOWLEDGE_GRAPH_FILE_TOOLS),
    ]),
  ),
};

interface CreateToolsForAgentOptions {
  knowledgeGraphFile?: KnowledgeGraphFileHandle;
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

  // Conversation Agent 的联网搜索仍由用户请求显式启用。
  if (enabledToolSet.has("web_search") && allowedTools.has("web_search")) {
    tools.push(createWebSearchTool());
  }

  if (
    options.knowledgeGraphFile &&
    KNOWLEDGE_GRAPH_FILE_TOOLS.some(
      (toolName) => enabledToolSet.has(toolName) && allowedTools.has(toolName),
    )
  ) {
    tools.push(...createKnowledgeGraphFileTools(options.knowledgeGraphFile));
  }

  // 结构化工具：与文本工具共享同一文件句柄，由 Agent 自行选择调用。
  if (
    options.knowledgeGraphFile &&
    STRUCTURED_KNOWLEDGE_GRAPH_FILE_TOOLS.some(
      (toolName) => enabledToolSet.has(toolName) && allowedTools.has(toolName),
    )
  ) {
    tools.push(
      ...createStructuredKnowledgeGraphFileTools(options.knowledgeGraphFile),
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
 * Planner/Executor 内部默认启用的知识图谱文件工具。
 */
export function getKnowledgeGraphFileToolNames(): AgentRuntimeTool[] {
  return [...KNOWLEDGE_GRAPH_FILE_TOOLS, ...STRUCTURED_KNOWLEDGE_GRAPH_FILE_TOOLS];
}

/**
 * 仅结构化写入工具名称列表，用于 Executor Agent 结果数据收集。
 */
export function getStructuredKnowledgeGraphFileToolNames(): AgentRuntimeTool[] {
  return [...STRUCTURED_KNOWLEDGE_GRAPH_FILE_TOOLS];
}

export type { StructuredToolCallResult };
