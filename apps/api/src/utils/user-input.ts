import { z } from "zod";

/**
 * 用户输入记录的校验规则，对应消息中 user-input tagged block 内的单条记录。
 */
const UserInputRecordSchema = z.object({
  index: z.number().int().positive(),
  content: z.string().min(1),
  type: z.string().min(1),
});

/**
 * 用户输入载荷的整体结构校验，包含一组 user_input 记录。
 */
const UserInputPayloadSchema = z.object({
  user_input: z.array(UserInputRecordSchema),
});

/**
 * 单条用户输入记录的类型。
 */
export type UserInputRecord = z.infer<typeof UserInputRecordSchema>;

/**
 * 从消息文本中解析 user-input tagged block，提取用户输入结构化数据。
 * 支持 tagged block、Markdown 代码块和纯 JSON 三种格式。
 */
export function parseUserInputPayload(
  text: string,
): UserInputRecord[] | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  const parsed = tryParseJson(jsonText);
  if (!parsed) return null;

  const result = UserInputPayloadSchema.safeParse(parsed);
  if (!result.success) return null;

  return result.data.user_input;
}

/**
 * 安全地解析 JSON，解析失败返回 null。
 */
function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 从文本中提取 JSON 对象，优先匹配 user-input tagged block，
 * 其次尝试 Markdown 代码块和纯 JSON 格式。
 */
function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const userInputBlock = extractTaggedBlock(
    trimmed,
    "<user-input",
    "</user-input>",
  );
  if (userInputBlock) {
    return userInputBlock;
  }

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

/**
 * 从文本中按起始和结束标记提取 tagged block 内容。
 */
function extractTaggedBlock(
  text: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const startIndex = text.search(new RegExp(escapeRegExp(startMarker), "i"));
  if (startIndex === -1) return null;

  const openEnd = text.indexOf(">", startIndex);
  if (openEnd === -1) return null;

  const endIndex = text.indexOf(endMarker, openEnd + 1);
  if (endIndex === -1) return null;

  return text.slice(openEnd + 1, endIndex).trim();
}

/**
 * 转义正则表达式特殊字符，防止 marker 作为正则解析时产生意外匹配。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
