/**
 * 产品工作流格式化与聚合导出
 *
 * 作为 product-workflow 模块的聚合入口，负责：
 * - 格式化各环节的展示 block（执行结果、确认表单等）
 * - 导出子模块供外部使用
 *
 * Responsibilities:
 * - formatExecutorResultBlock()：格式化 Executor 结果块
 * - formatProductWorkflowBlock()：格式化完整产出块
 * - formatProductWorkflowConfirmationQuestionForm / ProposalQuestionForm：生成确认表单
 * - 聚合导出子模块（knowledge-graph、tasks、executor-agent、critique-agent）
 *
 * Notes:
 * - 主工作流编排已迁移至 LangGraph，见 ../graph/workflow.ts
 * - formatTaskExecutionPlanBlock 已抽取至 ../orchestrator-agent/planner-subagent/plan.ts
 */

import type {
  ExecutorAgentResult,
  ProductWorkflowResult,
  ProductWorkflowProposalQuestion,
} from "@repo/shared";

const PRODUCT_WORKFLOW_CONFIRMATION_FORM_ID = "product-workflow-confirmation";
import type {
  ProductWorkflowStreamEvent,
} from "./types";

type ProposalQuestionSource = {
  source_task_id: string;
  source_agent: string;
  open_question_id?: string;
};

type ProposalSlot = {
  id: string;
  question: string;
  source_task_id: string;
  source_agent: string;
  sources: ProposalQuestionSource[];
  priority: number;
  required: boolean;
};

export {
  appendKnowledgeGraphPatch,
  createProductWorkflowKnowledgeGraph,
} from "./common/knowledge-graph";
export { orderTasksBySequence } from "./common/tasks";
export { streamCritiqueAgent } from "./critique-agent/agent";
export { streamExecutorAgent } from "./executor-agent/agent";
export { streamOrchestratorAgent } from "./orchestrator-agent/agent";
export type { OrchestratorAgentOutput } from "./orchestrator-agent/agent";
export type {
  ExecutorAgentInput,
  OrchestratorAgentInput,
  PlannerAgentInput,
  CritiqueAgentInput,
  PlannerWorkflowReviewInput,
  ProductWorkflowInput,
  ProductWorkflowStreamEvent,
} from "./types";

export {
  normalizeTaskExecutionPlan,
  createFallbackPlan,
  formatTaskExecutionPlanBlock,
} from "./orchestrator-agent/planner-subagent";

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
    PRODUCT_WORKFLOW_CONFIRMATION_FORM_ID,
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
  const hasBlockingQuestions = questions.some((question) => question.required);

  const form = {
    description: hasBlockingQuestions
      ? "Planner SubAgent 汇总了 Executor Agent 需要你补充确认的信息。必填问题默认展开，选填问题默认折叠。"
      : "以下问题均为可选优化项。你可以填写任意一项后继续下一轮 DAG，也可以选择“不再继续”并直接确认当前已有设计成果。",
    questions: questions.map((question) => ({
      ...question,
      collapsible: true,
      defaultCollapsed: hasBlockingQuestions && !question.required,
    })),
    submitLabel: "提交补充信息",
    ...(!hasBlockingQuestions
      ? {
          variant: "optional-followup",
          requireAnyAnswer: true,
          secondarySubmitLabel: "不再继续",
          secondaryActionValue: "stop_optional_questions",
        }
      : {}),
  };

  return `<question-form id="${escapeAttribute(
    getProposalDecisionId(result),
  )}" title="${hasBlockingQuestions ? "补充信息确认" : "可选优化问题"}">\n${JSON.stringify(form, null, 2)}\n</question-form>`;
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

      const priority = question.blocking ? 100 - index : 50 - index;
      const slotKey = normalized;
      const existing = slots.get(slotKey);
      const source = {
        source_task_id: executorResult.task_id,
        source_agent: executorResult.agent_type,
        open_question_id: question.id,
      };
      if (existing) {
        existing.sources = mergeProposalQuestionSources([
          ...existing.sources,
          source,
        ]);
        existing.priority = Math.max(existing.priority, priority);
        existing.required = existing.required || question.blocking;
        return;
      }

      slots.set(slotKey, {
        id: `slot-${slots.size + 1}`,
        question: questionText,
        source_task_id: executorResult.task_id,
        source_agent: executorResult.agent_type,
        sources: [source],
        priority,
        required: question.blocking,
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
    required: slot.required,
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
    byKey.set(
      `${source.source_agent}:${source.source_task_id}:${source.open_question_id ?? ""}`,
      source,
    );
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
