import type { StructuredTool } from "langchain";
import type { AgentRuntimeTool } from "@repo/shared";
import type { AgentMessageType } from "../../types";
import { createWebSearchTool } from "./web-search-tool";

type ToolOwningAgent = Extract<AgentMessageType, "conversation" | "request">;

const AGENT_TOOL_ACCESS: Record<ToolOwningAgent, ReadonlySet<AgentRuntimeTool>> = {
  conversation: new Set(["web_search"]),
  request: new Set(),
};

/**
 * 按本轮启用工具和统一授权表，为指定 Agent 构建可见工具列表。
 */
export function createToolsForAgent(
  agentType: ToolOwningAgent,
  enabledTools: AgentRuntimeTool[] = [],
): StructuredTool[] {
  const allowedTools = AGENT_TOOL_ACCESS[agentType];
  const enabledToolSet = new Set(enabledTools);
  const tools: StructuredTool[] = [];

  // 当前只开放 Conversation Agent 的联网搜索，后续 Agent 统一在 AGENT_TOOL_ACCESS 中授权。
  if (enabledToolSet.has("web_search") && allowedTools.has("web_search")) {
    tools.push(createWebSearchTool());
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
    enabledTools.includes(toolName) && AGENT_TOOL_ACCESS[agentType].has(toolName)
  );
}
