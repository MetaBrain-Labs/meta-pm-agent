/**
 * 请求表单持久化仓储
 *
 * 负责维护 request_form 与 request_form_item 的状态流转、问题表单决策项、
 * Executor proposal 聚合结果以及用户回答后的完成标记。
 *
 * Responsibilities:
 * - 写入 Request Agent 分析结果和 Executor proposal 项
 * - 生成待 Conversation Agent 展示的 Question Form tagged block
 * - 在用户提交表单后关闭对应 decision/proposal 条目
 *
 * Notes:
 * - 不负责直接运行 Agent 或修改 LangGraph 状态。
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type {
  ChatMessage,
  ExecutorAgentResult,
  ProductWorkflowProposalQuestion,
  ProductWorkflowResult,
  RequestAnalysis,
} from "@repo/shared";

/**
 * 更新请求表单的阶段状态，用于前端和后续调度判断当前表单被哪个阶段消费。
 */
export async function updateRequestFormStatus(
  requestFormId: string | undefined,
  status: string,
): Promise<void> {
  if (!requestFormId) return;

  await prisma.$executeRaw`
    UPDATE "request_form"
    SET
      "status" = ${status},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${requestFormId}
  `;
}

/**
 * 将 Request Agent 的分析结果写入请求表单条目表。
 *
 * 业务建模项标记为 pending 待后续 Agent 处理，闲聊项直接标记为 completed。
 */
export async function persistRequestAnalysisItems(
  requestFormId: string | undefined,
  analysis: RequestAnalysis | null,
): Promise<void> {
  if (!requestFormId || !analysis) return;

  // Request Agent 负责给当前请求表单分类：业务项继续等待后续 Agent 处理。
  // 闲聊项只做记录并视为已完成。
  await prisma.$transaction(async (tx) => {
    for (const item of analysis.business_model) {
      await tx.$executeRaw`
        INSERT INTO "request_form_item" (
          "id",
          "form_id",
          "type",
          "status",
          "agent",
          "priority",
          "payload"
        )
        VALUES (
          ${randomUUID()},
          ${requestFormId},
          'business_model',
          'pending',
          'request-agent',
          ${toPriority(item.missing_information)},
          ${JSON.stringify(item)}::jsonb
        )
      `;
    }

    if (analysis.questions.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "request_form_item" (
          "id",
          "form_id",
          "type",
          "status",
          "agent",
          "priority",
          "payload"
        )
        VALUES (
          ${randomUUID()},
          ${requestFormId},
          'questions',
          'pending',
          'request-agent',
          0,
          ${JSON.stringify({ user_input_indexes: analysis.questions })}::jsonb
        )
      `;
    }

    if (analysis.chitchat.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "request_form_item" (
          "id",
          "form_id",
          "type",
          "status",
          "agent",
          "priority",
          "payload"
        )
        VALUES (
          ${randomUUID()},
          ${requestFormId},
          'chitchat',
          'completed',
          'request-agent',
          0,
          ${JSON.stringify({ user_input_indexes: analysis.chitchat })}::jsonb
        )
      `;
    }
  });
}

/**
 * 将 Executor Agent 提出的待补充信息写入请求表单 proposal 项。
 */
export async function persistExecutorProposalItems(
  requestFormId: string | undefined,
  results: ExecutorAgentResult[],
): Promise<void> {
  if (!requestFormId || results.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const result of results) {
      if (result.open_questions.length === 0) continue;

      const slots = collectExecutorProposalSlots(result);
      if (slots.length === 0) continue;

      await tx.$executeRaw`
        INSERT INTO "request_form_item" (
          "id",
          "form_id",
          "type",
          "status",
          "agent",
          "priority",
          "payload"
        )
        VALUES (
          ${randomUUID()},
          ${requestFormId},
          'proposal',
          'pending',
          ${result.agent_type},
          ${slots[0]?.priority ?? 0},
          ${JSON.stringify({
            task_id: result.task_id,
            agent_type: result.agent_type,
            slots,
          })}::jsonb
        )
      `;
    }
  });
}

/**
 * 将 Planner 聚合后的 proposal slots 写入 decision 项，由 Conversation Agent 统一提问。
 */
export async function persistProposalDecisionItem(
  requestFormId: string | undefined,
  result: ProductWorkflowResult | null,
): Promise<void> {
  if (!requestFormId || !result) return;

  const slots = collectProposalSlots(result);
  if (slots.length === 0) return;

  await prisma.$executeRaw`
    INSERT INTO "request_form_item" (
      "id",
      "form_id",
      "type",
      "status",
      "agent",
      "priority",
      "payload"
    )
    VALUES (
      ${randomUUID()},
      ${requestFormId},
      'decision',
      'pending',
      'planner',
      ${slots[0]?.priority ?? 0},
      ${JSON.stringify({
        question_id: getProposalDecisionId(result),
        questions: slots,
      })}::jsonb
    )
  `;
}

/**
 * 将 Planner SubAgent 的最终确认请求写入请求表单。
 */
export async function persistProductWorkflowConfirmationDecision(
  requestFormId: string | undefined,
  result: ProductWorkflowResult | null,
): Promise<void> {
  if (!requestFormId || !result) return;

  await prisma.$executeRaw`
    INSERT INTO "request_form_item" (
      "id",
      "form_id",
      "type",
      "status",
      "agent",
      "priority",
      "payload"
    )
    VALUES (
      ${randomUUID()},
      ${requestFormId},
      'confirmation_decision',
      'pending',
      'planner',
      100,
      ${JSON.stringify({
        question_id: result.confirmation_id,
        questions: [
          {
            id: "decision",
            type: "radio",
            priority: 100,
            options: ["确认接受", "退回修改", "确认但补充新需求"],
          },
          {
            id: "notes",
            type: "textarea",
            priority: 50,
          },
        ],
        workflow: result,
      })}::jsonb
    )
  `;
}

/**
 * Conversation Agent 表单提交后，将对应决策项标记为 finish 并记录用户回答。
 */
export async function finishAnsweredDecisionItems(
  requestFormId: string | undefined,
  messages: ChatMessage[],
): Promise<void> {
  if (!requestFormId) return;

  const latestUserMessage = messages
    .filter((message) => message.role === "user")
    .at(-1);
  const answer = latestUserMessage
    ? parseFormAnswer(latestUserMessage.content)
    : null;
  if (!answer) return;

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<RequestFormDecisionRow[]>`
      SELECT "id", "type", "payload"
      FROM "request_form_item"
      WHERE "form_id" = ${requestFormId}
        AND "status" = 'pending'
        AND "type" IN ('decision', 'confirmation_decision')
        AND "payload"->>'question_id' = ${answer.formId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return;

    const answeredAt = new Date().toISOString();
    const answerPatch = {
      answer: answer.content,
      answered_at: answeredAt,
    };

    await tx.$executeRaw`
      UPDATE "request_form_item"
      SET
        "status" = 'finish',
        "payload" = "payload" || ${JSON.stringify(answerPatch)}::jsonb,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${row.id}
    `;

    // 补充信息确认表单提交后，同步关闭它汇总的 Executor proposal 条目。
    if (row.type !== "decision") return;

    const taskIds = extractProposalTaskIds(parsePayload(row.payload));
    for (const taskId of taskIds) {
      await tx.$executeRaw`
        UPDATE "request_form_item"
        SET
          "status" = 'finish',
          "payload" = "payload" || ${JSON.stringify({
            ...answerPatch,
            decision_item_id: row.id,
          })}::jsonb,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "form_id" = ${requestFormId}
          AND "status" = 'pending'
          AND "type" = 'proposal'
          AND "payload"->>'task_id' = ${taskId}
      `;
    }
  });
}

interface RequestFormDecisionRow {
  id: string;
  type: string;
  payload: unknown;
}

interface RequestFormProposalRow {
  payload: unknown;
}

interface ProposalQuestion {
  id: string;
  question: string;
  type: "radio" | "checkbox" | "select" | "text" | "textarea";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  help?: string;
  maxSelections?: number;
  source_task_id: string;
  source_agent: string;
  sources: Array<{ source_task_id: string; source_agent: string }>;
  priority: number;
}

/**
 * 将单个 Executor 的 open questions 转换为待确认 proposal slots，并在写库前合并重复问题。
 */
function collectExecutorProposalSlots(
  result: ExecutorAgentResult,
): ProposalQuestion[] {
  const slots = result.open_questions.flatMap((question, index) => {
    // open_questions 现在为结构化对象 {id, text}，提取 text 作为显示文本。
    const questionText =
      typeof question === "object" && question !== null && "text" in question
        ? String((question as Record<string, unknown>).text)
        : String(question);
    const normalized = normalizeSlotQuestion(questionText);
    if (!normalized) return [];

    return [
      {
        id: `${result.task_id}-slot-${index + 1}`,
        question: questionText,
        type: "textarea" as const,
        source_task_id: result.task_id,
        source_agent: result.agent_type,
        sources: [
          {
            source_task_id: result.task_id,
            source_agent: result.agent_type,
          },
        ],
        priority: result.open_questions.length - index,
      },
    ];
  });

  return mergeProposalQuestions(slots);
}

/**
 * 合并 Planner/Executor 写入的重复补充问题，并保留所有可关闭的来源。
 */
function mergeProposalQuestions(questions: ProposalQuestion[]): ProposalQuestion[] {
  const byKey = new Map<string, ProposalQuestion>();

  for (const question of questions) {
    const key = normalizeSlotQuestion(question.question);
    if (!key) continue;

    const sources = getProposalQuestionSources(question);
    const existing = byKey.get(key);
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

    byKey.set(key, {
      ...question,
      sources,
    });
  }

  return [...byKey.values()].sort((left, right) => right.priority - left.priority);
}

/**
 * 读取 proposal question 的完整来源列表；旧 payload 缺少 sources 时使用主来源兜底。
 */
function getProposalQuestionSources(
  question: ProposalQuestion,
): ProposalQuestion["sources"] {
  const sources =
    question.sources.length > 0
      ? question.sources
      : [
          {
            source_task_id: question.source_task_id,
            source_agent: question.source_agent,
          },
        ];

  return mergeProposalQuestionSources(sources);
}

/**
 * 按 agent/task 对来源去重，避免恢复表单重复显示同一个来源。
 */
function mergeProposalQuestionSources<T extends ProposalQuestion["sources"][number]>(
  sources: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const source of sources) {
    byKey.set(`${source.source_agent}:${source.source_task_id}`, source);
  }
  return [...byKey.values()];
}

/**
 * 判断合并后的问题列表是否需要回写到 decision payload。
 */
function hasProposalQuestionsChanged(
  currentQuestions: ProposalQuestion[],
  nextQuestions: ProposalQuestion[],
): boolean {
  return JSON.stringify(currentQuestions) !== JSON.stringify(nextQuestions);
}

/**
 * 读取当前请求表单中下一组待 Conversation Agent 提问的决策项。
 */
export async function getPendingDecisionQuestionForm(
  requestFormId: string | undefined,
): Promise<string | null> {
  if (!requestFormId) return null;

  const rows = await prisma.$queryRaw<RequestFormDecisionRow[]>`
    SELECT "id", "type", "payload"
    FROM "request_form_item"
    WHERE "form_id" = ${requestFormId}
      AND "status" = 'pending'
      AND "type" IN ('decision', 'confirmation_decision')
    ORDER BY
      CASE WHEN "type" = 'confirmation_decision' THEN 0 ELSE 1 END,
      "priority" DESC,
      "created_at" ASC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  const payload = parsePayload(row.payload);
  if (!payload) return null;

  if (row.type === "confirmation_decision") {
    return buildConfirmationQuestionForm(payload);
  }

  const syncedPayload = await syncDecisionPayloadWithPendingProposals(
    requestFormId,
    row.id,
    payload,
  );
  return buildDecisionQuestionForm(syncedPayload);
}

/**
 * 将缺失信息的重要度压缩为 0-100 的优先级分值，用于后续调度排序。
 */
function toPriority(
  missingInformation: RequestAnalysis["business_model"][number]["missing_information"],
): number {
  // request_form_item.priority 是粗粒度调度信号，取最高缺口重要度压缩到 0-100。
  const maxImportance = Math.max(
    0,
    ...missingInformation.map((item) => item.importance),
  );
  return Math.round(maxImportance * 100);
}

/**
 * 用当前 pending proposal 条目补齐 decision payload，兼容旧逻辑生成的不完整 decision。
 */
async function syncDecisionPayloadWithPendingProposals(
  requestFormId: string,
  decisionItemId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existingQuestions = parseDecisionQuestions(payload.questions);
  const proposalQuestions = await listPendingProposalQuestions(requestFormId);
  const combinedQuestions = [...existingQuestions, ...proposalQuestions];
  if (combinedQuestions.length === 0) return payload;

  const questions = mergeProposalQuestions(combinedQuestions);
  const nextPayload = { ...payload, questions };

  if (hasProposalQuestionsChanged(existingQuestions, questions)) {
    await prisma.$executeRaw`
      UPDATE "request_form_item"
      SET
        "payload" = ${JSON.stringify(nextPayload)}::jsonb,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${decisionItemId}
    `;
  }

  return nextPayload;
}

/**
 * 读取当前仍待确认的 proposal slots。
 */
async function listPendingProposalQuestions(
  requestFormId: string,
): Promise<ProposalQuestion[]> {
  const rows = await prisma.$queryRaw<RequestFormProposalRow[]>`
    SELECT "payload"
    FROM "request_form_item"
    WHERE "form_id" = ${requestFormId}
      AND "status" = 'pending'
      AND "type" = 'proposal'
    ORDER BY "priority" DESC, "created_at" ASC
  `;

  return rows.flatMap((row) => {
    const payload = parsePayload(row.payload);
    if (!payload || !Array.isArray(payload.slots)) return [];
    return parseDecisionQuestions(payload.slots);
  });
}

/**
 * 将 decision/proposal payload 中的 questions 或 slots 解析为统一结构。
 */
function parseDecisionQuestions(value: unknown): ProposalQuestion[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.question !== "string" ||
      typeof record.source_task_id !== "string" ||
      typeof record.source_agent !== "string"
    ) {
      return [];
    }

    return [
      {
        id: typeof record.id === "string" ? record.id : `slot-${index + 1}`,
        question: record.question,
        type: parseQuestionType(record.type),
        options: parseStringArray(record.options),
        placeholder:
          typeof record.placeholder === "string" ? record.placeholder : undefined,
        required: typeof record.required === "boolean" ? record.required : true,
        help: typeof record.help === "string" ? record.help : undefined,
        maxSelections:
          typeof record.maxSelections === "number" &&
          Number.isInteger(record.maxSelections) &&
          record.maxSelections > 0
            ? record.maxSelections
            : undefined,
        source_task_id: record.source_task_id,
        source_agent: record.source_agent,
        sources: parseProposalQuestionSources(record.sources),
        priority:
          typeof record.priority === "number" ? record.priority : 0,
      },
    ];
  });
}

/**
 * 解析合并问题保留的来源列表，保证同一答案仍能关闭所有源 proposal。
 */
function parseProposalQuestionSources(
  value: unknown,
): Array<{ source_task_id: string; source_agent: string }> {
  if (!Array.isArray(value)) return [];

  const sources = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return typeof record.source_task_id === "string" &&
      typeof record.source_agent === "string"
      ? [
          {
            source_task_id: record.source_task_id,
            source_agent: record.source_agent,
          },
        ]
      : [];
  });

  return mergeProposalQuestionSources(sources);
}

/**
 * 从 Question Form 提交消息中提取本次提交的 ID。
 */
function parseFormAnswer(content: string): { formId: string; content: string } | null {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  const match = /^\[form answers\s+.+?\s+([^\]]+)\]/i.exec(firstLine);
  if (!match?.[1]) return null;

  return {
    formId: match[1].trim(),
    content,
  };
}

/**
 * 汇总、去重、过滤并按优先级排序 Planner 收集到的 proposal slots。
 */
function collectProposalSlots(result: ProductWorkflowResult): Array<{
  id: string;
  question: string;
  type: "radio" | "checkbox" | "select" | "text" | "textarea";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  help?: string;
  maxSelections?: number;
  source_task_id: string;
  source_agent: string;
  sources: Array<{ source_task_id: string; source_agent: string }>;
  priority: number;
}> {
  const proposalQuestions = result.proposal_questions ?? [];
  if (proposalQuestions.length > 0) {
    return mergeProposalQuestions(proposalQuestions.map(toProposalQuestionSlot));
  }

  const slots = new Map<string, {
    id: string;
    question: string;
    type: "radio" | "checkbox" | "select" | "text" | "textarea";
    options?: string[];
    placeholder?: string;
    required?: boolean;
    help?: string;
    maxSelections?: number;
    source_task_id: string;
    source_agent: string;
    sources: Array<{ source_task_id: string; source_agent: string }>;
    priority: number;
  }>();

  for (const executorResult of result.executor_results) {
    executorResult.open_questions.forEach((question, index) => {
      // open_questions 是结构化对象 {id, text}，提取 text 进行归一化。
      const questionText = typeof question === "object" && question !== null && "text" in question
        ? String((question as Record<string, unknown>).text)
        : String(question);
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
        type: "textarea",
        source_task_id: executorResult.task_id,
        source_agent: executorResult.agent_type,
        sources: [source],
        priority,
      });
    });
  }

  return [...slots.values()]
    .sort((left, right) => right.priority - left.priority);
}

/**
 * 解析持久化问题控件类型；历史数据缺失时只降级 textarea，不做文本推断。
 */
function parseQuestionType(value: unknown): ProposalQuestion["type"] {
  return value === "radio" ||
    value === "checkbox" ||
    value === "select" ||
    value === "text" ||
    value === "textarea"
    ? value
    : "textarea";
}

/**
 * 解析结构化问题选项。
 */
function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

/**
 * 将 Critique Agent 的结构化问题转换成 request_form_item payload。
 */
function toProposalQuestionSlot(
  question: ProductWorkflowProposalQuestion,
): ProposalQuestion {
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

  const type = normalizeProposalQuestionType(question.type, question.options);

  return {
    id: question.id,
    question: question.label,
    type,
    ...(type !== "text" && type !== "textarea" && question.options
      ? { options: question.options }
      : {}),
    ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    required: question.required,
    ...(question.help ? { help: question.help } : {}),
    ...(question.maxSelections ? { maxSelections: question.maxSelections } : {}),
    source_task_id: question.source_task_id ?? sources[0]?.source_task_id ?? "",
    source_agent: question.source_agent ?? sources[0]?.source_agent ?? "planner",
    sources,
    priority: question.priority,
  };
}

/**
 * 结构化问题缺少选项时，仅把该题降级为 textarea，避免整张表单不可用。
 */
function normalizeProposalQuestionType(
  type: ProposalQuestion["type"],
  options: string[] | undefined,
): ProposalQuestion["type"] {
  const needsOptions = type === "radio" || type === "checkbox" || type === "select";
  return needsOptions && (!options || options.length < 2) ? "textarea" : type;
}

/**
 * 生成 proposal decision 的稳定提交 ID。
 */
function getProposalDecisionId(result: ProductWorkflowResult): string {
  return `${result.confirmation_id}-proposal-decision`;
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
 * 将 JSONB payload 安全转换为普通对象。
 */
function parsePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * 从补充信息 decision payload 中提取其汇总的 proposal task_id。
 */
function extractProposalTaskIds(
  payload: Record<string, unknown> | null,
): string[] {
  if (!payload || !Array.isArray(payload.questions)) return [];

  return [
    ...new Set(
      payload.questions.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return [];
        }
        const record = item as Record<string, unknown>;
        const sourceTaskIds = Array.isArray(record.sources)
          ? record.sources.flatMap((source) => {
              if (!source || typeof source !== "object" || Array.isArray(source)) {
                return [];
              }
              const taskId = (source as Record<string, unknown>).source_task_id;
              return typeof taskId === "string" && taskId.trim()
                ? [taskId]
                : [];
            })
          : [];
        const taskId = record.source_task_id;
        return [
          ...sourceTaskIds,
          ...(typeof taskId === "string" && taskId.trim() ? [taskId] : []),
        ];
      }),
    ),
  ];
}

/**
 * 根据普通 decision 项生成补充信息表单。
 */
function buildDecisionQuestionForm(payload: Record<string, unknown>): string | null {
  const questionId =
    typeof payload.question_id === "string" ? payload.question_id : null;
  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return [];
        }
        const record = item as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.question !== "string") {
          return [];
        }
        const options = parseStringArray(record.options);
        const type = normalizeProposalQuestionType(
          parseQuestionType(record.type),
          options,
        );
        return [
          {
            id: record.id,
            label: record.question,
            type,
            required:
              typeof record.required === "boolean" ? record.required : true,
            ...(options && type !== "text" && type !== "textarea"
              ? { options }
              : {}),
            ...(typeof record.placeholder === "string"
              ? { placeholder: record.placeholder }
              : {}),
            ...(typeof record.maxSelections === "number" &&
            Number.isInteger(record.maxSelections) &&
            record.maxSelections > 0
              ? { maxSelections: record.maxSelections }
              : {}),
            help: `来源：${formatQuestionSources(record)}`,
          },
        ];
      })
    : [];

  if (!questionId || questions.length === 0) return null;

  return `<question-form id="${escapeAttribute(questionId)}" title="补充信息确认">
${JSON.stringify(
  {
    description:
      "Planner SubAgent 汇总了 Executor Agent 需要你补充确认的信息。",
    questions,
    submitLabel: "提交补充信息",
  },
  null,
  2,
)}
</question-form>`;
}

/**
 * 根据 confirmation_decision 项生成最终确认表单。
 */
/**
 * 格式化合并问题的来源说明，避免重复问题在 UI 中拆成多项。
 */
function formatQuestionSources(record: Record<string, unknown>): string {
  const sources = parseProposalQuestionSources(record.sources);
  if (sources?.length) {
    return sources
      .map((source) => `${source.source_agent} / ${source.source_task_id}`)
      .join("；");
  }

  return `${String(record.source_agent ?? "-")} / ${String(
    record.source_task_id ?? "-",
  )}`;
}

function buildConfirmationQuestionForm(
  payload: Record<string, unknown>,
): string | null {
  const questionId =
    typeof payload.question_id === "string" ? payload.question_id : null;
  if (!questionId) return null;

  return `<question-form id="${escapeAttribute(questionId)}" title="设计结果确认">
${JSON.stringify(
  {
    description: "请确认当前产品设计任务的处理方式。",
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
  },
  null,
  2,
)}
</question-form>`;
}

/**
 * 转义表单属性值。
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
