import {
  ExecutorAgentResultSchema,
  ProductDirectorWorkflowResultSchema,
  type ExecutorAgentResult,
  type ProductDirectorWorkflowResult,
} from "@repo/shared";
import { parseJsonObject } from "./json";

/**
 * 从 ProductDirector Agent 消息中解析完整产品工作流结果。
 */
export function parseProductWorkflowPayload(
  text: string,
): ProductDirectorWorkflowResult | null {
  const block = extractTaggedBlock(
    text,
    "<product-workflow",
    "</product-workflow>",
  );
  if (!block) return null;

  const result = ProductDirectorWorkflowResultSchema.safeParse(
    parseJsonObject(block),
  );
  return result.success ? result.data : null;
}

/**
 * 从 Executor Agent 消息中解析单个执行结果。
 */
export function parseExecutorResultPayload(
  text: string,
): ExecutorAgentResult | null {
  const block = extractTaggedBlock(
    text,
    "<executor-result",
    "</executor-result>",
  );
  if (!block) return null;

  const result = ExecutorAgentResultSchema.safeParse(parseJsonObject(block));
  return result.success ? result.data : null;
}

/**
 * 生成不包含知识图谱正文的 Executor 持久化结果。
 */
export function sanitizeExecutorResultForPersistence(
  result: ExecutorAgentResult,
): ExecutorAgentResult {
  const { knowledge_graph_patch, knowledge_graph_markdown, ...rest } = result;
  void knowledge_graph_patch;
  void knowledge_graph_markdown;
  return rest;
}

/**
 * 生成不包含知识图谱正文的 ProductDirector 持久化结果。
 */
export function sanitizeProductWorkflowForPersistence(
  result: ProductDirectorWorkflowResult,
): ProductDirectorWorkflowResult {
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
 * 生成可解析的 Executor 持久化 tagged block。
 */
export function formatExecutorResultPayload(
  result: ExecutorAgentResult,
): string {
  return `<executor-result>\n${JSON.stringify(result, null, 2)}\n</executor-result>`;
}

/**
 * 生成可解析的 ProductDirector 持久化 tagged block。
 */
export function formatProductWorkflowPayload(
  result: ProductDirectorWorkflowResult,
): string {
  return `<product-workflow>\n${JSON.stringify(result, null, 2)}\n</product-workflow>`;
}

/**
 * 提取 tagged block 内部 JSON 文本。
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
 * 转义正则特殊字符，保证 marker 按字面量匹配。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
