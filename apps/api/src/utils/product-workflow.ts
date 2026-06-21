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
