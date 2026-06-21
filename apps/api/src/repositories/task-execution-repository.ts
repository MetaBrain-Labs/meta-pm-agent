import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import type { TaskExecutionPlan } from "@repo/shared";

/**
 * 将 Planner Agent 生成的 DAG 计划写入 task_execution 表。
 */
export async function persistTaskExecutionPlan({
  conversationId,
  requestFormId,
  plan,
}: {
  conversationId: string | undefined;
  requestFormId: string | undefined;
  plan: TaskExecutionPlan | null;
}): Promise<void> {
  if (!conversationId || !plan) return;

  await prisma.$transaction(async (tx) => {
    for (const task of plan.tasks) {
      await tx.$executeRaw`
        INSERT INTO "task_execution" (
          "id",
          "conversation_id",
          "request_form_id",
          "task_id",
          "sequence",
          "dag",
          "assigned_agent",
          "title",
          "description",
          "covered_business_model_indexes",
          "quality_result",
          "status"
        )
        VALUES (
          ${randomUUID()},
          ${conversationId},
          ${requestFormId ?? null},
          ${task.task_id},
          ${task.sequence},
          ${JSON.stringify(plan.dag)}::jsonb,
          ${task.assigned_agent},
          ${task.title},
          ${task.description},
          ${JSON.stringify(task.covered_business_model_indexes)}::jsonb,
          ${JSON.stringify(task.quality_check)}::jsonb,
          'planned'
        )
        ON CONFLICT ("conversation_id", "task_id") DO UPDATE
        SET
          "request_form_id" = EXCLUDED."request_form_id",
          "sequence" = EXCLUDED."sequence",
          "dag" = EXCLUDED."dag",
          "assigned_agent" = EXCLUDED."assigned_agent",
          "title" = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "covered_business_model_indexes" = EXCLUDED."covered_business_model_indexes",
          "quality_result" = EXCLUDED."quality_result",
          "status" = EXCLUDED."status",
          "updated_at" = CURRENT_TIMESTAMP
      `;
    }
  });
}
