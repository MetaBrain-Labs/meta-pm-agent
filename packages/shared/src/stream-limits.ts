/**
 * 流式展示文本边界
 *
 * 定义 API 与前端共同使用的流式推理文本上限，避免长时间模型输出在持久化、
 * 状态复制和浏览器渲染过程中形成无界内存增长。
 *
 * Responsibilities:
 * - 提供统一的可见推理字符上限
 * - 追加流式文本时保留最新内容并标记前序截断
 *
 * Notes:
 * - 该限制只约束用户可见的运行轨迹，不修改模型上下文或业务结构化结果。
 */

/** 单个 Agent 或 SubAgent 在消息中保留的最大可见推理字符数。 */
export const MAX_VISIBLE_REASONING_CHARS = 48_000;

const REASONING_TRUNCATION_NOTICE = "[较早的思考过程已截断以保护页面内存]\n";

/**
 * 在固定字符预算内追加流式推理，超限时保留最新内容。
 */
export function appendBoundedReasoning(
  existing: string | undefined,
  chunk: string,
  maxChars = MAX_VISIBLE_REASONING_CHARS,
): string {
  const combined = `${existing ?? ""}${chunk}`;
  if (combined.length <= maxChars) return combined;

  const retainedChars = Math.max(
    0,
    maxChars - REASONING_TRUNCATION_NOTICE.length,
  );
  return `${REASONING_TRUNCATION_NOTICE}${combined.slice(-retainedChars)}`;
}
