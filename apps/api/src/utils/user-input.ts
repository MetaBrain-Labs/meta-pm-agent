import { z } from "zod";

const UserInputRecordSchema = z.object({
  index: z.number().int().positive(),
  content: z.string().min(1),
  type: z.string().min(1),
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
