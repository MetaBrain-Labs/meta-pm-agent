import { END, START, StateGraph } from "@langchain/langgraph";
import type { RequestAnalysis } from "@repo/shared";
import type { UserInputRecord } from "../agents/request/user-input";
import {
  parseUserInputNode,
  requestAgentNode,
} from "./nodes/request-node";
import { WorkflowGraphState } from "./state";

export interface WorkflowGraphInput {
  productContext?: string;
  userInputBlock: string;
}

export interface WorkflowGraphResult {
  requestAnalysis: RequestAnalysis;
  requestAnalysisBlock: string;
  userInput: UserInputRecord[];
}

/**
 * Meta PM Agent 的公共 LangGraph 主图。
 *
 * 当前图只接入 Request Agent；后续新增 Planner、QA Gate、模块 Agent 时，
 * 应继续在这里增加节点和边，而不是放到某个单独 Agent 目录里。
 */
export const graph = new StateGraph(WorkflowGraphState)
  // 先解析 user_input，为 Request Agent 和后续 Agent 准备统一输入。
  .addNode("parse_user_input", parseUserInputNode)
  // Request Agent 对独立语句做业务模型、问答、闲聊分类。
  .addNode("request_agent", requestAgentNode)
  .addEdge(START, "parse_user_input")
  .addEdge("parse_user_input", "request_agent")
  .addEdge("request_agent", END)
  .compile();

/**
 * 业务代码运行公共图的入口；LangGraph Studio 直接读取上方导出的 graph。
 */
export async function runWorkflowGraph(
  input: WorkflowGraphInput,
): Promise<WorkflowGraphResult> {
  const result = await graph.invoke({
    productContext: input.productContext ?? "",
    userInputBlock: input.userInputBlock,
  });

  if (!result.requestAnalysis) {
    throw new Error("Workflow graph completed without request analysis.");
  }

  return {
    requestAnalysis: result.requestAnalysis,
    requestAnalysisBlock: result.requestAnalysisBlock,
    userInput: result.userInput,
  };
}
