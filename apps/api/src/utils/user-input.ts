import { z } from "zod";

const UserInputRecordSchema = z.object({
  index: z.number().int().positive(),
  content: z.string().min(1),
  type: z.enum(["陈述", "提问", "补充", "请求"]),
});

const UserInputPayloadSchema = z.object({
  user_input: z.array(UserInputRecordSchema),
});

export type UserInputRecord = z.infer<typeof UserInputRecordSchema>;

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

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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
