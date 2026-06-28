/**
 * 表单答案识别工具
 *
 * 提供对 Conversation Agent 输出中 [form answers] 标记块的快速判定和表单 ID 提取。
 *
 * Responsibilities:
 * - 判断文本是否包含表单答案标记
 * - 提取 question-form id 供恢复流程分流
 */

export function isFormAnswer(text: string): boolean {
  return getFormAnswerId(text) !== null;
}

/**
 * 提取表单答案头部里的 question-form id，用于区分普通问答表单和产品工作流恢复表单。
 */
export function getFormAnswerId(text: string): string | null {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const match = /^\[form answers\s*(?:-|–|—)\s*([^\]]+)\]/i.exec(firstLine);
  return match?.[1]?.trim() || null;
}
