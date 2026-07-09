/**
 * Conversation Agent 创建
 *
 * 负责创建 Conversation Agent 实例。Conversation Agent 职责已收窄为三项核心能力：
 * - 闲聊模式（chat）：自然语言回复，不产生标记块或表单
 * - 项目模式（project）：用户输入分解（<user-input>）、表单答案整合、知识图谱冲突检查
 *
 * 意图路由（casual_chat/new_project/project_evolution）由 Pre-Orchestrator 负责。
 * 工作流恢复检测由 Pre-Orchestrator 负责。
 * 产品工作流调度与执行由 LangGraph workflow.ts 全权拥有。
 *
 * Responsibilities:
 * - createConversationAgent()：创建项目模式 DeepAgent 实例
 * - createConversationAgentSystemPrompt()：根据模式构造 system prompt
 * - createChatOnlyAgent()：创建纯闲聊模式 Agent 实例
 * - 注入运行时日期上下文和知识图谱冲突检测
 */

import { createDeepAgent } from "deepagents";
import type { AgentRuntimeTool } from "@repo/shared";
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
import { DISCOVERY_PROMPT, CHAT_ONLY_PROMPT } from "./prompt";

export interface ConversationAgentOptions {
  enabledTools?: AgentRuntimeTool[];
  summaryRecorder?: AgentRunSummaryRecorder;
  /** 当设为 "chat" 时使用纯闲聊模式，不产生标记块或表单 */
  mode?: "project" | "chat";
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
    webSearchEnabled: options.mode === "chat" ? false : webSearchEnabled,
    mode: options.mode ?? "project",
  });
}

interface ConversationPromptOptions {
  runtimeContext: RuntimeDateContext;
  webSearchEnabled: boolean;
  mode?: "project" | "chat";
}

/**
 * 根据本轮工具能力和模式生成 Conversation Agent 系统提示。
 */
function buildConversationPrompt({
  runtimeContext,
  webSearchEnabled,
  mode,
}: ConversationPromptOptions): string {
  const runtimePrompt = buildRuntimeContextPrompt(runtimeContext);

  // 纯闲聊模式：只用简短提示
  if (mode === "chat") {
    return `${CHAT_ONLY_PROMPT}

${runtimePrompt}`;
  }

  if (!webSearchEnabled) {
    return `${DISCOVERY_PROMPT}

${runtimePrompt}`;
  }

  return `${DISCOVERY_PROMPT}

${runtimePrompt}

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

