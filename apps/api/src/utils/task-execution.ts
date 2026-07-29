/**
 * Planner 计划解析工具
 *
 * 从消息正文中的结构化标签恢复最后一个有效 TaskExecutionPlan。
 *
 * Responsibilities:
 * - 解析多轮 Planner 输出
 * - 校验共享计划契约
 */

import {
  TaskExecutionPlanSchema,
  type TaskExecutionPlan,
} from "@repo/shared";
import { parseJsonObject } from "./json";

/**
 * 从 Planner SubAgent 输出中解析 task_execution 计划，用于后续落库。
 */
export function parseTaskExecutionPlanPayload(
  text: string,
): TaskExecutionPlan | null {
  const blocks = extractTaggedBlocks(
    text,
    "<task-execution",
    "</task-execution>",
  );
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const result = TaskExecutionPlanSchema.safeParse(
      parseJsonObject(blocks[index] ?? ""),
    );
    if (result.success) return result.data;
  }
  return null;
}

/**
 * 从文本中提取全部同名 tagged block，调用方可选择最后一个有效结果。
 */
function extractTaggedBlocks(
  text: string,
  startMarker: string,
  endMarker: string,
): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(escapeRegExp(startMarker), "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const openEnd = text.indexOf(">", match.index);
    const endIndex =
      openEnd === -1 ? -1 : text.indexOf(endMarker, openEnd + 1);
    if (openEnd === -1 || endIndex === -1) break;
    blocks.push(text.slice(openEnd + 1, endIndex).trim());
    pattern.lastIndex = endIndex + endMarker.length;
  }
  return blocks;
}

/**
 * 转义正则特殊字符，保证 tagged block marker 按字面量匹配。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
