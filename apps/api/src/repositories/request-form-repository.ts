import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type {
  ChatMessage,
  ExecutorAgentResult,
  ProductDirectorWorkflowResult,
  RequestAnalysis,
} from "@repo/shared";

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
 * 将 ProductDirector 聚合后的 proposal slots 写入 decision 项，供 Conversation Agent 统一提问。
 */
export async function persistProposalDecisionItem(
  requestFormId: string | undefined,
  result: ProductDirectorWorkflowResult | null,
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
      'product-director',
      ${slots[0]?.priority ?? 0},
      ${JSON.stringify({
        question_id: getProposalDecisionId(result),
        questions: slots,
      })}::jsonb
    )
  `;
}

/**
 * 将 ProductDirector Agent 的最终确认请求写入请求表单。
 */
export async function persistProductWorkflowConfirmationDecision(
  requestFormId: string | undefined,
  result: ProductDirectorWorkflowResult | null,
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
      'product-director',
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

  await prisma.$executeRaw`
    UPDATE "request_form_item"
    SET
      "status" = 'finish',
      "payload" = "payload" || ${JSON.stringify({
        answer: answer.content,
        answered_at: new Date().toISOString(),
      })}::jsonb,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "form_id" = ${requestFormId}
      AND "status" = 'pending'
      AND "type" IN ('decision', 'confirmation_decision')
      AND "payload"->>'question_id' = ${answer.formId}
  `;
}

interface RequestFormDecisionRow {
  id: string;
  type: string;
  payload: unknown;
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

  return row.type === "confirmation_decision"
    ? buildConfirmationQuestionForm(payload)
    : buildDecisionQuestionForm(payload);
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
 * 汇总、去重、过滤并按优先级排序 ProductDirector 收集到的 proposal slots。
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
 * 生成 proposal decision 的稳定提问 ID。
 */
function getProposalDecisionId(result: ProductDirectorWorkflowResult): string {
  return `${result.confirmation_id}-proposal-decision`;
}

/**
 * 归一化 slot 文本，用于 MVP 阶段的 Map 去重。
 */
function normalizeSlotQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
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
      "ProductDirector Agent 汇总了 Executor Agent 需要你补充确认的信息。",
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
