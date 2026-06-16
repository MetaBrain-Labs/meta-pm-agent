import type { UserInputItem } from "../types";

interface UserInputPayload {
  user_input: UserInputItem[];
}

const OPEN_RE = /<user-input\b[^>]*>/i;
const CLOSE_TAG = "</user-input>";

export function parseUserInputBlock(raw: string): UserInputItem[] | null {
  const jsonText = extractJson(raw);
  if (!jsonText) return null;

  try {
    const data = JSON.parse(jsonText) as UserInputPayload;
    if (!Array.isArray(data.user_input)) return null;
    const items = data.user_input
      .map(normalizeItem)
      .filter((item): item is UserInputItem => item !== null);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const openMatch = OPEN_RE.exec(trimmed);
  if (openMatch) {
    const start = openMatch.index + openMatch[0].length;
    const end = trimmed.indexOf(CLOSE_TAG, start);
    if (end === -1) return null;
    return trimmed.slice(start, end).trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function normalizeItem(raw: unknown): UserInputItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (
    typeof item.index !== "number" ||
    !Number.isInteger(item.index) ||
    item.index <= 0 ||
    typeof item.content !== "string" ||
    item.content.trim().length === 0 ||
    !isUserInputType(item.type)
  ) {
    return null;
  }

  return {
    index: item.index,
    content: item.content.trim(),
    type: item.type,
  };
}

function isUserInputType(raw: unknown): raw is UserInputItem["type"] {
  return raw === "陈述" || raw === "提问" || raw === "补充" || raw === "请求";
}
