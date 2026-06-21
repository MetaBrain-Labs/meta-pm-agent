import { HumanMessage } from "langchain";
import { createDeepAgent } from "deepagents";
import {
  ExecutorAgentResultSchema,
  ProductDirectorWorkflowResultSchema,
  TaskExecutionPlanSchema,
  type BusinessModelItem,
  type ExecutorAgentResult,
  type ProductDirectorWorkflowResult,
  type ProductKnowledgeGraph,
  type ProductWorkflowAgentType,
  type RequestAnalysis,
  type TaskExecutionNode,
  type TaskExecutionPlan,
} from "@repo/shared";
import { createChatModel, type ChatModelOptions } from "../common/model";
import { parseJsonObject } from "../../utils/json";
import {
  getReasoningContent,
  getTextContent,
} from "../../utils/message-adapter";
import type { UserInputRecord } from "../request/user-input";
import { EXECUTOR_DEFINITIONS } from "./prompts/common";
import { createExecutorAgentPrompt } from "./prompts/executor";
import { PLANNER_AGENT_PROMPT } from "./prompts/planner";
import { PRODUCT_DIRECTOR_AGENT_PROMPT } from "./prompts/product-director";

type ExecutorAgentType = (typeof EXECUTOR_DEFINITIONS)[number]["agentType"];

const JSON_AGENT_MODEL_OPTIONS = {
  enableThinking: false,
  responseFormat: "json_object",
  temperature: 0,
} satisfies Omit<ChatModelOptions, "maxTokens">;

export interface ProductDirectorWorkflowInput {
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  userInput: UserInputRecord[];
}

export type ProductWorkflowStreamEvent =
  | {
      type: "reasoning";
      agentType: ProductWorkflowAgentType;
      content: string;
    }
  | {
      type: "agent-output";
      agentType: ProductWorkflowAgentType;
      content: string;
    }
  | { type: "complete"; result: ProductDirectorWorkflowResult };

/**
 * ProductDirector Agent 主工作流：负责编排 Planner 和 Executor MVP，并产出待用户确认的更新建议。
 */
export async function* streamProductDirectorWorkflow(
  input: ProductDirectorWorkflowInput,
): AsyncGenerator<ProductWorkflowStreamEvent> {
  const knowledgeGraph = createPlaceholderKnowledgeGraph();

  yield {
    type: "reasoning",
    agentType: "product_director",
    content:
      "ProductDirector Agent 已读取产品上下文、占位知识图谱和 Request Agent 分析，开始规划后续任务。\n",
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
      productContext: input.productContext,
      requestAnalysis: input.requestAnalysis,
      userInput: input.userInput,
      previousResults: executorResults,
    });
    executorResults.push(result);
    yield {
      type: "agent-output",
      agentType: result.agent_type,
      content: formatExecutorResultBlock(result),
    };
  }

  const workflowResult = yield* streamProductDirectorReview({
    productContext: input.productContext,
    requestAnalysis: input.requestAnalysis,
    plan,
    executorResults,
    knowledgeGraph,
  });

  yield {
    type: "agent-output",
    agentType: "product_director",
    content: formatProductDirectorWorkflowBlock(workflowResult),
  };
  yield { type: "complete", result: workflowResult };
}

/**
 * Planner Agent：把 Request Agent 的 business_model 转换为可执行 DAG。
 */
async function* streamPlannerAgent(input: {
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  userInput: UserInputRecord[];
  knowledgeGraph: ProductKnowledgeGraph;
}): AsyncGenerator<ProductWorkflowStreamEvent, TaskExecutionPlan, void> {
  return yield* runJsonAgent({
    agentType: "planner",
    name: "planner-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 4096,
    },
    systemPrompt: PLANNER_AGENT_PROMPT,
    payload: {
      product_context: input.productContext || "No product context provided.",
      product_knowledge_graph: input.knowledgeGraph,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
    },
    schema: TaskExecutionPlanSchema,
    fallback: () => createFallbackPlan(input.requestAnalysis),
  });
}

/**
 * Executor Agent：按任务分配调用对应领域 Agent，形成图谱增量建议。
 */
async function* streamExecutorAgent(input: {
  task: TaskExecutionNode;
  plan: TaskExecutionPlan;
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  userInput: UserInputRecord[];
  previousResults: ExecutorAgentResult[];
}): AsyncGenerator<ProductWorkflowStreamEvent, ExecutorAgentResult, void> {
  const definition = getExecutorDefinition(input.task.assigned_agent);

  return yield* runJsonAgent({
    agentType: definition.agentType,
    name: `${definition.agentType}-agent`,
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 4096,
    },
    systemPrompt: createExecutorAgentPrompt({
      agentType: definition.agentType,
      focusLayer: definition.focusLayer,
      name: definition.name,
      role: definition.role,
    }),
    payload: {
      product_context: input.productContext || "No product context provided.",
      task: input.task,
      plan: input.plan,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
      previous_results: input.previousResults,
    },
    schema: ExecutorAgentResultSchema,
    fallback: () => createFallbackExecutorResult(input.task),
  });
}

/**
 * ProductDirector Agent：验收各 Executor 结果并生成待确认的产品上下文和图谱更新。
 */
async function* streamProductDirectorReview(input: {
  productContext?: string;
  requestAnalysis: RequestAnalysis;
  plan: TaskExecutionPlan;
  executorResults: ExecutorAgentResult[];
  knowledgeGraph: ProductKnowledgeGraph;
}): AsyncGenerator<
  ProductWorkflowStreamEvent,
  ProductDirectorWorkflowResult,
  void
> {
  return yield* runJsonAgent({
    agentType: "product_director",
    name: "product-director-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 8192,
    },
    systemPrompt: PRODUCT_DIRECTOR_AGENT_PROMPT,
    payload: {
      product_context: input.productContext || "No product context provided.",
      request_analysis: input.requestAnalysis,
      product_knowledge_graph: input.knowledgeGraph,
      planner: input.plan,
      executor_results: input.executorResults,
    },
    schema: ProductDirectorWorkflowResultSchema,
    fallback: () => createFallbackWorkflowResult(input.plan, input.executorResults),
  });
}

/**
 * 运行只输出 JSON 的 DeepAgent，并在模型失败或格式错误时回退到确定性 MVP 结果。
 */
async function* runJsonAgent<T>(options: {
  agentType: ProductWorkflowAgentType;
  name: string;
  modelOptions?: ChatModelOptions;
  systemPrompt: string;
  payload: unknown;
  schema: {
    safeParse(value: unknown):
      | { success: true; data: T }
      | { success: false; error: unknown };
  };
  fallback: (reason: string) => T;
}): AsyncGenerator<ProductWorkflowStreamEvent, T, void> {
  try {
    const agent = createDeepAgent({
      model: createChatModel(options.modelOptions) as any,
      systemPrompt: options.systemPrompt,
      tools: [],
      name: options.name,
      skills: [],
    });

    const run = await agent.stream(
      {
        messages: [new HumanMessage(JSON.stringify(options.payload))],
      },
      { streamMode: "messages" },
    );

    let responseText = "";
    for await (const [message] of run) {
      const reasoning = getReasoningContent(message);
      if (reasoning) {
        yield {
          type: "reasoning",
          agentType: options.agentType,
          content: reasoning,
        };
      }
      responseText += getTextContent(message);
    }

    const parsed = parseJsonObject(responseText);
    const result = options.schema.safeParse(parsed);
    if (result.success) return result.data;

    yield {
      type: "reasoning",
      agentType: options.agentType,
      content: `结构化输出校验失败，已使用 ${getProductWorkflowAgentLabel(options.agentType)} 的 MVP 回退结果。\n`,
    };
    return options.fallback("invalid-json");
  } catch (error) {
    yield {
      type: "reasoning",
      agentType: options.agentType,
      content: `${getProductWorkflowAgentLabel(options.agentType)} 执行失败，已使用 MVP 回退结果：${getErrorMessage(error)}\n`,
    };
    return options.fallback(getErrorMessage(error));
  }
}

/**
 * 构建当前版本的占位知识图谱上下文。
 */
function createPlaceholderKnowledgeGraph(): ProductKnowledgeGraph {
  return {
    entities: [],
    relations: [],
    notes: ["MVP placeholder: 产品设计知识图谱尚未接入正式存储。"],
  };
}

/**
 * 按 sequence 排序，确保 Executor 以 DAG 的线性化顺序执行。
 */
function orderTasksBySequence(tasks: TaskExecutionNode[]): TaskExecutionNode[] {
  return [...tasks].sort((left, right) => left.sequence - right.sequence);
}

/**
 * 获取 Executor Agent 的职责定义。
 */
function getExecutorDefinition(agentType: ExecutorAgentType) {
  return EXECUTOR_DEFINITIONS.find((item) => item.agentType === agentType)!;
}

/**
 * 将产品工作流 Agent 类型转换为用户可读的英文名称。
 */
function getProductWorkflowAgentLabel(agentType: ProductWorkflowAgentType): string {
  if (agentType === "planner") return "Planner Agent";
  if (agentType === "product_director") return "ProductDirector Agent";
  return getExecutorDefinition(agentType as ExecutorAgentType)?.displayName ?? agentType;
}

/**
 * 在 Planner Agent 不可用时生成稳定的六段式 DAG。
 */
function createFallbackPlan(analysis: RequestAnalysis): TaskExecutionPlan {
  const coveredIndexes = analysis.business_model.map((item) => item.index);
  const taskSpecs = EXECUTOR_DEFINITIONS.map((definition, index) => ({
    definition,
    sequence: index + 1,
  }));

  return {
    request_summary: summarizeBusinessModels(analysis.business_model),
    dag: {
      nodes: taskSpecs.map(({ definition }) => definition.agentType),
      edges: taskSpecs.slice(1).map(({ definition }, index) => ({
        source: taskSpecs[index]!.definition.agentType,
        target: definition.agentType,
      })),
    },
    tasks: taskSpecs.map(({ definition, sequence }, index) => ({
      task_id: `task-${String(sequence).padStart(2, "0")}`,
      sequence,
      title: definition.displayName,
      description: definition.role,
      assigned_agent: definition.agentType,
      depends_on: index === 0 ? [] : [`task-${String(index).padStart(2, "0")}`],
      covered_business_model_indexes: coveredIndexes,
      expected_output: `Produce the minimum ${definition.focusLayer} layer graph delta and review notes.`,
      quality_check: {
        status: "pending",
        criteria: ["覆盖 Request Agent 的 business_model", "保留待用户确认的不确定信息"],
      },
    })),
    assumptions: ["Planner Agent 使用 MVP 回退 DAG，后续可由模型动态调整。"],
  };
}

/**
 * 在 Executor Agent 不可用时生成可落库的最小结果。
 */
function createFallbackExecutorResult(task: TaskExecutionNode): ExecutorAgentResult {
  const definition = getExecutorDefinition(task.assigned_agent);
  const entityId = `${definition.agentType}-${task.sequence}`;

  return {
    task_id: task.task_id,
    agent_type: definition.agentType,
    focus_layer: definition.focusLayer,
    summary: `${definition.displayName} generated an MVP placeholder result for the ${definition.focusLayer} layer.`,
    entities: [
      {
        id: entityId,
        type: definition.focusLayer,
        name: task.title,
        description: task.description,
        source_task_id: task.task_id,
      },
    ],
    relations: [],
    decisions: [],
    risks: ["该结果来自 MVP 回退逻辑，需要用户或后续模型确认。"],
    open_questions: ["是否接受该层的初始建模方向？"],
    quality_result: {
      passed: true,
      notes: "MVP 回退结果满足最小结构化输出要求。",
    },
  };
}

/**
 * 在 ProductDirector Agent 不可用时生成待用户确认的验收结果。
 */
function createFallbackWorkflowResult(
  plan: TaskExecutionPlan,
  executorResults: ExecutorAgentResult[],
): ProductDirectorWorkflowResult {
  return {
    status: "pending_user_confirmation",
    confirmation_id: "product-workflow-confirmation",
    request_summary: plan.request_summary,
    planner: plan,
    executor_results: executorResults,
    review: {
      accepted_task_ids: executorResults.map((item) => item.task_id),
      rejected_task_ids: [],
      notes: "ProductDirector Agent 使用 MVP 回退验收，所有结构化结果等待用户确认。",
    },
    product_context_update: [
      `请求摘要：${plan.request_summary}`,
      ...executorResults.map((item) => `${item.focus_layer}：${item.summary}`),
    ].join("\n"),
    knowledge_graph_update: {
      entities: executorResults.flatMap((item) => item.entities),
      relations: executorResults.flatMap((item) => item.relations),
      notes: ["等待用户确认后再合并到正式知识图谱。"],
    },
    confirmation_message:
      "我已完成本轮 MVP 规划、执行和验收。请确认是否接受这些产品上下文与知识图谱更新；确认后再合并，退回则舍弃本轮更新。",
  };
}

/**
 * 生成简短的业务模型摘要，供 Planner 回退计划使用。
 */
function summarizeBusinessModels(items: BusinessModelItem[]): string {
  if (items.length === 0) return "Request Agent 未识别到业务建模项。";
  return items.map((item) => item.user_goal).join("；");
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
function formatExecutorResultBlock(result: ExecutorAgentResult): string {
  return `<executor-result>\n${JSON.stringify(result, null, 2)}\n</executor-result>`;
}

/**
 * 生成 ProductDirector Agent 的确认消息和结构化 block。
 */
export function formatProductDirectorWorkflowBlock(
  result: ProductDirectorWorkflowResult,
): string {
  return `<product-workflow>\n${JSON.stringify(result, null, 2)}\n</product-workflow>`;
}

/**
 * 生成 Conversation Agent 面向用户展示的设计确认表单。
 */
export function formatProductWorkflowConfirmationQuestionForm(
  result: ProductDirectorWorkflowResult,
): string {
  return `<question-form id="${escapeAttribute(result.confirmation_id)}" title="设计结果确认">
{
  "description": ${JSON.stringify(result.confirmation_message)},
  "questions": [
    {
      "id": "decision",
      "label": "你希望如何处理当前结果？",
      "type": "radio",
      "required": true,
      "options": ["确认接受", "退回修改", "确认但补充新需求"]
    },
    {
      "id": "notes",
      "label": "补充说明",
      "type": "textarea",
      "required": false,
      "placeholder": "如果选择退回或补充，请说明需要调整或新增的内容"
    }
  ],
  "submitLabel": "提交确认"
}
</question-form>`;
}

/**
 * 生成 Conversation Agent 面向用户展示的补充信息表单。
 */
export function formatProductWorkflowProposalQuestionForm(
  result: ProductDirectorWorkflowResult,
): string | null {
  const slots = collectProposalSlots(result);
  if (slots.length === 0) return null;

  return `<question-form id="${escapeAttribute(getProposalDecisionId(result))}" title="补充信息确认">
{
  "description": "ProductDirector Agent 汇总了 Executor Agent 需要你补充确认的信息，请先回答这些高优先级问题。",
  "questions": ${JSON.stringify(
    slots.map((slot) => ({
      id: slot.id,
      label: slot.question,
      type: "textarea",
      required: true,
      help: `来源：${slot.source_agent} / ${slot.source_task_id}`,
    })),
    null,
    2,
  )},
  "submitLabel": "提交补充信息"
}
</question-form>`;
}

/**
 * 生成补充信息决策项 ID，和请求表单 payload 中的 question_id 保持一致。
 */
export function getProposalDecisionId(
  result: ProductDirectorWorkflowResult,
): string {
  return `${result.confirmation_id}-proposal-decision`;
}

/**
 * 汇总、去重并按优先级截断 Executor Agent 提出的补充信息。
 */
function collectProposalSlots(result: ProductDirectorWorkflowResult): Array<{
  id: string;
  question: string;
  source_task_id: string;
  source_agent: string;
  priority: number;
}> {
  const slots = new Map<string, {
    id: string;
    question: string;
    source_task_id: string;
    source_agent: string;
    priority: number;
  }>();

  for (const executorResult of result.executor_results) {
    executorResult.open_questions.forEach((question, index) => {
      const normalized = normalizeSlotQuestion(question);
      if (!normalized) return;

      const priority = executorResult.open_questions.length - index;
      const existing = slots.get(normalized);
      if (existing && existing.priority >= priority) return;

      slots.set(normalized, {
        id: `slot-${slots.size + 1}`,
        question,
        source_task_id: executorResult.task_id,
        source_agent: executorResult.agent_type,
        priority,
      });
    });
  }

  return [...slots.values()]
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 5);
}

/**
 * 归一化 slot 文本，用于 MVP 阶段的 Map 去重。
 */
function normalizeSlotQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 提取异常的可读消息。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 转义表单属性值，避免模型生成的标识破坏 tagged block。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
