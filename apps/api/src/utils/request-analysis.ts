import {
  RequestAnalysisSchema,
  type RequestAnalysis,
} from "@repo/shared";
import { parseJsonObject } from "./json";

/**
 * 从助手消息文本中解析 request-analysis tagged block，提取需求分析结果。
 * 与 user-input block 可共存于同一条消息中，互不影响。
 */
export function parseRequestAnalysisPayload(
  text: string,
): RequestAnalysis | null {
  // assistant 消息中可能同时包含 user-input 和 request-analysis 两个 block；
  // 这里只解析下游分析结果，保留消息正文中两个 block 共存的能力。
  const block = extractTaggedBlock(
    text,
    "<request-analysis",
    "</request-analysis>",
  );
  if (!block) return null;

  const result = RequestAnalysisSchema.safeParse(parseJsonObject(block));
  return result.success ? result.data : null;
}

/**
 * 从文本中按起始和结束标记提取 tagged block 内容。
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
 * 转义正则表达式特殊字符，防止 marker 作为正则解析时产生意外匹配。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
