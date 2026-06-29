/**
 * Question Form 字段类型推断
 *
 * 为 Planner/Executor 汇总出的自然语言补充问题推断更合适的表单控件类型。
 * 当问题文本已经携带明确选项时，转换为 radio/select；无法可靠识别选项时，
 * 保持 textarea，避免把开放问题错误压缩成封闭选择。
 *
 * Responsibilities:
 * - 从中文/英文问题文本中提取简单选项列表
 * - 为二到四个选项使用 radio，为更多选项使用 select
 * - 为是否类问题提供稳定的三态选项
 *
 * Notes:
 * - 本模块只做保守启发式推断，不负责解析完整 Markdown 或模型结构化输出。
 */

export type InferredQuestionFormField =
  | { type: "radio"; options: string[] }
  | { type: "select"; options: string[] }
  | { type: "textarea" };

const MAX_OPTION_COUNT = 8;
const MAX_OPTION_LENGTH = 48;

/**
 * 根据问题文本推断 Question Form 字段类型。
 */
export function inferQuestionFormFieldFromText(
  question: string,
): InferredQuestionFormField {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return { type: "textarea" };

  const options = extractExplicitOptions(normalized);
  if (options.length >= 2) {
    return {
      type: options.length <= 4 ? "radio" : "select",
      options,
    };
  }

  if (isBooleanQuestion(normalized)) {
    return {
      type: "radio",
      options: ["是", "否", "不确定"],
    };
  }

  return { type: "textarea" };
}

/**
 * 提取文本里明确列出的候选项。
 */
function extractExplicitOptions(question: string): string[] {
  const optionSource =
    extractAfterOptionCue(question) ??
    extractEitherOrOptions(question) ??
    extractSlashOptions(question);
  if (!optionSource) return [];

  return normalizeOptions(optionSource);
}

/**
 * 提取 “选项：A、B、C” 或 “包括 A/B/C” 一类文本。
 */
function extractAfterOptionCue(question: string): string | null {
  const match =
    /(?:选项|可选|候选|选择|包括|包含|options?|choices?)\s*[：:]\s*(.+)$/i.exec(
      question,
    ) ??
    /(?:以下|下列)\s*(?:选项|方案|类型|方式)\s*(?:中)?\s*(.+)$/i.exec(
      question,
    );
  return match?.[1] ?? null;
}

/**
 * 提取 “A 还是 B” 形式的二选一问题。
 */
function extractEitherOrOptions(question: string): string | null {
  const match = /(.+?)\s*(?:还是|或|或者|or)\s*(.+?)[?？]?$/.exec(question);
  if (!match?.[1] || !match[2]) return null;
  const left = trimOption(match[1]);
  const right = trimOption(match[2]);
  if (!left || !right || left.length > MAX_OPTION_LENGTH) return null;
  return `${left}/${right}`;
}

/**
 * 提取 “A/B/C” 这类直接斜杠分隔选项。
 */
function extractSlashOptions(question: string): string | null {
  const match = /([\p{L}\p{N}\s_-]+(?:\s*[/／]\s*[\p{L}\p{N}\s_-]+){1,})/u.exec(
    question,
  );
  return match?.[1] ?? null;
}

/**
 * 归一化选项文本并做质量过滤。
 */
function normalizeOptions(source: string): string[] {
  const cleaned = source
    .replace(/[。.?？].*$/u, "")
    .replace(/^[（(]?(?:如|例如|e\.g\.)\s*/i, "");
  const options = cleaned
    .split(/\s*(?:[,，、;；|/／]|\s+-\s+)\s*/u)
    .map(trimOption)
    .filter(Boolean);

  const unique = [...new Set(options)];
  if (
    unique.length < 2 ||
    unique.length > MAX_OPTION_COUNT ||
    unique.some((option) => option.length > MAX_OPTION_LENGTH)
  ) {
    return [];
  }

  return unique;
}

/**
 * 清理单个选项前后的序号、引号和空白。
 */
function trimOption(option: string): string {
  return option
    .replace(/^[\s"'“”‘’`*_[\]【】()（）-]+/u, "")
    .replace(/^[A-Ha-h][).、]\s*/u, "")
    .replace(/[\s"'“”‘’`*_[\]【】()（）-]+$/u, "")
    .trim();
}

/**
 * 判断是否为适合三态选择的是否问题。
 */
function isBooleanQuestion(question: string): boolean {
  return /^(是否|要不要|需不需要|能否|可否|是否需要|is |are |do |does |should |can |would )/i.test(
    question,
  );
}
