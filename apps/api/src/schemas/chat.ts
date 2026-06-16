import { z } from "zod";
import { ChatMessageSchema } from "@repo/shared";

export const ChatRequestSchema = z.object({
  chatId: z.string().uuid().optional(),
  requestFormId: z.string().uuid().optional(),
  messages: z.array(ChatMessageSchema).min(1),
});

export const CreateChatRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;
