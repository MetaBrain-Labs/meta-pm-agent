/**
 * Conversation Agent 创建
 *
 * 负责创建 Conversation Agent 实例，该 Agent 是图内首个用户消息接收节点，
 * 负责发出 Planner Intake 交接信号或工作流恢复信号，并可选地启用 web_search 工具。
 *
 * Responsibilities:
 * - createConversationAgent()：根据启用工具创建 DeepAgent 实例
 * - buildConversationPrompt()：根据工具能力和运行时日期生成 system prompt
 * - 注入运行时日期上下文，防止 Agent 使用过期年份
 */

import { createDeepAgent } from "deepagents";
import type { AgentRuntimeTool, ProductKnowledgeGraph } from "@repo/shared";
import { canAgentUseTool, createToolsForAgent } from "../common/tool-access";
import { createChatModel } from "../common/model";
import { createDefaultAgentMiddleware } from "../common/middleware";
import { createDeepAgentToolAllowlistMiddleware } from "../common/deep-agent-tool-policy";
import {
  createAgentRunSummaryMiddleware,
  type AgentRunSummaryRecorder,
} from "../common/agent-run-summary";
import {
  getRuntimeDateContext,
  type RuntimeDateContext,
} from "../common/runtime-context";
import { DISCOVERY_PROMPT } from "./prompt";

export interface ConversationAgentOptions {
  enabledTools?: AgentRuntimeTool[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
  summaryRecorder?: AgentRunSummaryRecorder;
}

/**
 * 创建 Conversation Agent，负责图内首节点交接并保留用户授权工具能力。
 */
export function createConversationAgent(options: ConversationAgentOptions = {}) {
  const model = createChatModel();
  const tools = createToolsForAgent("conversation", options.enabledTools);

  return createDeepAgent({
    model: model as any,
    systemPrompt: createConversationAgentSystemPrompt(
      options,
      tools.length > 0,
    ),
    tools,
    name: "conversation-agent",
    skills: [],
    middleware: [
      createDeepAgentToolAllowlistMiddleware({
        agentName: "conversation-agent",
        allowedToolNames: tools.map((tool) => tool.name),
      }),
      ...createDefaultAgentMiddleware(),
      ...createAgentRunSummaryMiddleware(options.summaryRecorder),
    ] as any,
  });
}

/**
 * 构造 Conversation Agent 最终注入模型的系统提示，供运行和本地汇总复用。
 */
export function createConversationAgentSystemPrompt(
  options: ConversationAgentOptions = {},
  webSearchEnabled = canAgentUseTool(
    "conversation",
    "web_search",
    options.enabledTools,
  ),
): string {
  return buildConversationPrompt({
    runtimeContext: getRuntimeDateContext(),
    webSearchEnabled,
    knowledgeGraph: options.knowledgeGraph,
  });
}

interface ConversationPromptOptions {
  runtimeContext: RuntimeDateContext;
  webSearchEnabled: boolean;
  knowledgeGraph?: ProductKnowledgeGraph | null;
}

/**
 * 根据本轮工具能力生成 Conversation Agent 系统提示。
 */
function buildConversationPrompt({
  runtimeContext,
  webSearchEnabled,
  knowledgeGraph,
}: ConversationPromptOptions): string {
  const runtimePrompt = buildRuntimeContextPrompt(runtimeContext);
  const graphGuardPrompt = buildWorkspaceKnowledgeGraphPrompt(knowledgeGraph);

  if (!webSearchEnabled) {
    return `${DISCOVERY_PROMPT}

${runtimePrompt}

${graphGuardPrompt}`;
  }

  return `${DISCOVERY_PROMPT}

${runtimePrompt}

${graphGuardPrompt}

## Web search tool

- You may call \`web_search\` only when a non-resume handoff cannot preserve an explicit external reference without a compact citation.
- Do not call \`web_search\` for routine handoff, Planner routing, simple clarification, requirement discovery, or form generation.
- When the user asks for latest, recent, current, today, this month, this year, or similar relative-time information, interpret it using the runtime date above instead of model memory.
- When building a \`web_search\` query for relative-time requests, include the current year/date or a concrete recent period from the runtime context when useful. For example, a request for recent GitHub hotspots should search for 2026 or June 2026 GitHub trending repositories instead of older years.
- If search results look stale or conflict with the runtime date, refine the query once before answering, or explicitly say the latest information could not be verified.
- If search results are used, keep the final output contract unchanged and hand off to Planner Intake. Do not expose raw URLs.`;
}

/**
 * 将服务器当前日期写入系统提示，作为所有相对时间判断的业务基准。
 */
function buildRuntimeContextPrompt(context: RuntimeDateContext): string {
  return `## Runtime context

- Current server date: ${context.currentDate} (${context.timeZone}).
- Current server year: ${context.currentYear}.
- Treat relative-time phrases as relative to this date, not to the model's training data.`;
}

/**
 * 注入当前工作区图谱状态，提醒 Conversation Agent 避免把新项目混入旧图谱。
 */
function buildWorkspaceKnowledgeGraphPrompt(
  knowledgeGraph: ProductKnowledgeGraph | null | undefined,
): string {
  const graph = knowledgeGraph ?? null;
  const nodeCount = graph?.entities.length ?? 0;
  const relationCount = graph?.relations.length ?? 0;
  const hasExistingGraph = nodeCount > 0 && relationCount > 0;

  if (!graph || !hasExistingGraph) {
    return `## Current workspace knowledge graph

- Existing complete graph: no.`;
  }

  const recentNodes = graph.entities
    .slice(Math.max(0, graph.entities.length - 5))
    .map((node) => `${node.id}:${node.name}`)
    .join(", ");

  return `## Current workspace knowledge graph

- Existing complete graph: yes.
- Node count: ${nodeCount}.
- Relation count: ${relationCount}.
- Recent nodes: ${recentNodes || "none"}.

Use this graph summary only to understand whether explicit workflow resume is plausible. Planner Intake Agent owns graph-aware intent judgment and any user-facing Question Form.`;
}
