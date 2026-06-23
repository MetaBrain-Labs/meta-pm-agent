/**
 * 表单答案识别工具
 *
 * 提供对 Conversation Agent 输出中 [form answers] 标记块的快速判定。
 *
 * Responsibilities:
 * - 判断文本是否包含表单答案标记
 */

export function isFormAnswer(text: string): boolean {
  return /^\[form answers\s*[-–—]\s*[\w-]+\]/m.test(text);
}
