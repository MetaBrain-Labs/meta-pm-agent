import { z } from "zod";
import { parseJsonObject } from "../../utils/json";

const UserInputRecordSchema = z.object({
  index: z.number().int().positive(),
  content: z.string().min(1),
  type: z.string().min(1),
});

const UserInputPayloadSchema = z.object({
  user_input: z.array(UserInputRecordSchema),
});

export type UserInputRecord = z.infer<typeof UserInputRecordSchema>;

export function parseUserInputBlock(text: string): UserInputRecord[] {
  // Conversation Agent 通常输出 tagged block；同时兼容裸 JSON，方便测试和后续直接调用图。
  const block = extractTaggedBlock(text, "<user-input", "</user-input>");
  const parsed = parseJsonObject(block ?? text);
  const result = UserInputPayloadSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error("Conversation Agent did not produce a valid user_input payload.");
  }

  return result.data.user_input;
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
