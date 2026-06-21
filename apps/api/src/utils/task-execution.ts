import {
  TaskExecutionPlanSchema,
  type TaskExecutionPlan,
} from "@repo/shared";
import { parseJsonObject } from "./json";

/**
 * 从 Planner Agent 消息中解析 task_execution 计划，用于后续落库。
 */
export function parseTaskExecutionPlanPayload(
  text: string,
): TaskExecutionPlan | null {
  const block = extractTaggedBlock(
    text,
    "<task-execution",
    "</task-execution>",
  );
  if (!block) return null;

  const result = TaskExecutionPlanSchema.safeParse(parseJsonObject(block));
  return result.success ? result.data : null;
}

/**
 * 从文本中提取指定 tagged block 的内部内容。
 */
function extractTaggedBlock(
  text: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const startIndex = text.search(new RegExp(escapeRegExp(startMarker), "i"));
  if (startIndex === -1) return null;

  const openEnd = text.indexOf(">", startIndex);
  if (openEnd === -1) return null;

  const endIndex = text.indexOf(endMarker, openEnd + 1);
  if (endIndex === -1) return null;

  return text.slice(openEnd + 1, endIndex).trim();
}

/**
 * 转义正则特殊字符，保证 tagged block marker 按字面量匹配。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
