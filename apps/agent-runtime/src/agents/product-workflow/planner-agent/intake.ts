/**
 * Planner Intake Agent 实现
 *
 * 在正式 DAG Planner 之前执行产品上下文感知的入站判断，识别闲聊、需要补充表单
 * 或可继续进入 Request Agent 的需求输入。
 *
 * Responsibilities:
 * - 运行 Planner intake JSON Agent
 * - 对项目相关输入默认要求 Agent 生成一次问题表单
 * - 定义 Planner intake 输出契约和确定性 fallback
 * - 将 Planner 选择的问题格式化为 Conversation Agent 可渲染的 Question Form
 *
 * Notes:
 * - 此模块不生成 TaskExecutionPlan；正式任务规划仍由 agent.ts 中的 streamPlannerAgent 负责。
 */

import { z } from "zod";
import type { ProductKnowledgeGraph } from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
  type JsonAgentEvent,
} from "../../common/run-json-agent";
import type { UserInputRecord } from "../../request/user-input";
import { PLANNER_INTAKE_PROMPT } from "./intake-prompt";

const MIN_REQUEST_DISCOVERY_QUESTIONS = 5;
const TARGET_MAX_REQUEST_DISCOVERY_QUESTIONS = 7;
const MAX_PLANNER_INTAKE_QUESTIONS = 8;
const REQUEST_DISCOVERY_FORM_ID = "request-discovery";

const PlannerIntakeQuestionTypeSchema = z.enum([
  "radio",
  "checkbox",
  "select",
  "text",
  "textarea",
]);

const PlannerIntakeQuestionSchema = z
  .object({
    id: z.string().min(1).describe("Stable field ID"),
    label: z.string().min(1).describe("User-facing question label"),
    type: PlannerIntakeQuestionTypeSchema.describe("Question control type"),
    required: z.boolean().default(true).describe("Whether the field is required"),
    options: z
      .array(z.string().min(1))
      .optional()
      .describe("Options for choice controls"),
    placeholder: z.string().optional().describe("Placeholder for text controls"),
    help: z.string().optional().describe("Optional user-facing help text"),
    maxSelections: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum checkbox selections"),
  })
  .superRefine((question, context) => {
    if (
      ["radio", "checkbox", "select"].includes(question.type) &&
      (!question.options || question.options.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Choice questions must include options.",
        path: ["options"],
      });
    }
  });

const PlannerIntakeQuestionFormSchema = z.object({
  id: z.string().min(1).describe("Stable question-form ID"),
  title: z.string().min(1).describe("Question Form title"),
  description: z.string().min(1).describe("Short form description"),
  questions: z
    .array(PlannerIntakeQuestionSchema)
    .min(1)
    .describe("Five to seven questions by default, never more than eight"),
  submitLabel: z.string().min(1).describe("Submit button label"),
});

const PlannerIntakeRoutingIntentSchema = z.enum([
  "new_project",
  "project_evolution",
  "chitchat",
  "form_answer",
]);

export const PlannerIntakeResultSchema = z
  .object({
    intent: z
      .enum(["chitchat", "needs_question_form", "ready_for_workflow"])
      .describe("Planner intake routing decision"),
    routing_intent: PlannerIntakeRoutingIntentSchema.optional()
      .describe("Product-aware intent classification for the latest turn"),
    conversation_message: z
      .string()
      .min(1)
      .describe("Short handoff or user-facing message rendered by Conversation Agent"),
    question_form: PlannerIntakeQuestionFormSchema.nullable()
      .default(null)
      .describe("Question Form body when user input is required"),
  })
  .superRefine((result, context) => {
    if (result.intent === "needs_question_form" && !result.question_form) {
      context.addIssue({
        code: "custom",
        message: "needs_question_form requires question_form.",
        path: ["question_form"],
      });
    }
    if (result.intent !== "needs_question_form" && result.question_form) {
      context.addIssue({
        code: "custom",
        message: "question_form must be null unless intent is needs_question_form.",
        path: ["question_form"],
      });
    }
  });

export type PlannerIntakeResult = z.infer<typeof PlannerIntakeResultSchema>;
export type PlannerIntakeStreamEvent = JsonAgentEvent<"planner_intake">;

export interface PlannerIntakeInput {
  productContext?: string;
  knowledgeGraph?: ProductKnowledgeGraph | null;
  userInput: UserInputRecord[];
  signal?: AbortSignal;
}

/**
 * 运行 Planner intake 阶段，返回三类入站判断之一。
 */
export async function* streamPlannerIntakeAgent(
  input: PlannerIntakeInput,
): AsyncGenerator<PlannerIntakeStreamEvent, PlannerIntakeResult, void> {
  const text = getUserInputText(input);
  const firstResult = normalizePlannerIntakeRoutingIntent(
    yield* runPlannerIntakeJsonAgent(input),
    text,
  );

  if (shouldForceQuestionForm(firstResult, text)) {
    // 项目相关输入默认先问一次表单；问题仍由 Agent 根据上下文生成。
    yield {
      type: "reasoning",
      agentType: "planner_intake",
      content:
        "Project-related input should ask one Question Form by default before workflow execution. Regenerating a tailored question form instead of continuing directly.",
    };
    const forcedResult = normalizePlannerIntakeRoutingIntent(
      yield* runPlannerIntakeJsonAgent(input, {
        forceQuestionForm: true,
      }),
      text,
    );
    if (shouldRegenerateForQuestionCount(forcedResult)) {
      yield {
        type: "reasoning",
        agentType: "planner_intake",
        content:
          "The generated discovery form has too few questions. Regenerating with five to seven tailored questions.",
      };
      const correctedResult = normalizePlannerIntakeRoutingIntent(
        yield* runPlannerIntakeJsonAgent(input, {
          forceQuestionForm: true,
          questionCountCorrection: true,
        }),
        text,
      );
      return normalizePlannerIntakeQuestionCount(correctedResult);
    }
    return normalizePlannerIntakeQuestionCount(forcedResult);
  }

  if (shouldRegenerateForQuestionCount(firstResult)) {
    yield {
      type: "reasoning",
      agentType: "planner_intake",
      content:
        "The generated discovery form has too few questions. Regenerating with five to seven tailored questions.",
    };
    const correctedResult = normalizePlannerIntakeRoutingIntent(
      yield* runPlannerIntakeJsonAgent(input, {
        forceQuestionForm: true,
        questionCountCorrection: true,
      }),
      text,
    );
    return normalizePlannerIntakeQuestionCount(correctedResult);
  }

  return normalizePlannerIntakeQuestionCount(firstResult);
}

/**
 * 执行一次 Planner Intake JSON Agent 调用。
 */
function runPlannerIntakeJsonAgent(
  input: PlannerIntakeInput,
  options: {
    forceQuestionForm?: boolean;
    questionCountCorrection?: boolean;
  } = {},
): AsyncGenerator<PlannerIntakeStreamEvent, PlannerIntakeResult, void> {
  return runJsonAgent({
    agentType: "planner_intake",
    agentLabel: "Planner Agent Intake",
    name: options.questionCountCorrection
      ? "planner-intake-question-count-correction-agent"
      : options.forceQuestionForm
        ? "planner-intake-question-form-agent"
        : "planner-intake-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 4096,
    },
    systemPrompt: buildPlannerIntakePrompt({
      forceQuestionForm: options.forceQuestionForm === true,
      questionCountCorrection: options.questionCountCorrection === true,
    }),
    payload: {
      product_context: input.productContext || "No product context provided.",
      product_knowledge_graph: input.knowledgeGraph ?? null,
      user_input: input.userInput,
    },
    schema: PlannerIntakeResultSchema,
    fallback: (reason) => createFallbackPlannerIntakeResult(input, reason),
    suppressInvalidJsonReasoning: true,
    signal: input.signal,
  });
}

/**
 * 构造 Planner Intake 提示词；强制修正时仍要求 Agent 自己生成问题。
 */
function buildPlannerIntakePrompt(options: {
  forceQuestionForm: boolean;
  questionCountCorrection: boolean;
}): string {
  if (!options.forceQuestionForm && !options.questionCountCorrection) {
    return PLANNER_INTAKE_PROMPT;
  }

  const correction = options.questionCountCorrection
    ? `

The previous discovery form had too few questions. Regenerate the same request-discovery form with ${MIN_REQUEST_DISCOVERY_QUESTIONS} to ${TARGET_MAX_REQUEST_DISCOVERY_QUESTIONS} tailored questions. Never return more than ${MAX_PLANNER_INTAKE_QUESTIONS} questions.`
    : "";

  return `${PLANNER_INTAKE_PROMPT}

## Required routing correction

The previous routing pass returned "ready_for_workflow", but project-related input must ask one Question Form by default before workflow execution unless the latest message is a form answer.

You must return intent "needs_question_form" and generate a tailored request-discovery question_form from the current request, product_context, and product_knowledge_graph.

Set routing_intent to "new_project" or "project_evolution" based on the current workspace context.

Do not use a fixed template. Do not ask information already present in user_input. Ask only for information needed to route or understand the user's request. Prefer ${MIN_REQUEST_DISCOVERY_QUESTIONS} to ${TARGET_MAX_REQUEST_DISCOVERY_QUESTIONS} questions. Never return more than ${MAX_PLANNER_INTAKE_QUESTIONS} questions.${correction}`;
}

/**
 * 判断模型是否错误跳过了项目需求的默认摸查表单。
 */
function shouldForceQuestionForm(
  result: PlannerIntakeResult,
  text: string,
): boolean {
  return (
    result.intent === "ready_for_workflow" &&
    Boolean(text) &&
    !isFormAnswerPayload(text)
  );
}

/**
 * 判断 request-discovery 表单是否低于本轮需求摸查的最小问题数。
 */
function shouldRegenerateForQuestionCount(
  result: PlannerIntakeResult,
): boolean {
  return (
    result.intent === "needs_question_form" &&
    result.question_form?.id === REQUEST_DISCOVERY_FORM_ID &&
    result.question_form.questions.length < MIN_REQUEST_DISCOVERY_QUESTIONS
  );
}

/**
 * 补齐模型可能漏掉的 routing_intent，避免分类字段缺失影响后续判断。
 */
function normalizePlannerIntakeRoutingIntent(
  result: PlannerIntakeResult,
  text: string,
): PlannerIntakeResult {
  if (result.routing_intent) return result;

  if (result.intent === "chitchat") {
    return { ...result, routing_intent: "chitchat" };
  }
  if (isFormAnswerPayload(text)) {
    return { ...result, routing_intent: "form_answer" };
  }

  return { ...result, routing_intent: "new_project" };
}

/**
 * 对模型生成的问题数量做硬上限保护，避免表单渲染超过产品约定。
 */
function normalizePlannerIntakeQuestionCount(
  result: PlannerIntakeResult,
): PlannerIntakeResult {
  if (
    result.intent !== "needs_question_form" ||
    result.question_form?.id !== REQUEST_DISCOVERY_FORM_ID ||
    result.question_form.questions.length <= MAX_PLANNER_INTAKE_QUESTIONS
  ) {
    return result;
  }

  return {
    ...result,
    question_form: {
      ...result.question_form,
      questions: result.question_form.questions.slice(
        0,
        MAX_PLANNER_INTAKE_QUESTIONS,
      ),
    },
  };
}

/**
 * 将 Planner intake 输出的问题体转换为现有前端可解析的 tagged block。
 */
export function formatPlannerIntakeQuestionForm(
  result: PlannerIntakeResult,
): string | null {
  if (result.intent !== "needs_question_form" || !result.question_form) {
    return null;
  }

  const { id, title, ...form } = result.question_form;
  return `<question-form id="${escapeAttribute(id)}" title="${escapeAttribute(
    title,
  )}">\n${JSON.stringify(form, null, 2)}\n</question-form>`;
}

/**
 * Planner intake 模型不可用时的保守兜底。
 */
function createFallbackPlannerIntakeResult(
  input: PlannerIntakeInput,
  _reason: string,
): PlannerIntakeResult {
  const text = getUserInputText(input);
  const isChinese = isChineseText(text);

  if (!text || isLikelyChitChat(text)) {
    return {
      intent: "chitchat",
      routing_intent: "chitchat",
      conversation_message: isChinese
        ? "我在，你可以继续告诉我要推进的需求。"
        : "I am here. Tell me what project work you want to move forward.",
      question_form: null,
    };
  }

  return {
    intent: "ready_for_workflow",
    routing_intent: isFormAnswerPayload(text) ? "form_answer" : "new_project",
    conversation_message: isChinese
      ? "我会基于当前产品上下文继续推进规划。"
      : "I will continue planning with the current product context.",
    question_form: null,
  };
}

/**
 * 汇总 graph-prepared 用户输入文本，供轻量规则判断使用。
 */
function getUserInputText(input: PlannerIntakeInput): string {
  return input.userInput.map((item) => item.content).join("\n").trim();
}

/**
 * 判断输入是否是表单答案，避免重复发起初始需求摸查。
 */
function isFormAnswerPayload(text: string): boolean {
  return /^\s*\[form answers -/i.test(text);
}

/**
 * 轻量闲聊识别仅用于兜底，正常路径由 Planner intake 模型负责判断。
 */
function isLikelyChitChat(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|thanks|thank you|谢谢|感谢|你好|在吗|辛苦了)[!！。?\s]*$/.test(
    normalized,
  );
}

/**
 * 判断文本是否主要使用中文。
 */
function isChineseText(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 转义 tagged block 属性，避免模型输出破坏 question-form 标签。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
