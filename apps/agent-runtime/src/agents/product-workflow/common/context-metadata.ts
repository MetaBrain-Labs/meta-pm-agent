/**
 * 产品上下文元信息维护工具
 *
 * 统一维护运行时 ProductKnowledgeGraph 中不属于 nodes/relations 的产品上下文字段。
 * Orchestrator 负责生命周期 current_state，Orchestrator、Executor、Critique 共同追加 description。
 *
 * Responsibilities:
 * - 写入 current_state 生命周期状态
 * - 追加各 Agent 本轮完成事项到 description
 * - 控制 description 长度，避免产品上下文无限膨胀
 *
 * Notes:
 * - 本模块不修改知识图谱 nodes/relations 内容
 */

import type { ProductKnowledgeGraph } from "@repo/shared";

export type ProductContextCurrentState = NonNullable<
  ProductKnowledgeGraph["current_state"]
>;

const MAX_DESCRIPTION_LENGTH = 12_000;

/**
 * 更新产品上下文生命周期状态，并可追加本轮 Agent 工作摘要。
 */
export function updateProductContextMetadata({
  knowledgeGraph,
  currentState,
  descriptionEntry,
}: {
  knowledgeGraph: ProductKnowledgeGraph;
  currentState?: ProductContextCurrentState;
  descriptionEntry?: string;
}): ProductKnowledgeGraph {
  return {
    ...knowledgeGraph,
    ...(currentState ? { current_state: currentState } : {}),
    description: appendDescriptionEntry(
      knowledgeGraph.description,
      descriptionEntry,
    ),
  };
}

/**
 * 追加一条去重后的 Agent 工作记录，保留最近的上下文说明。
 */
function appendDescriptionEntry(
  current: string | undefined,
  entry: string | undefined,
): string | undefined {
  const normalizedEntry = normalizeDescriptionEntry(entry);
  if (!normalizedEntry) return current;

  const existingEntries = (current ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const nextEntries = existingEntries.includes(normalizedEntry)
    ? existingEntries
    : [...existingEntries, normalizedEntry];
  const nextDescription = nextEntries.join("\n");

  if (nextDescription.length <= MAX_DESCRIPTION_LENGTH) {
    return nextDescription;
  }

  return nextDescription.slice(nextDescription.length - MAX_DESCRIPTION_LENGTH);
}

/**
 * 收敛描述文本，避免空白和换行破坏上下文日志格式。
 */
function normalizeDescriptionEntry(entry: string | undefined): string {
  return entry?.replace(/\s+/g, " ").trim() ?? "";
}
