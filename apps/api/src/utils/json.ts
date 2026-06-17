/**
 * 从文本中解析 JSON 对象。
 */
export function parseJsonObject(text: string): unknown | null {
  // 兼容 tagged block 内部、Markdown 代码块和纯 JSON 三种常见输出形态。
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

/**
 * 从文本中提取 JSON 对象，支持以下三种格式：
 * 1. tagged block 内部的 JSON
 * 2. Markdown 代码块中的 JSON
 * 3. 纯 JSON 字符串
 */
function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (withoutFence.startsWith("{") && withoutFence.endsWith("}")) {
    return withoutFence;
  }

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return withoutFence.slice(start, end + 1);
}
