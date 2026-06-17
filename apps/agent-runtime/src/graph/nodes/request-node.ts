import {
  formatRequestAnalysisBlock,
  runRequestAgent,
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
export async function requestAgentNode(state: WorkflowGraphStateValue) {
  const requestAnalysis = await runRequestAgent({
    productContext: state.productContext,
    userInput: state.userInput,
  });

  return {
    requestAnalysis,
    requestAnalysisBlock: formatRequestAnalysisBlock(requestAnalysis),
  };
}
