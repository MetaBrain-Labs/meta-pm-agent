/**
 * Chat SSE 公共事件契约
 *
 * 定义浏览器通过 `/api/chat` 实际能够收到的事件集合。运行时内部完成事件和
 * 完整知识图谱事件不属于该协议，由 API 适配器消费后再决定是否产生公开事件。
 *
 * Responsibilities:
 * - 提供可判别的 ChatSseEventSchema
 * - 为 API 写入与 Web 消费提供同一类型来源
 * - 在网络边界拒绝未知或字段缺失的事件
 */

import { z } from "zod";
import { RequestAnalysisSchema } from "../agent/request-analysis";
import { WorkflowRetryActionSchema } from "../schemas/chat";

const AgentTypeSchema = z.string().min(1);
const HumanInTheLoopInterruptSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  value: z.object({
    actionRequests: z.array(
      z.object({
        name: z.literal("question_form"),
        args: z.object({
          questionForm: z.string(),
          formId: z.string().min(1),
          agentType: z.string().optional(),
        }),
        description: z.string().optional(),
      }),
    ),
    reviewConfigs: z.array(
      z.object({
        allowedDecisions: z.array(
          z.enum(["approve", "reject", "edit", "respond"]),
        ),
      }),
    ),
  }),
});
const CommonEventFields = {
  roundId: z.string().optional(),
  id: z.string().optional(),
  content: z.string().optional(),
  agentType: AgentTypeSchema.optional(),
  status: z.enum(["started", "completed"]).optional(),
  phase: z.enum(["planning", "execution", "review"]).optional(),
  parallelAgents: z.array(AgentTypeSchema).optional(),
  taskId: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolArgs: z.record(z.unknown()).optional(),
  toolResult: z.unknown().optional(),
  subagentType: z.string().optional(),
  description: z.string().optional(),
  result: z.unknown().optional(),
  inputTokens: z.number().optional(),
  cacheHitInputTokens: z.number().optional(),
  cacheMissInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  costInput: z.number().optional(),
  costOutput: z.number().optional(),
  costTotal: z.number().optional(),
  durationMs: z.number().optional(),
  createdAt: z.string().optional(),
  error: z.string().optional(),
  chatId: z.string().optional(),
  title: z.string().optional(),
  runId: z.string().optional(),
  workspaceId: z.string().optional(),
  analysis: RequestAnalysisSchema.optional(),
  interrupt: HumanInTheLoopInterruptSchema.optional(),
  retryAction: WorkflowRetryActionSchema.optional(),
  terminal: z.boolean().optional(),
} as const;

function eventObject<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...CommonEventFields, ...shape });
}

/** 浏览器 Chat 流事件的运行时校验 schema。 */
export const ChatSseEventSchema = z.discriminatedUnion("type", [
  eventObject({ type: z.literal("start") }),
  eventObject({
    type: z.literal("workflow-round-start"),
    roundId: z.string().min(1),
  }),
  eventObject({
    type: z.literal("agent-status"),
    agentType: AgentTypeSchema,
    status: z.enum(["started", "completed"]),
  }),
  eventObject({ type: z.literal("thinking"), content: z.string() }),
  eventObject({ type: z.literal("text"), content: z.string() }),
  eventObject({ type: z.literal("question-form-start") }),
  eventObject({ type: z.literal("question-form-complete"), content: z.string() }),
  eventObject({ type: z.literal("workflow-resume-start") }),
  eventObject({ type: z.literal("workflow-resume-complete"), content: z.string() }),
  eventObject({
    type: z.literal("human-interrupt"),
    interrupt: HumanInTheLoopInterruptSchema,
  }),
  eventObject({ type: z.literal("user-input-start") }),
  eventObject({ type: z.literal("user-input-complete"), content: z.string() }),
  eventObject({ type: z.literal("request-analysis-start") }),
  eventObject({
    type: z.literal("request-analysis-complete"),
    content: z.string(),
    analysis: RequestAnalysisSchema,
  }),
  eventObject({
    type: z.literal("tool-call"),
    toolName: z.string().min(1),
  }),
  eventObject({
    type: z.literal("tool-result"),
    toolName: z.string().min(1),
    toolResult: z.unknown(),
  }),
  eventObject({
    type: z.literal("subagent-start"),
    agentType: AgentTypeSchema,
    subagentType: z.string().min(1),
  }),
  eventObject({
    type: z.literal("subagent-thinking"),
    agentType: AgentTypeSchema,
    subagentType: z.string().min(1),
    content: z.string(),
  }),
  eventObject({
    type: z.literal("subagent-result"),
    agentType: AgentTypeSchema,
    subagentType: z.string().min(1),
    result: z.unknown(),
  }),
  eventObject({
    type: z.literal("token-usage"),
    agentType: AgentTypeSchema,
    inputTokens: z.number(),
    cacheHitInputTokens: z.number(),
    cacheMissInputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    costInput: z.number(),
    costOutput: z.number(),
    costTotal: z.number(),
    durationMs: z.number(),
  }),
  eventObject({
    type: z.literal("conversation-title"),
    chatId: z.string().min(1),
    title: z.string(),
  }),
  eventObject({
    type: z.literal("document-evidence-resolution-complete"),
    runId: z.string().min(1),
    workspaceId: z.string().min(1),
  }),
  eventObject({ type: z.literal("error"), error: z.string() }),
  eventObject({ type: z.literal("abort") }),
]);

/** 浏览器通过 `/api/chat` 消费的公共事件联合类型。 */
export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;
