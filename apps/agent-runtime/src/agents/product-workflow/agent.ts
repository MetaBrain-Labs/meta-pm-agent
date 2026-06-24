/**
 * 产品工作流编排与格式化
 *
 * 作为 product-workflow 模块的聚合入口，负责：
 * - 编排 Planner → Executor → Planner Review 的完整产品工作流流式执行
 * - 格式化各环节的展示 block（任务计划、执行结果、确认表单等）
 * - 协调知识图谱的创建、追加与归档
 *
 * Responsibilities:
 * - streamPlannerProductWorkflow()：主工作流编排器
 * - formatTaskExecutionPlanBlock()：格式化 DAG 展示块
 * - formatExecutorResultBlock()：格式化单 Executor 结果块
 * - formatProductWorkflowBlock()：格式化完整产出块
 * - formatProductWorkflowConfirmationQuestionForm / ProposalQuestionForm：生成确认表单
 * - 聚合导出子模块（knowledge-graph、tasks、executor-agent、planner-agent）
 *
 * Notes:
 * - 此文件仅做编排与格式化，不包含 Planner/Executor 的 prompt 或模型执行逻辑
 */

import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
  TaskExecutionPlan,
} from "@repo/shared";
import { createProductWorkflowKnowledgeGraph } from "./common/knowledge-graph";
import { orderTasksBySequence } from "./common/tasks";
import { streamExecutorAgent } from "./executor-agent/agent";
import {
  streamPlannerAgent,
  streamPlannerWorkflowReview,
} from "./planner-agent/agent";
import type {
  ProductWorkflowInput,
  ProductWorkflowStreamEvent,
} from "./types";

export {
  appendKnowledgeGraphPatch,
  createProductWorkflowKnowledgeGraph,
} from "./common/knowledge-graph";
export { orderTasksBySequence } from "./common/tasks";
export { streamExecutorAgent } from "./executor-agent/agent";
export {
  streamPlannerAgent,
  streamPlannerWorkflowReview,
} from "./planner-agent/agent";
export type {
  ExecutorAgentInput,
  PlannerAgentInput,
  PlannerWorkflowReviewInput,
  ProductWorkflowInput,
  ProductWorkflowStreamEvent,
} from "./types";

/**
 * Planner 主工作流：负责编排 DAG、Executor 与最终确认阶段。
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
    knowledgeGraph = {
      ...knowledgeGraph,
      markdown: result.knowledge_graph_markdown ?? knowledgeGraph.markdown,
      notes: [
        ...knowledgeGraph.notes,
        `${result.task_id} 已由 ${result.agent_type} 更新至 product-knowledge-graph.md。`,
      ],
    };
    executorResults.push(result);
    yield {
      type: "agent-output",
      agentType: result.agent_type,
      content: formatExecutorResultBlock(result),
    };
  }

  const workflowResult = yield* streamPlannerWorkflowReview({
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
        placeholder: "如果选择退回或补充，请说明需要调整或新增的内容",
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
  const slots = collectProposalSlots(result);
  if (slots.length === 0) return null;

  const form = {
    description:
      "Planner Agent 汇总了 Executor Agent 需要你补充确认的信息，请先回答这些高优先级问题。",
    questions: slots.map((slot) => ({
      id: slot.id,
      label: slot.question,
      type: "textarea",
      required: true,
      help: `来源：${slot.source_agent} / ${slot.source_task_id}`,
    })),
    submitLabel: "提交补充信息",
  };

  return `<question-form id="${escapeAttribute(
    getProposalDecisionId(result),
  )}" title="补充信息确认">\n${JSON.stringify(form, null, 2)}\n</question-form>`;
}

/**
 * 生成补充信息决策项 ID，和请求表单 payload 中的 question_id 保持一致。
 */
export function getProposalDecisionId(
  result: ProductWorkflowResult,
): string {
  return `${result.confirmation_id}-proposal-decision`;
}

/**
 * 汇总、去重并按优先级排序 Executor Agent 提出的补充信息。
 */
function collectProposalSlots(result: ProductWorkflowResult): Array<{
  id: string;
  question: string;
  source_task_id: string;
  source_agent: string;
  priority: number;
}> {
  const slots = new Map<
    string,
    {
      id: string;
      question: string;
      source_task_id: string;
      source_agent: string;
      priority: number;
    }
  >();

  for (const executorResult of result.executor_results) {
    executorResult.open_questions.forEach((question, index) => {
      const normalized = normalizeSlotQuestion(question);
      if (!normalized) return;

      const priority = executorResult.open_questions.length - index;
      const slotKey = createProposalSlotKey({
        sourceTaskId: executorResult.task_id,
        sourceAgent: executorResult.agent_type,
        normalizedQuestion: normalized,
      });
      const existing = slots.get(slotKey);
      if (existing && existing.priority >= priority) return;

      slots.set(slotKey, {
        id: `slot-${slots.size + 1}`,
        question,
        source_task_id: executorResult.task_id,
        source_agent: executorResult.agent_type,
        priority,
      });
    });
  }

  return [...slots.values()].sort((left, right) => right.priority - left.priority);
}

/**
 * 归一化 slot 文本，用于 MVP 阶段的 Map 去重。
 */
function normalizeSlotQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 生成 proposal slot 去重键；同一问题来自不同任务时必须分别确认。
 */
function createProposalSlotKey({
  sourceTaskId,
  sourceAgent,
  normalizedQuestion,
}: {
  sourceTaskId: string;
  sourceAgent: string;
  normalizedQuestion: string;
}): string {
  return `${sourceTaskId}:${sourceAgent}:${normalizedQuestion}`;
}

/**
 * 转义表单属性值，避免模型生成的标识破坏 tagged block。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
