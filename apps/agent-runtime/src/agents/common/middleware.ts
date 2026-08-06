/**
 * Agent Runtime 默认中间件
 *
 * 基于 LangChain JS prebuilt middleware，为所有 DeepAgent 入口提供一致的上下文裁剪
 * 和调用次数保护。该模块只处理横切运行时约束，不改变各 Agent 的业务提示词、
 * 工具授权或持久化契约。
 *
 * Responsibilities:
 * - 为长工具链运行清理旧工具结果，降低上下文膨胀
 * - 限制单次 Agent 运行中的模型调用次数，防止异常循环
 * - 限制单次 Agent 运行中的工具调用次数，控制成本和延迟
 *
 * Notes:
 * - 暂不启用 HITL/PII/ProviderToolSearch，避免引入 checkpointer 或 provider 专属行为。
 */

import {
  ClearToolUsesEdit,
  contextEditingMiddleware,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
  type AnyAgentMiddleware,
} from "langchain";

const DEFAULT_CONTEXT_EDIT_TRIGGER_TOKENS = 124_000;
const DEFAULT_CONTEXT_EDIT_KEEP_TOOL_RESULTS = 40;
const DEFAULT_MODEL_CALL_RUN_LIMIT = 40;
const DEFAULT_TOOL_CALL_RUN_LIMIT = 40;

/**
 * 创建所有 Agent 默认共享的 LangChain middleware。
 */
export function createDefaultAgentMiddleware(): AnyAgentMiddleware[] {
  return [
    contextEditingMiddleware({
      edits: [
        new ClearToolUsesEdit({
          trigger: { tokens: DEFAULT_CONTEXT_EDIT_TRIGGER_TOKENS },
          keep: { messages: DEFAULT_CONTEXT_EDIT_KEEP_TOOL_RESULTS },
          clearToolInputs: false,
          placeholder: "[cleared older tool result]",
        }),
      ],
      tokenCountMethod: "approx",
    }),
    modelCallLimitMiddleware({
      runLimit: DEFAULT_MODEL_CALL_RUN_LIMIT,
      exitBehavior: "error",
    }),
    toolCallLimitMiddleware({
      runLimit: DEFAULT_TOOL_CALL_RUN_LIMIT,
      exitBehavior: "continue",
    }),
  ];
}
