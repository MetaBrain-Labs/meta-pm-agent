/**
 * 聊天共享 Schema
 *
 * 定义运行时可识别的工具名称和基础聊天消息结构，供 API、前端和 Agent Runtime
 * 共享同一份类型约束。
 *
 * Responsibilities:
 * - 维护用户可见工具和内部 Agent 工具的稳定枚举
 * - 定义聊天消息 DTO 的基础校验结构
 *
 * Notes:
 * - 知识图谱工具由 runtime 授权策略控制，不作为任意用户文件访问能力暴露。
 */

import { z } from "zod";

/**
 * Agent 可按需启用的运行时工具名称。
 */
export const AgentRuntimeToolSchema = z.enum([
  "web_search",
  "kg_file_read",
  "kg_file_query_nodes",
  "kg_file_query_relations",
  "kg_file_read_by_source_task",
  "kg_file_add_summary",
  "kg_file_add_nodes",
  "kg_file_deprecate_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
  "kg_file_raise_blocker",
]);

/**
 * Agent 可按需启用的运行时工具名称类型。
 */
export type AgentRuntimeTool = z.infer<typeof AgentRuntimeToolSchema>;

/**
 * Executor 失败后由 SSE 暴露的定点恢复动作。
 */
export const WorkflowRetryActionSchema = z.object({
  type: z.literal("resume_executor_task"),
  taskId: z.string().min(1),
  agentType: z.string().min(1),
});

export type WorkflowRetryAction = z.infer<typeof WorkflowRetryActionSchema>;

/**
 * 浏览器提交给 API 的定点恢复命令；Agent 类型由服务端工作流状态校验。
 */
export const WorkflowRetryRequestSchema = WorkflowRetryActionSchema.omit({
  agentType: true,
});

export type WorkflowRetryRequest = z.infer<typeof WorkflowRetryRequestSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  reasoningContent: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
