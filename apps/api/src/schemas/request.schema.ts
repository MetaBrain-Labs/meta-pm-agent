/**
 * 聊天请求 Schema。
 *
 * 定义 `/api/chat` 与 `/api/chat/stop` 的请求体验证规则，并约束可选的
 * Human-in-the-Loop resume payload，确保 API 层只接收合法的用户决策结构。
 *
 * Responsibilities:
 * - 校验聊天消息、工具开关和请求表单上下文
 * - 校验 LangGraph HITL 恢复命令所需的 threadId 与 response
 * - 导出控制器复用的请求体类型
 *
 * Notes:
 * - 具体的 HITL 中断释放与恢复由 agent-runtime 的 LangGraph 小图负责。
 */

import { z } from "zod";
import {
  AgentRuntimeToolSchema,
  ChatMessageSchema,
  WorkflowRetryRequestSchema,
} from "@repo/shared";

const HitlDecisionSchema = z.union([
  z.object({ type: z.literal("approve") }),
  z.object({ type: z.literal("reject"), message: z.string().optional() }),
  z.object({
    type: z.literal("edit"),
    editedAction: z.object({
      name: z.string().min(1),
      args: z.record(z.unknown()),
    }),
  }),
  z.object({ type: z.literal("respond"), message: z.string() }),
]);

const HitlResumeSchema = z.object({
  threadId: z.string().min(1),
  response: z.object({
    decisions: z.array(HitlDecisionSchema).min(1),
  }),
});

/**
 * 向 Agent 发送聊天消息的请求体校验规则。
 */
export const ChatRequestSchema = z
  .object({
    chatId: z.string().uuid().optional(),
    requestFormId: z.string().uuid().optional(),
    messages: z.array(ChatMessageSchema).min(1),
    enabledTools: z.array(AgentRuntimeToolSchema).optional(),
    hitlResume: HitlResumeSchema.optional(),
    workflowRetry: WorkflowRetryRequestSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.hitlResume && value.workflowRetry) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "hitlResume and workflowRetry cannot be used together.",
        path: ["workflowRetry"],
      });
    }
    if (value.workflowRetry && (!value.chatId || !value.requestFormId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workflowRetry requires chatId and requestFormId.",
        path: ["workflowRetry"],
      });
    }
  });

/**
 * 停止指定会话当前 Agent 运行的请求体校验规则。
 */
export const StopChatRequestSchema = z.object({
  chatId: z.string().uuid(),
});

/**
 * 聊天请求体的类型。
 */
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type StopChatRequest = z.infer<typeof StopChatRequestSchema>;
