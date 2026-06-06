import { z } from "zod";

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  reasoningContent: z.string().optional(),
});

export const ChatSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(ChatMessageSchema),
});

export const CreateChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  sessionId: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type CreateChatMessage = z.infer<typeof CreateChatMessageSchema>;
