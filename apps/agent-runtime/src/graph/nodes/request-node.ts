/**
 * Request Agent 图节点
 *
 * 实现 LangGraph 工作流中的两个节点：
 * - parseUserInputNode：解析 Conversation Agent 的 <user-input> block 为结构化语句
 * - requestAgentNode：执行 Request Agent 分类并输出至 SSE writer
 *
 * Responsibilities:
 * - 调用 parseUserInputBlock 提取用户输入
 * - 驱动 streamRequestAgent 并将分析结果写入图状态
 * - 通过 LangGraph writer 向前端发出 request-analysis-start/complete 事件
 */

import { getWriter, type LangGraphRunnableConfig } from "@langchain/langgraph";
import {
  formatRequestAnalysisBlock,
  streamRequestAgent,
} from "../../agents/request/agent";
import { parseUserInputBlock } from "../../agents/request/user-input";
import type { WorkflowGraphStateValue } from "../state";

/**
 * 将 Conversation Agent 的 <user-input> block 解析成结构化独立语句。
 */
export function parseUserInputNode(state: WorkflowGraphStateValue) {
  return {
    userInput: parseUserInputBlock(state.userInputBlock),
  };
}

/**
 * 执行 Request Agent，并把分类结果写回公共图状态。
 */
export async function requestAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  const writer = getWriter(config);
  writer?.({ type: "request-analysis-start", agentType: "request" });

  for await (const event of streamRequestAgent({
    productContext: state.productContext,
    userInput: state.userInput,
    signal: config?.signal,
  })) {
    if (event.type === "reasoning") {
      writer?.(event);
      continue;
    }

    // 透传 token-usage 事件到 SSE，不阻塞流程。
    if (event.type === "token-usage") {
      writer?.(event);
      continue;
    }

    const requestAnalysisBlock = formatRequestAnalysisBlock(event.analysis);
    writer?.({
      type: "request-analysis-complete",
      content: requestAnalysisBlock,
      analysis: event.analysis,
      agentType: "request",
    });

    return {
      requestAnalysis: event.analysis,
      requestAnalysisBlock,
    };
  }

  throw new Error("Request Agent did not produce a request analysis.");
}
