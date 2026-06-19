import { z } from "zod";
import { AgentRuntimeToolSchema, ChatMessageSchema } from "@repo/shared";

/**
 * 向 Agent 发送聊天消息的请求体校验规则。
 */
export const ChatRequestSchema = z.object({
  chatId: z.string().uuid().optional(),
  requestFormId: z.string().uuid().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  enabledTools: z.array(AgentRuntimeToolSchema).optional(),
});

/**
 * 聊天请求体的类型。
 */
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
