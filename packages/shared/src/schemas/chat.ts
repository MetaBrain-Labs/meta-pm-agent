import { z } from "zod";

/**
 * Agent 可按需启用的运行时工具名称。
 */
export const AgentRuntimeToolSchema = z.enum(["web_search"]);

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
