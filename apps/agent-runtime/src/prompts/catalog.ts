/**
 * 可配置提示词注册表（Prompt Registry）
 *
 * 以显式白名单的方式登记允许用户在设置页查看与修改的产品级提示词。只有出现在本文件
 * 的提示词才会被设置 API 暴露、才会接受 override；其余 system prompt、内部安全提示词、
 * 工具调用与图谱授权协议一律不注册，因此无法通过 API 获取或修改。
 *
 * Responsibilities:
 * - 声明 configurable 提示词的 id、名称、说明、分类与必填标记
 * - 将 defaultContent 绑定到各 Agent 现有的提示词常量，避免提示词文本出现第二份来源
 * - 提供按 id 查询与 id 类型收窄，作为运行时的唯一入口
 *
 * Notes:
 * - defaultContent 是不可变的内置默认值，用户自定义只写入 workspace override
 * - requiredTokens 是需要用户保留的字面协议标记；本项目提示词由字符串拼接组合，
 *   不存在 `{{var}}` 模板语法，因此变量保护以标记存在性校验实现
 */

import { CHAT_ONLY_PROMPT, DISCOVERY_PROMPT } from "../agents/conversation/prompt";
import { REQUEST_AGENT_PROMPT } from "../agents/request/prompt";
import { PRD_DOCUMENT_AGENT_STRUCTURE } from "../agents/document-agent/prompt";

/**
 * configurable 提示词白名单。
 *
 * 新增条目时必须同时确认三件事：该提示词只影响产品行为、不影响机器可校验的协议契约、
 * 且可以被 requiredTokens 保护。任何涉及权限、安全、工具调用约束的提示词都不得注册。
 */
export const PROMPT_CATALOG = [
  {
    id: "conversation-agent-project",
    name: "Conversation Agent（项目模式）",
    description:
      "项目请求的承接方式、澄清表单策略与 user_input 分解规则。运行时日期与联网搜索规范由系统自动追加，正文无需重复。",
    category: "conversation",
    defaultContent: DISCOVERY_PROMPT,
    requiredTokens: [
      "<user-input>",
      "</user-input>",
      "user_input",
      "<question-form>",
    ],
    editable: true,
    resettable: true,
  },
  {
    id: "conversation-agent-chat",
    name: "Conversation Agent（闲聊模式）",
    description:
      "请求被判定为闲聊时的回复规范：自然、简洁，不产生标记块与表单。",
    category: "conversation",
    defaultContent: CHAT_ONLY_PROMPT,
    requiredTokens: [],
    editable: true,
    resettable: true,
  },
  {
    id: "request-agent-analysis",
    name: "Request Agent（需求分析）",
    description:
      "把 user_input 拆分为 business_model / questions / chitchat 的抽取与判定策略。JSON 字段名属于下游契约，必须保留。",
    category: "analysis",
    defaultContent: REQUEST_AGENT_PROMPT,
    requiredTokens: [
      "business_model",
      "questions",
      "chitchat",
      "user_goal",
      "goal_constraints",
      "missing_information",
      "covered_user_input_indexes",
    ],
    editable: true,
    resettable: true,
  },
  {
    id: "document-agent-prd-structure",
    name: "PRD 章节结构",
    description:
      "Document Agent 生成 PRD 时必须覆盖的章节清单。角色约束、技能读取方式与质量底线由系统固定段保证。",
    category: "document",
    defaultContent: PRD_DOCUMENT_AGENT_STRUCTURE,
    requiredTokens: [],
    editable: true,
    resettable: true,
  },
] as const;

/** 单条注册表条目的字面量类型（保留 id 与 requiredTokens 的字面量信息）。 */
export type PromptCatalogEntryShape = (typeof PROMPT_CATALOG)[number];

/** 已注册的 configurable 提示词 id 联合类型。 */
export type PromptId = PromptCatalogEntryShape["id"];

/**
 * 按 id 读取注册表条目；未注册（含内部提示词）一律返回 null，调用方不得回退到其他键。
 */
export function getPromptCatalogEntry(
  promptId: string,
): PromptCatalogEntryShape | null {
  return PROMPT_CATALOG.find((entry) => entry.id === promptId) ?? null;
}

/** 收窄任意字符串到已注册的 prompt id，供 HTTP 参数与数据库字段校验复用。 */
export function isConfigurablePromptId(promptId: string): promptId is PromptId {
  return PROMPT_CATALOG.some((entry) => entry.id === promptId);
}
