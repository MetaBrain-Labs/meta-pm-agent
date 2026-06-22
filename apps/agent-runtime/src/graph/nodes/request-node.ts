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
