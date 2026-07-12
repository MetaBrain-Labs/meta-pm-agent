/**
 * 表单答案识别工具
 *
 * 提供对 Conversation Agent 输出中 [form answers] 标记块的快速判定和表单 ID 提取。
 *
 * Responsibilities:
 * - 判断文本是否包含表单答案标记
 * - 提取 question-form id 供恢复流程分流
 * - 判断产品工作流最终确认是否明确接受当前结果
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

/**
 * 判断用户是否在产品工作流最终确认表单中明确选择“确认接受”。
 */
export function isProductWorkflowAcceptanceAnswer(text: string): boolean {
  return (
    getFormAnswerId(text) === "product-workflow-confirmation" &&
    /^-\s*你希望如何处理当前结果？:\s*确认接受\s*$/m.test(text)
  );
}

/**
 * 判断用户是否跳过全部可选问题并进入已有设计成果确认。
 */
export function isProductWorkflowOptionalStopAnswer(text: string): boolean {
  const formId = getFormAnswerId(text);
  return Boolean(
    formId?.endsWith("-proposal-decision") &&
      /^-\s*workflow_action:\s*stop_optional_questions\s*$/m.test(text),
  );
}
