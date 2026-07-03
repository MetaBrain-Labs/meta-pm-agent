/**
 * Conversation Agent 创建
 *
 * 负责创建 Conversation Agent 实例，该 Agent 是用户交互的主入口，
 * 负责意图路由（项目/闲聊）、维护请求表单生命周期、分解用户输入、
 * 并可选地启用 web_search 工具。
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
 * 创建 Conversation Agent，负责和用户交互、生成问题表单并整理 user_input。
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

- You may call \`web_search\` only when the current turn needs external facts, recent information, source verification, market references, or other information not present in the conversation.
- Do not call \`web_search\` for routine routing, simple clarification, or form generation when the user-provided context is sufficient.
- When the user asks for latest, recent, current, today, this month, this year, or similar relative-time information, interpret it using the runtime date above instead of model memory.
- When building a \`web_search\` query for relative-time requests, include the current year/date or a concrete recent period from the runtime context when useful. For example, a request for recent GitHub hotspots should search for 2026 or June 2026 GitHub trending repositories instead of older years.
- If search results look stale or conflict with the runtime date, refine the query once before answering, or explicitly say the latest information could not be verified.
- When a bullet, headline, or factual claim is supported by a search result, append a compact citation marker using that result's \`sourceId\`, for example \`[[source:1]]\`. Do not invent source ids and do not show raw URLs in normal prose unless the user asks for them.
- When search results influence your answer, summarize the useful findings in the user's language and keep the project-management workflow intact.`;
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

If the latest user request appears to start a different new project instead of revising or extending the current project, do not emit a <user-input> block. Ask exactly one Question Form with id "existing-graph-new-project-check" and one required radio question with id "action". The form must warn that the current workspace already has a product knowledge graph and must ask whether to delete the current graph and continue in this workspace, or create a new workspace for the new project.

This graph guard has priority over ordinary request-discovery forms. A standalone broad project request such as "design/build/create a [product/tool/system]" must be treated as a possible new project unless the user explicitly says they are continuing, revising, extending, or summarizing the current project. Do not infer continuation only because the existing graph has related domain nodes. When uncertain, ask the "existing-graph-new-project-check" form first, before asking any scope, goal, audience, or feature clarification questions.

Use the user's language for the title, description, question label, and submit label. For Chinese, use these exact option labels: "删除当前知识图谱，并在当前工作区开始新项目" and "创建新的工作区开始新项目". For English, use these exact option labels: "Delete the current knowledge graph and start the new project in this workspace" and "Create a new workspace for the new project".`;
}
