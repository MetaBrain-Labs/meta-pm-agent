/**
 * Agent 工具访问控制
 *
 * 集中管理所有 Agent 的工具授权策略。定义每个 Agent 可使用的工具白名单，
 * 并提供 createToolsForAgent() 按授权表构建可见工具列表。
 *
 * Responsibilities:
 * - 维护 AGENT_TOOL_ACCESS：Agent → 授权工具集合的映射表
 * - createToolsForAgent()：根据 agentType 和启用的用户工具构建工具数组
 * - getExecutorDefaultToolNames()：返回 Executor 内部默认启用的工具名称列表
 * - getExecutorRetryToolNames()：返回结构化重试阶段的最小写入工具列表
 *
 * Notes:
 * - conversation 的 web_search 由前端 enabledTools 控制
 * - 需要外部事实的 Executor 可由 runtime 默认注入 web_search，不依赖前端开关
 * - 知识图谱工具（6 读取 + 6 结构化写入）授权给全部 10 个 executor Agent
 * - 工具基于内存 ProductKnowledgeGraph 状态对象，不再依赖文件系统
 */

import type { StructuredTool } from "langchain";
import type { AgentRuntimeTool, ProductKnowledgeGraph } from "@repo/shared";
import type { AgentMessageType } from "../../types";
import { EXECUTOR_DEFINITIONS } from "../product-workflow/executor-agent/definitions";
import {
  createKnowledgeGraphTools,
  type StructuredToolCallResult,
} from "./knowledge-graph-file-tool";
import {
  createWebSearchTool,
  type WebSearchEvidenceRegistry,
} from "./web-search-tool";

type ToolOwningAgent = AgentMessageType;

const KNOWLEDGE_GRAPH_FILE_TOOLS: AgentRuntimeTool[] = [
  "kg_file_read",
  "kg_file_query_nodes",
  "kg_file_query_relations",
  "kg_file_read_by_source_task",
  "kg_file_add_summary",
  "kg_file_add_nodes",
  "kg_file_deprecate_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
];

const EXECUTOR_BLOCKER_TOOLS: AgentRuntimeTool[] = [
  "kg_file_raise_blocker",
];

const EXECUTOR_AGENT_TYPES = EXECUTOR_DEFINITIONS.map(
  (definition) => definition.agentType,
);

const EXECUTOR_WEB_SEARCH_AGENT_TYPES: ReadonlySet<string> = new Set(
  EXECUTOR_DEFINITIONS.filter((definition) => definition.webSearchEnabled).map(
    (definition) => definition.agentType,
  ),
);

const AGENT_TOOL_ACCESS: Record<string, ReadonlySet<AgentRuntimeTool>> = {
  conversation: new Set(["web_search"]),
  request: new Set(),
  ...Object.fromEntries(
    EXECUTOR_AGENT_TYPES.map((agentType) => [
      agentType,
      new Set([
        ...KNOWLEDGE_GRAPH_FILE_TOOLS,
        ...EXECUTOR_BLOCKER_TOOLS,
        ...(EXECUTOR_WEB_SEARCH_AGENT_TYPES.has(agentType)
          ? (["web_search"] satisfies AgentRuntimeTool[])
          : []),
      ]),
    ]),
  ),
};

interface CreateToolsForAgentOptions {
  /** 当前产品知识图谱状态对象，工具调用会直接变更该引用。 */
  knowledgeGraph?: ProductKnowledgeGraph;
  /** 当前 Executor Profile 允许创建的实体类型。 */
  allowedEntityTypes?: readonly ProductKnowledgeGraph["entities"][number]["type"][];
  /** 当前 Executor Profile 允许创建的关系类型。 */
  allowedRelationTypes?: readonly ProductKnowledgeGraph["relations"][number]["type"][];
  /** 当前任务必须新增的阻塞问题数量。 */
  requiredBlockingOpenQuestionCount?: number;
  /** 是否允许补充任务通过受控工具退役旧节点。 */
  allowNodeDeprecation?: boolean;
  /** 是否允许文档补证任务关闭已被回答的活跃风险。 */
  allowRiskDeprecation?: boolean;
  /** 当前任务 ID，用于阻止模型伪造来源任务。 */
  sourceTaskId?: string;
  /** 本轮用户输入，供节点来源校验。 */
  userInput?: ReadonlyArray<{ index: number; content: string }>;
  /** 本轮真实搜索结果注册表，供 Evidence 来源校验。 */
  webSearchEvidenceRegistry?: WebSearchEvidenceRegistry;
}

/**
 * 按本轮运行时工具列表和统一授权表，为指定 Agent 构建可见工具列表。
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
    tools.push(createWebSearchTool(options.webSearchEvidenceRegistry));
  }

  if (
    options.knowledgeGraph &&
    [...KNOWLEDGE_GRAPH_FILE_TOOLS, ...EXECUTOR_BLOCKER_TOOLS].some(
      (toolName) => enabledToolSet.has(toolName) && allowedTools.has(toolName),
    )
  ) {
    tools.push(
      ...createKnowledgeGraphTools(options.knowledgeGraph, {
        allowedEntityTypes: options.allowedEntityTypes,
        allowedRelationTypes: options.allowedRelationTypes,
        requiredBlockingOpenQuestionCount:
          options.requiredBlockingOpenQuestionCount,
        allowNodeDeprecation: options.allowNodeDeprecation,
        allowRiskDeprecation: options.allowRiskDeprecation,
        sourceTaskId: options.sourceTaskId,
        userInput: options.userInput,
        verifiedWebSources: options.webSearchEvidenceRegistry?.sources,
      }).filter(
        (toolItem) =>
          enabledToolSet.has(toolItem.name as AgentRuntimeTool) &&
          allowedTools.has(toolItem.name as AgentRuntimeTool),
      ),
    );
  }

  return tools;
}

/**
 * Executor 内部默认启用的工具名称列表。
 *
 * 前端 enabledTools 只控制用户可选工具；Executor 为完成 Planner 任务所需的内部
 * web_search 由 runtime 策略决定，避免 Market Research 等任务无法验证外部事实。
 */
export function getExecutorDefaultToolNames(
  agentType: ToolOwningAgent,
  supplement = false,
): AgentRuntimeTool[] {
  return [
    ...KNOWLEDGE_GRAPH_FILE_TOOLS.filter(
      (toolName) =>
        toolName !== "kg_file_add_summary" &&
        (supplement || toolName !== "kg_file_deprecate_nodes"),
    ),
    ...EXECUTOR_BLOCKER_TOOLS,
    ...(EXECUTOR_WEB_SEARCH_AGENT_TYPES.has(agentType)
      ? (["web_search"] satisfies AgentRuntimeTool[])
      : []),
  ];
}

/**
 * 返回 Executor 结构化重试阶段的写入工具，避免重复读取和外部研究。
 */
export function getExecutorRetryToolNames(supplement = false): AgentRuntimeTool[] {
  return [
    "kg_file_add_nodes",
    ...(supplement
      ? (["kg_file_deprecate_nodes"] satisfies AgentRuntimeTool[])
      : []),
    "kg_file_add_relations",
    "kg_file_add_decisions",
    "kg_file_add_risks",
    "kg_file_add_open_questions",
    ...EXECUTOR_BLOCKER_TOOLS,
  ];
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
 * 判断 Executor Agent 是否默认启用 web_search 工具。
 *
 * Market Research、GTM、Marketing Growth、Data Analytics、AI Shipping、
 * Toolkit、Interface Craft 需要外部事实验证，runtime 自动注入 web_search。
 */
export function canExecutorUseWebSearch(agentType: ToolOwningAgent): boolean {
  return EXECUTOR_DEFINITIONS.some(
    (definition) =>
      definition.agentType === agentType && definition.webSearchEnabled,
  );
}

export type { StructuredToolCallResult };
