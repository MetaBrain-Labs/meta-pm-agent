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
 * - 通过 Prompt Resolver 解析工作区自定义提示词，未自定义时使用内置默认正文
 */

import { createDeepAgent } from "deepagents";
import type {
  AgentRuntimeTool,
  ModelUsageProfile,
  PromptOverrides,
} from "@repo/shared";
import { canAgentUseTool, createToolsForAgent } from "../common/tool-access";
import { createChatModel } from "../common/model";
import {
  resolveAgentModelSelection,
  type ResolvedAgentModelSelection,
} from "../common/model-profile";
import { createDefaultAgentMiddleware } from "../common/middleware";
import { createDeepAgentToolAllowlistMiddleware } from "../common/deep-agent-tool-policy";
import {
  createAgentRunSummaryMiddleware,
  type AgentRunSummaryRecorder,
} from "../common/agent-run-summary";
import {
  WEB_SEARCH_USAGE_PROMPT,
  buildRuntimeContextPrompt,
} from "../common/web-search-prompt";
import { resolvePromptContent } from "../../prompts/resolver";

export interface ConversationAgentOptions {
  enabledTools?: AgentRuntimeTool[];
  summaryRecorder?: AgentRunSummaryRecorder;
  modelProfile?: ModelUsageProfile;
  /** 本轮生效的提示词快照；未提供或未自定义时使用内置默认正文。 */
  promptOverrides?: PromptOverrides;
  /** 当设为 "chat" 时使用纯闲聊模式，不产生标记块或表单 */
  mode?: "project" | "chat";
}

/**
 * 创建 Conversation Agent，负责和用户交互、生成问题表单并整理 user_input。
 */
export function createConversationAgent(options: ConversationAgentOptions = {}) {
  const modelSelection = resolveAgentModelSelection(
    options.modelProfile,
    "conversation",
  );
  const model = createChatModel({}, modelSelection);
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

/** 返回 Conversation Agent 当前实际模型，供流计费和诊断报告复用。 */
export function resolveConversationModel(
  options: ConversationAgentOptions,
): ResolvedAgentModelSelection | undefined {
  return resolveAgentModelSelection(options.modelProfile, "conversation");
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
    webSearchEnabled: options.mode === "chat" ? false : webSearchEnabled,
    mode: options.mode ?? "project",
    promptOverrides: options.promptOverrides,
  });
}

interface ConversationPromptOptions {
  webSearchEnabled: boolean;
  mode?: "project" | "chat";
  promptOverrides?: PromptOverrides;
}

/**
 * 根据本轮工具能力、模式和生效提示词生成 Conversation Agent 系统提示。
 *
 * 提示词正文经 Prompt Resolver 解析（override 优先，否则内置默认），运行时日期和
 * 联网搜索规范仍按既有顺序追加，自定义内容不会改变追加规则。
 */
function buildConversationPrompt({
  webSearchEnabled,
  mode,
  promptOverrides,
}: ConversationPromptOptions): string {
  const runtimePrompt = buildRuntimeContextPrompt();
  const body = resolvePromptContent(
    mode === "chat" ? "conversation-agent-chat" : "conversation-agent-project",
    promptOverrides,
  );

  // 纯闲聊模式：只用简短提示
  if (mode === "chat") {
    return `${body}

${runtimePrompt}`;
  }

  if (!webSearchEnabled) {
    return `${body}

${runtimePrompt}`;
  }

  return `${body}

${runtimePrompt}

${WEB_SEARCH_USAGE_PROMPT}`;
}

