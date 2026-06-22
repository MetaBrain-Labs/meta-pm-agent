/**
 * 解析 JSON 对象
 */
export function parseJsonObject(text: string): unknown | null {
  for (const jsonText of extractJsonObjectCandidates(text)) {
    try {
      return JSON.parse(jsonText);
    } catch {
      // 模型流里可能混入中间文本或不完整 JSON，继续尝试下一个候选对象。
    }
  }

  return null;
}

/**
 * 提取可能的 JSON 对象候选，优先尝试最后出现的完整对象。
 */
function extractJsonObjectCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (withoutFence.startsWith("{") && withoutFence.endsWith("}")) {
    return [withoutFence];
  }

  const starts: number[] = [];
  let inString = false;
  let escaping = false;

  for (let index = 0; index < withoutFence.length; index += 1) {
    const char = withoutFence[index];

    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      starts.push(index);
    }
  }

  return starts
    .map((start) => {
      const end = findBalancedObjectEnd(withoutFence, start);
      return end === -1 ? null : withoutFence.slice(start, end + 1);
    })
    .filter((candidate): candidate is string => Boolean(candidate))
    .reverse();
}

/**
 * 从指定左花括号开始，寻找字符串安全的匹配右花括号。
 */
function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") continue;

    depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}
