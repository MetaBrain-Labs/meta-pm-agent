/**
 * 会话任务轮次索引
 *
 * 把当前会话的消息整理成「一轮用户请求 → Planner 规划 → DAG 执行 → 图谱更新」的
 * 只读索引，供任务历史面板展示。
 *
 * Responsibilities:
 * - 按消息顺序切分工作流轮次，并保留原始消息 ID
 * - 从已有字段推导每轮的整体状态与各任务状态
 *
 * Notes:
 * - 只读：不改写消息、不新增持久化字段、不参与任务调度。
 * - 数据范围明确限定为「当前会话」；时间取自消息自身时间，不冒充任务开始时间。
 */

import type {
  ExecutorAgentResult,
  Message,
  ProductWorkflowResult,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "../types";
import { buildTaskStatus, type TaskNodeStatus } from "./workflow-tasks";

/** 一轮工作流在界面上的整体状态。 */
export type RoundStatus =
  | "completed"
  | "running"
  | "waiting"
  | "pending"
  | "failed";

/** 一轮工作流的历史条目。 */
export interface TaskRound {
  /** 稳定标识：优先工作流轮次 ID，否则用原消息 ID。 */
  id: string;
  /** 原消息 ID，供定位与调试。 */
  messageId: string;
  /** 展示序号，从 1 开始。 */
  index: number;
  /** 轮次标题：请求摘要或任务标题。 */
  title: string;
  /** 轮次副标题：请求摘要，缺失时回退到首个任务标题。 */
  subtitle: string;
  status: RoundStatus;
  /** 是否为本轮 Planner 产出（initial / supplement），仅在存在计划时有值。 */
  planStatus: TaskExecutionPlan["status"] | null;
  /** 消息自身时间。 */
  updatedAt: string;
  /** 触发该轮的用户请求原文。 */
  userRequest: string;
  analysis: Message["requestAnalysis"];
  plan: TaskExecutionPlan | null;
  results: ExecutorAgentResult[];
  review: ProductWorkflowResult | null;
  completion: string | null;
  interrupted: boolean;
  agentError: string | null;
  /** 每个任务的状态。 */
  taskStatus: Map<string, TaskNodeStatus>;
}

/**
 * 从消息列表构建任务轮次索引。
 *
 * 一轮请求在后端会落成多条助手消息（规划、各 Executor 结果、Critique 等），因此
 * 必须先按轮次分组再取各字段：否则同一次请求会被拆成十几个"未命名任务"。
 *
 * 分组键优先取 `workflowRoundId`；缺失时回退到该助手消息之前最近的一条用户消息，
 * 保证同一次请求的不同阶段仍归为同一轮。
 */
export function buildTaskRounds(
  messages: Message[],
  options: { streaming: boolean },
): TaskRound[] {
  const groups = groupWorkflowMessages(messages);

  return groups
    .map((group, index) => toTaskRound(group, index, options))
    .filter((round): round is TaskRound => round !== null);
}

/** 一轮请求对应的原始消息集合。 */
interface RoundGroup {
  key: string;
  messages: Message[];
  /** 触发这一轮的用户请求原文。 */
  userRequest: string;
}

/**
 * 把助手消息按轮次分组。
 *
 * 只保留承载工作流结构的消息；纯对话回复（Conversation Agent 的普通回答）不算
 * 任务，避免列表里出现空轮次。
 */
function groupWorkflowMessages(messages: Message[]): RoundGroup[] {
  const groups = new Map<string, RoundGroup>();
  let lastUserId: string | null = null;
  let lastUserRequest = "";

  for (const message of messages) {
    if (message.role === "user") {
      lastUserId = message.id;
      lastUserRequest = message.content.trim();
      continue;
    }
    if (!carriesWorkflow(message)) continue;

    // 优先使用后端给出的工作流轮次 ID；缺失时归到最近一次用户请求。
    const key = message.workflowRoundId ?? lastUserId ?? message.id;
    const existing = groups.get(key);
    if (existing) {
      existing.messages.push(message);
      continue;
    }
    groups.set(key, {
      key,
      messages: [message],
      userRequest: lastUserRequest,
    });
  }

  return [...groups.values()];
}

/** 把一组消息合并成一条轮次记录；没有任何工作流内容时返回 null。 */
function toTaskRound(
  group: RoundGroup,
  index: number,
  options: { streaming: boolean },
): TaskRound | null {
  const merged = mergeRoundMessages(group.messages);
  const plan = merged.plannerExecution?.plan ?? null;
  const review = merged.plannerReview?.result ?? null;
  const results = merged.executorResults ?? [];
  const completion = merged.workflowCompletion?.content ?? null;

  // 没有任何计划/分析/完成信息的轮次不算任务，直接丢弃。
  if (!plan && !merged.requestAnalysis && !review && !completion) return null;

  return {
    id: group.key,
    messageId: group.messages[0]!.id,
    index: index + 1,
    title:
      plan?.request_summary ||
      review?.request_summary ||
      plan?.tasks[0]?.title ||
      "未命名任务",
    subtitle:
      plan?.request_summary || plan?.tasks[0]?.title || "等待 Planner 规划",
    status: resolveRoundStatus({
      message: merged,
      plan,
      review,
      isLastAgentMessage: options.streaming,
      streaming: options.streaming,
    }),
    planStatus: plan?.status ?? null,
    updatedAt: new Date(merged.timestamp).toISOString(),
    userRequest: group.userRequest,
    analysis: merged.requestAnalysis,
    plan,
    results,
    review,
    completion,
    interrupted: Boolean(merged.interrupted),
    agentError: merged.agentError?.message ?? null,
    taskStatus: plan
      ? buildTaskStatus(
          plan.tasks,
          results,
          merged.activeAgent,
          merged.activeAgents,
          readFailedTaskIds(merged, results),
        )
      : new Map(),
  };
}

/**
 * 合并同一轮内多条消息的工作流字段。
 *
 * 后端把规划、Executor 结果与 Critique 分散在不同消息上（部分还在后续消息里回挂），
 * 这里按"后者优先、集合类字段取更完整的一方"合并，不改写任何持久化数据。
 */
function mergeRoundMessages(messages: Message[]): Message {
  const base = messages[0]!;
  return messages.reduce<Message>((acc, message) => {
    const results =
      (message.executorResults?.length ?? 0) >= (acc.executorResults?.length ?? 0)
        ? message.executorResults ?? acc.executorResults
        : acc.executorResults;

    return {
      ...acc,
      // 轮次时间取最早一条消息，代表这一轮开始的时间。
      timestamp: Math.min(acc.timestamp, message.timestamp),
      content: acc.content || message.content,
      workflowRoundId: acc.workflowRoundId ?? message.workflowRoundId,
      userInput: message.userInput ?? acc.userInput,
      requestAnalysis: message.requestAnalysis ?? acc.requestAnalysis,
      plannerExecution: message.plannerExecution ?? acc.plannerExecution,
      plannerReview: message.plannerReview ?? acc.plannerReview,
      workflowCompletion: message.workflowCompletion ?? acc.workflowCompletion,
      humanInterrupt: message.humanInterrupt ?? acc.humanInterrupt,
      questionForm: message.questionForm ?? acc.questionForm,
      executorResults: results,
      agentError: acc.agentError ?? message.agentError,
      interrupted: Boolean(acc.interrupted || message.interrupted),
      activeAgent: message.activeAgent ?? acc.activeAgent,
      activeAgents:
        (message.activeAgents?.length ?? 0) > 0
          ? message.activeAgents
          : acc.activeAgents,
    };
  }, base);
}

/** 该消息是否承载工作流结构信息。 */
function carriesWorkflow(message: Message): boolean {
  return Boolean(
    message.plannerExecution ||
      message.requestAnalysis ||
      message.executorResults?.length ||
      message.plannerReview ||
      message.workflowCompletion ||
      message.userInput,
  );
}

/**
 * 从结构化错误与结果里收集失败的任务 ID。
 *
 * 只使用已有信息：Executor 自身质量校验未通过，或当前消息带有该任务的错误。
 */
function readFailedTaskIds(
  message: Message,
  results: ExecutorAgentResult[],
): Set<string> {
  const failed = new Set<string>();
  for (const result of results) {
    if (result.quality_result?.passed === false) failed.add(result.task_id);
  }
  const retryAction = message.agentError?.retryAction;
  if (retryAction?.taskId) failed.add(retryAction.taskId);
  return failed;
}

/** 推导一轮工作的整体状态。 */
function resolveRoundStatus({
  message,
  plan,
  review,
  isLastAgentMessage,
  streaming,
}: {
  message: Message;
  plan: TaskExecutionPlan | null;
  review: ProductWorkflowResult | null;
  isLastAgentMessage: boolean;
  streaming: boolean;
}): RoundStatus {
  if (message.agentError || message.interrupted) return "failed";
  if (message.humanInterrupt || message.questionForm?.state === "complete") {
    return "waiting";
  }
  if (review?.status === "requires_executor_retry") return "failed";
  if (message.workflowCompletion || review?.status === "completed") {
    return "completed";
  }
  // 正在流式输出且这是最后一轮 → 运行中。
  if (streaming && isLastAgentMessage) return "running";
  if (plan) return "running";
  return "pending";
}

/** 轮次状态的展示文案与语义色。 */
export const ROUND_STATUS_META: Record<
  RoundStatus,
  { label: string; tone: "success" | "running" | "warning" | "error" | "neutral" }
> = {
  completed: { label: "已完成", tone: "success" },
  running: { label: "执行中", tone: "running" },
  waiting: { label: "等待回答", tone: "warning" },
  pending: { label: "等待规划", tone: "neutral" },
  failed: { label: "需处理", tone: "error" },
};

/** 节点状态的展示文案与语义色。 */
export const TASK_STATUS_META: Record<
  TaskNodeStatus,
  { label: string; tone: "success" | "running" | "error" | "neutral" }
> = {
  completed: { label: "已完成", tone: "success" },
  running: { label: "执行中", tone: "running" },
  failed: { label: "失败", tone: "error" },
  waiting: { label: "等待", tone: "neutral" },
};

/** 读取某个任务的执行结果。 */
export function findTaskResult(
  results: ExecutorAgentResult[],
  taskId: string,
): ExecutorAgentResult | null {
  return results.find((result) => result.task_id === taskId) ?? null;
}

/** 读取某任务的依赖描述。 */
export function formatTaskDependencies(task: TaskExecutionNode): string {
  return task.depends_on.length > 0 ? task.depends_on.join("、") : "无";
}
