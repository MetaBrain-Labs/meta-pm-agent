/**
 * Question-Form 解析工具
 * 用于检测和提取 LLM 响应中的 <question-form> 标签
 */

export interface QuestionFormData {
  id: string;
  title: string;
  body: Record<string, unknown>;
  rawBody: string;
  fullMatch: string;
}

/**
 * 从文本中解析 <question-form> 标签
 */
export function parseQuestionForm(text: string): QuestionFormData | null {
  const regex =
    /<question-form\s+id="([^"]*)"\s+title="([^"]*)"\s*>([\s\S]*?)<\/question-form>/;
  const match = text.match(regex);
  if (!match) return null;

  const rawBody = match[3].trim();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }

  return {
    id: match[1],
    title: match[2],
    body,
    rawBody,
    fullMatch: match[0],
  };
}

/**
 * 检测文本是否包含 <question-form> 标签
 */
export function hasQuestionForm(text: string): boolean {
  return /<question-form\s+id="[^"]*"\s+title="[^"]*"\s*>/.test(text);
}

/**
 * 检测用户消息是否为表单答案提交
 * 格式: [form answers — <formId>]\n\n- key: value\n...
 */
export function isFormAnswer(text: string): boolean {
  return /^\[form answers\s*[-—]\s*\w+\]/m.test(text);
}

/**
 * 解析表单答案，提取 key-value 对
 */
export function parseFormAnswers(text: string): Record<string, string> | null {
  const answers: Record<string, string> = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^-\s*([^:]+):\s*(.*)$/);
    if (match) {
      answers[match[1].trim()] = match[2].trim();
    }
  }
  return Object.keys(answers).length > 0 ? answers : null;
}
