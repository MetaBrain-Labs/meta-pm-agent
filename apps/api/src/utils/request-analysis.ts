import {
  RequestAnalysisSchema,
  type RequestAnalysis,
} from "@repo/shared";
import { parseJsonObject } from "./json";

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
