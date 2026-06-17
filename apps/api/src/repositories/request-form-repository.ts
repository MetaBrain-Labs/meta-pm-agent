import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type { RequestAnalysis } from "@repo/shared";

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
