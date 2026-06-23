import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type {
  ChatMessage,
  ExecutorAgentResult,
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
 * 业务建模项标记为 pending 待后续 Agent 处理，闲聊项直接标记为 completed。
 */
export async function persistRequestAnalysisItems(
  requestFormId: string | undefined,
  analysis: RequestAnalysis | null,
): Promise<void> {
  if (!requestFormId || !analysis) return;

  // Request Agent 负责给当前请求表单分类：业务项继续等待后续 Agent 处理，
  // 闲聊只做记录并视为已完成。
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

      const slots = result.open_questions.map((question, index) => ({
        id: `${result.task_id}-slot-${index + 1}`,
        question,
        source_task_id: result.task_id,
        source_agent: result.agent_type,
        priority: result.open_questions.length - index,
      }));

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
 * 将 Planner 聚合后的 proposal slots 写入 decision 项，供 Conversation Agent 统一提问。
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
 * 将 Planner Agent 的最终确认请求写入请求表单。
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
  source_task_id: string;
  source_agent: string;
  priority: number;
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
  // 请求表单条目的 priority 字段是整数，这里把最高欠缺信息重要度压缩成 0-100，
  // 作为后续调度的粗粒度优先级信号。
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
  if (proposalQuestions.length === 0) return payload;

  const byKey = new Map<string, ProposalQuestion>();
  for (const question of [...existingQuestions, ...proposalQuestions]) {
    byKey.set(
      createProposalSlotKey({
        sourceTaskId: question.source_task_id,
        sourceAgent: question.source_agent,
        normalizedQuestion: normalizeSlotQuestion(question.question),
      }),
      question,
    );
  }

  const questions = [...byKey.values()].sort(
    (left, right) => right.priority - left.priority,
  );
  const nextPayload = { ...payload, questions };

  if (questions.length !== existingQuestions.length) {
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
        source_task_id: record.source_task_id,
        source_agent: record.source_agent,
        priority:
          typeof record.priority === "number" ? record.priority : 0,
      },
    ];
  });
}

/**
 * 从 Question Form 提交消息中提取本次提问 ID。
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

  return [...slots.values()]
    .sort((left, right) => right.priority - left.priority);
}

/**
 * 生成 proposal decision 的稳定提问 ID。
 */
function getProposalDecisionId(result: ProductWorkflowResult): string {
  return `${result.confirmation_id}-proposal-decision`;
}

/**
 * 归一化 slot 文本，用于 MVP 阶段的 Map 去重。
 */
function normalizeSlotQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 生成 proposal slot 去重键；相同问题来自不同任务时必须分别确认。
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
        const taskId = (item as Record<string, unknown>).source_task_id;
        return typeof taskId === "string" && taskId.trim() ? [taskId] : [];
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
        return [
          {
            id: record.id,
            label: record.question,
            type: "textarea",
            required: true,
            help: `来源：${String(record.source_agent ?? "-")} / ${String(
              record.source_task_id ?? "-",
            )}`,
          },
        ];
      })
    : [];

  if (!questionId || questions.length === 0) return null;

  return `<question-form id="${escapeAttribute(questionId)}" title="补充信息确认">
${JSON.stringify(
  {
    description:
      "Planner Agent 汇总了 Executor Agent 需要你补充确认的信息。",
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
        placeholder: "如果选择退回或补充，请说明需要调整或新增的内容",
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
