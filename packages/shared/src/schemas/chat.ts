import { z } from "zod";

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  reasoningContent: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
