import { z } from "zod";
import { ChatMessageSchema } from "@repo/shared";

export const ChatRequestSchema = z.object({
  chatId: z.string().uuid().optional(),
  requestFormId: z.string().uuid().optional(),
  messages: z.array(ChatMessageSchema).min(1),
});

export const CreateChatRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
});

export const ListChatsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  localPath: z.string().trim().min(1).max(2048).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;
export type ListChatsQuery = z.infer<typeof ListChatsQuerySchema>;
export type CreateWorkspaceRequest = z.infer<
  typeof CreateWorkspaceRequestSchema
>;
