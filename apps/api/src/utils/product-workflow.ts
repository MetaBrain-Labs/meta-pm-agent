/**
 * 产品工作流消息工具
 *
 * 负责解析 Executor/Critique 结构块，并生成不含完整知识图谱的持久化快照。
 *
 * Responsibilities:
 * - 恢复最后一个有效结构化结果
 * - 清洗消息持久化负载
 */

import {
  ExecutorAgentResultSchema,
  ProductWorkflowResultSchema,
  type ExecutorAgentResult,
  type ProductWorkflowResult,
} from "@repo/shared";
import { parseJsonObject } from "./json";

/**
 * 从产品工作流消息中解析完整产品工作流结果。
 */
export function parseProductWorkflowPayload(
  text: string,
): ProductWorkflowResult | null {
  const blocks = extractTaggedBlocks(
    text,
    "<product-workflow",
    "</product-workflow>",
  );
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const result = ProductWorkflowResultSchema.safeParse(
      parseJsonObject(blocks[index] ?? ""),
    );
    if (result.success) return result.data;
  }
  return null;
}

/**
 * 从 Executor Agent 消息中解析单个执行结果。
 */
export function parseExecutorResultPayload(
  text: string,
): ExecutorAgentResult | null {
  const blocks = extractTaggedBlocks(
    text,
    "<executor-result",
    "</executor-result>",
  );
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const result = ExecutorAgentResultSchema.safeParse(
      parseJsonObject(blocks[index] ?? ""),
    );
    if (result.success) return result.data;
  }
  return null;
}

/**
 * 生成不包含知识图谱正文的 Executor 持久化结果。
 * knowledge_graph_markdown 已从 ExecutorAgentResult 中移除，此处保留 knowledge_graph_patch 的剥离。
 */
export function sanitizeExecutorResultForPersistence(
  result: ExecutorAgentResult,
): ExecutorAgentResult {
  const { knowledge_graph_patch, knowledge_graph_markdown, ...rest } = result;
  void knowledge_graph_patch;
  void knowledge_graph_markdown;
  return {
    ...rest,
    knowledge_graph_patch: undefined,
    knowledge_graph_markdown: undefined,
  } as ExecutorAgentResult;
}

/**
 * 生成不包含知识图谱正文的产品工作流持久化结果。
 */
export function sanitizeProductWorkflowForPersistence(
  result: ProductWorkflowResult,
): ProductWorkflowResult {
  return {
    ...result,
    executor_results: result.executor_results.map(
      sanitizeExecutorResultForPersistence,
    ),
    knowledge_graph_update: {
      ...result.knowledge_graph_update,
      markdown: "",
    },
  };
}

/**
 * 生成消息历史恢复 Critique 卡片所需的轻量快照，不重复保存完整知识图谱。
 */
export function createProductWorkflowDisplaySnapshot(
  result: ProductWorkflowResult,
): ProductWorkflowResult {
  return {
    ...result,
    executor_results: [],
    knowledge_graph_update: {
      current_state: result.knowledge_graph_update.current_state,
      entities: [],
      relations: [],
      decisions: [],
      risks: [],
      open_questions: [],
      summary: [],
      markdown: "",
      notes: [],
    },
  };
}

/**
 * 生成可解析的 Executor 持久化 tagged block。
 */
export function formatExecutorResultPayload(
  result: ExecutorAgentResult,
): string {
  return `<executor-result>\n${JSON.stringify(result, null, 2)}\n</executor-result>`;
}

/**
 * 生成可解析的产品工作流持久化 tagged block。
 */
export function formatProductWorkflowPayload(
  result: ProductWorkflowResult,
): string {
  return `<product-workflow>\n${JSON.stringify(result, null, 2)}\n</product-workflow>`;
}

/**
 * 提取全部同名 tagged block，优先恢复最后一个有效运行结果。
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
 * 转义正则特殊字符，保证 marker 按字面量匹配。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
