/**
 * 产品工作流编排与格式化
 *
 * 作为 product-workflow 模块的聚合入口，负责：
 * - 编排 Planner -> Executor -> Critique 的完整产品工作流流式执行
 * - 格式化各环节的展示 block（任务计划、执行结果、确认表单等）
 * - 协调知识图谱的创建、追加与归档
 *
 * Responsibilities:
 * - streamPlannerProductWorkflow()：主工作流编排器
 * - formatTaskExecutionPlanBlock()：格式化 DAG 展示块
 * - formatExecutorResultBlock()：格式化 Executor 结果块
 * - formatProductWorkflowBlock()：格式化完整产出块
 * - formatProductWorkflowConfirmationQuestionForm / ProposalQuestionForm：生成确认表单
 * - 聚合导出子模块（knowledge-graph、tasks、executor-agent、planner-agent、critique-agent）
 *
 * Notes:
 * - 此文件仅做编排与格式化，不包含 Planner/Executor 的 prompt 或模型执行逻辑
 */

import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
  ProductWorkflowProposalQuestion,
  TaskExecutionPlan,
} from "@repo/shared";
import { createProductWorkflowKnowledgeGraph, appendKnowledgeGraphPatch } from "./common/knowledge-graph";
import { orderTasksBySequence } from "./common/tasks";
import { streamCritiqueAgent } from "./critique-agent/agent";
import { streamExecutorAgent } from "./executor-agent/agent";
import { streamPlannerAgent } from "./planner-agent/agent";
import type {
  ProductWorkflowInput,
  ProductWorkflowStreamEvent,
} from "./types";

type ProposalQuestionSource = {
  source_task_id: string;
  source_agent: string;
};

type ProposalSlot = {
  id: string;
  question: string;
  source_task_id: string;
  source_agent: string;
  sources: ProposalQuestionSource[];
  priority: number;
};

export {
  appendKnowledgeGraphPatch,
  createProductWorkflowKnowledgeGraph,
} from "./common/knowledge-graph";
export { orderTasksBySequence } from "./common/tasks";
export { streamCritiqueAgent } from "./critique-agent/agent";
export { streamExecutorAgent } from "./executor-agent/agent";
export { streamPlannerAgent } from "./planner-agent/agent";
export type {
  ExecutorAgentInput,
  PlannerAgentInput,
  CritiqueAgentInput,
  PlannerWorkflowReviewInput,
  ProductWorkflowInput,
  ProductWorkflowStreamEvent,
} from "./types";

/**
 * Planner 主工作流：负责编排 DAG、Executor、Critique 与最终确认阶段。
 */
export async function* streamPlannerProductWorkflow(
  input: ProductWorkflowInput,
): AsyncGenerator<ProductWorkflowStreamEvent> {
  let knowledgeGraph = createProductWorkflowKnowledgeGraph();

  yield {
    type: "reasoning",
    agentType: "planner",
    content:
      "Planner Agent 已读取产品上下文、占位知识图谱和 Request Agent 分析，开始规划后续任务。\n",
  };

  const plan = yield* streamPlannerAgent({
    ...input,
    knowledgeGraph,
  });
  yield {
    type: "agent-output",
    agentType: "planner",
    content: formatTaskExecutionPlanBlock(plan),
  };

  const executorResults: ExecutorAgentResult[] = [];
  for (const task of orderTasksBySequence(plan.tasks)) {
    const result = yield* streamExecutorAgent({
      task,
      plan,
      knowledgeGraph,
      workspaceId: input.workspaceId,
      productContext: input.productContext,
      requestAnalysis: input.requestAnalysis,
      userInput: input.userInput,
      previousResults: executorResults,
      signal: input.signal,
    });
    // 工具调用已直接变更 knowledgeGraph 引用，同时显式合并新增结构化数据以确保状态完整。
    knowledgeGraph = appendKnowledgeGraphPatch({
      knowledgeGraph,
      taskId: result.task_id,
      agentType: result.agent_type,
      entities: result.entities,
      relations: result.relations,
      decisions: result.decisions,
      risks: result.risks,
      openQuestions: result.open_questions,
      summary: [result.summary],
    });
    executorResults.push(result);
    // 每个 Executor 完成后立刻发出增量知识图谱更新事件。
    yield {
      type: "knowledge-graph-update",
      knowledgeGraph,
    };
    yield {
      type: "agent-output",
      agentType: result.agent_type,
      content: formatExecutorResultBlock(result),
    };
  }

  const workflowResult = yield* streamCritiqueAgent({
    workspaceId: input.workspaceId,
    productContext: input.productContext,
    requestAnalysis: input.requestAnalysis,
    plan,
    executorResults,
    knowledgeGraph,
    signal: input.signal,
  });

  yield {
    type: "agent-output",
    agentType: "planner",
    content: formatProductWorkflowBlock(workflowResult),
  };
  yield { type: "complete", result: workflowResult };
}

/**
 * 运行完整产品工作流并返回结构化结果，供非 SSE 场景复用。
 */
export async function runPlannerProductWorkflow(
  input: ProductWorkflowInput,
): Promise<ProductWorkflowResult> {
  let result: ProductWorkflowResult | null = null;

  for await (const event of streamPlannerProductWorkflow(input)) {
    if (event.type === "complete") {
      result = event.result;
    }
  }

  if (!result) {
    throw new Error("Product workflow completed without a planner result.");
  }

  return result;
}

/**
 * 生成 Planner 可解析的 task_execution block。
 */
export function formatTaskExecutionPlanBlock(plan: TaskExecutionPlan): string {
  return `<task-execution>\n${JSON.stringify(plan, null, 2)}\n</task-execution>`;
}

/**
 * 生成 Executor Agent 的可读摘要和结构化 block。
 */
export function formatExecutorResultBlock(result: ExecutorAgentResult): string {
  return `<executor-result>\n${JSON.stringify(result, null, 2)}\n</executor-result>`;
}

/**
 * 生成产品工作流确认消息和结构化 block。
 */
export function formatProductWorkflowBlock(
  result: ProductWorkflowResult,
): string {
  return `<product-workflow>\n${JSON.stringify(result, null, 2)}\n</product-workflow>`;
}

/**
 * 生成 Conversation Agent 面向用户展示的设计确认表单。
 */
export function formatProductWorkflowConfirmationQuestionForm(
  result: ProductWorkflowResult,
): string {
  const form = {
    description: result.confirmation_message,
    questions: [
      {
        id: "decision",
        label: "你希望如何处理当前结果？",
        type: "radio",
        required: true,
        options: ["确认接受", "退回修改", "确认但补充新需求"],
      },
      {
        id: "notes",
        label: "补充说明",
        type: "textarea",
        required: false,
        placeholder: "如果选择退回或补充，请说明需要调整或新增的内容。",
      },
    ],
    submitLabel: "提交确认",
  };

  return `<question-form id="${escapeAttribute(
    result.confirmation_id,
  )}" title="设计结果确认">\n${JSON.stringify(form, null, 2)}\n</question-form>`;
}

/**
 * 生成 Conversation Agent 面向用户展示的补充信息表单。
 */
export function formatProductWorkflowProposalQuestionForm(
  result: ProductWorkflowResult,
): string | null {
  const questions = getProposalFormQuestions(result);
  if (questions.length === 0) return null;

  const form = {
    description:
      "Planner Agent 汇总了 Executor Agent 需要你补充确认的信息，请先回答这些高优先级问题。",
    questions,
    submitLabel: "提交补充信息",
  };

  return `<question-form id="${escapeAttribute(
    getProposalDecisionId(result),
  )}" title="补充信息确认">\n${JSON.stringify(form, null, 2)}\n</question-form>`;
}

/**
 * 读取 Critique Agent 输出的结构化问题；旧结果只降级为 textarea，不做类型猜测。
 */
function getProposalFormQuestions(result: ProductWorkflowResult) {
  const proposalQuestions = result.proposal_questions ?? [];
  if (proposalQuestions.length > 0) {
    return mergeProposalQuestions(proposalQuestions).map(toQuestionFormQuestion);
  }

  return mergeProposalQuestions(
    collectProposalSlots(result).map(toProposalQuestionFromSlot),
  ).map(toQuestionFormQuestion);
}

/**
 * 将 Critique Agent 结构化问题映射为前端 Question Form JSON 字段。
 */
function toQuestionFormQuestion(question: ProductWorkflowProposalQuestion) {
  const type = normalizeQuestionFormType(question);

  return {
    id: question.id,
    label: question.label,
    type,
    required: question.required,
    ...(type !== "text" && type !== "textarea" && question.options
      ? { options: question.options }
      : {}),
    ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    ...(question.maxSelections ? { maxSelections: question.maxSelections } : {}),
    help:
      question.help ??
      formatProposalQuestionSources(
        question.sources.length > 0
          ? question.sources
          : question.source_task_id && question.source_agent
            ? [
                {
                  source_task_id: question.source_task_id,
                  source_agent: question.source_agent,
                },
              ]
            : [],
      ),
  };
}

/**
 * 避免单个结构化问题缺少选项时破坏整个 Question Form。
 */
function normalizeQuestionFormType(question: ProductWorkflowProposalQuestion) {
  const needsOptions = ["radio", "checkbox", "select"].includes(question.type);
  return needsOptions && (!question.options || question.options.length < 2)
    ? "textarea"
    : question.type;
}

/**
 * 格式化结构化问题来源，帮助用户理解该问题由哪些 Executor 提出。
 */
function formatProposalQuestionSources(
  sources: NonNullable<ProductWorkflowProposalQuestion["sources"]>,
): string | undefined {
  const uniqueSources = mergeProposalQuestionSources(sources);
  if (uniqueSources.length === 0) return undefined;
  return `来源：${uniqueSources
    .map((source) => `${source.source_agent} / ${source.source_task_id}`)
    .join("；")}`;
}

/**
 * 生成补充信息决策 ID，和请求表单 payload 中的 question_id 保持一致。
 */
export function getProposalDecisionId(
  result: ProductWorkflowResult,
): string {
  return `${result.confirmation_id}-proposal-decision`;
}

/**
 * 汇总、去重并按优先级排序 Executor Agent 提出的补充信息。
 */
function collectProposalSlots(result: ProductWorkflowResult): ProposalSlot[] {
  const slots = new Map<string, ProposalSlot>();

  for (const executorResult of result.executor_results) {
    executorResult.open_questions.forEach((question, index) => {
      const questionText = question.text ?? "";
      const normalized = normalizeSlotQuestion(questionText);
      if (!normalized) return;

      const priority = executorResult.open_questions.length - index;
      const slotKey = normalized;
      const existing = slots.get(slotKey);
      const source = {
        source_task_id: executorResult.task_id,
        source_agent: executorResult.agent_type,
      };
      if (existing) {
        existing.sources = mergeProposalQuestionSources([
          ...existing.sources,
          source,
        ]);
        existing.priority = Math.max(existing.priority, priority);
        return;
      }

      slots.set(slotKey, {
        id: `slot-${slots.size + 1}`,
        question: questionText,
        source_task_id: executorResult.task_id,
        source_agent: executorResult.agent_type,
        sources: [source],
        priority,
      });
    });
  }

  return [...slots.values()].sort((left, right) => right.priority - left.priority);
}

/**
 * 将旧版 Executor open question slot 转换为结构化问题，统一走合并与表单映射逻辑。
 */
function toProposalQuestionFromSlot(
  slot: ProposalSlot,
): ProductWorkflowProposalQuestion {
  return {
    id: slot.id,
    label: slot.question,
    type: "textarea",
    required: true,
    source_task_id: slot.source_task_id,
    source_agent:
      slot.source_agent as ProductWorkflowProposalQuestion["source_agent"],
    sources: slot.sources as ProductWorkflowProposalQuestion["sources"],
    priority: slot.priority,
  };
}

/**
 * 合并 Critique Agent 可能重复输出的补充问题，保留所有 Executor 来源。
 */
function mergeProposalQuestions(
  questions: ProductWorkflowProposalQuestion[],
): ProductWorkflowProposalQuestion[] {
  const merged = new Map<string, ProductWorkflowProposalQuestion>();

  for (const question of questions) {
    const key = normalizeSlotQuestion(question.label);
    if (!key) continue;

    const sources = getProposalQuestionSources(question);
    const existing = merged.get(key);
    if (existing) {
      existing.sources = mergeProposalQuestionSources([
        ...existing.sources,
        ...sources,
      ]);
      existing.priority = Math.max(existing.priority, question.priority);
      existing.required = existing.required || question.required;
      if (!existing.placeholder && question.placeholder) {
        existing.placeholder = question.placeholder;
      }
      if (!existing.help && question.help) {
        existing.help = question.help;
      }
      if (!existing.options?.length && question.options?.length) {
        existing.options = question.options;
      }
      if (!existing.maxSelections && question.maxSelections) {
        existing.maxSelections = question.maxSelections;
      }
      continue;
    }

    merged.set(key, {
      ...question,
      sources,
    });
  }

  return [...merged.values()].sort((left, right) => right.priority - left.priority);
}

/**
 * 提取问题的来源列表；缺少 sources 时回退到主来源字段。
 */
function getProposalQuestionSources(
  question: ProductWorkflowProposalQuestion,
): NonNullable<ProductWorkflowProposalQuestion["sources"]> {
  const sources =
    question.sources.length > 0
      ? question.sources
      : question.source_task_id && question.source_agent
        ? [
            {
              source_task_id: question.source_task_id,
              source_agent: question.source_agent,
            },
          ]
        : [];

  return mergeProposalQuestionSources(sources);
}

/**
 * 对来源按 agent/task 去重，避免同一 Executor 在帮助文本中重复出现。
 */
function mergeProposalQuestionSources<T extends ProposalQuestionSource>(
  sources: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const source of sources) {
    byKey.set(`${source.source_agent}:${source.source_task_id}`, source);
  }
  return [...byKey.values()];
}

/**
 * 归一化 slot 文本，用于 MVP 阶段的 Map 去重。
 */
function normalizeSlotQuestion(question: string): string {
  return question
    .trim()
    .replace(/[?？。.!！]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * 转义表单属性值，避免模型生成的标识破坏 tagged block。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
