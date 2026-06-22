import { z } from "zod";

/**
 * Agent 可按需启用的运行时工具名称。
 */
export const AgentRuntimeToolSchema = z.enum([
  "web_search",
  "kg_file_create",
  "kg_file_read",
  "kg_file_insert",
  "kg_file_update",
  "kg_file_delete_content",
]);

/**
 * Agent 可按需启用的运行时工具名称类型。
 */
export type AgentRuntimeTool = z.infer<typeof AgentRuntimeToolSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  reasoningContent: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
