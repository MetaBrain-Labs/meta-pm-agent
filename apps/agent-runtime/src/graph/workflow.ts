import { END, START, StateGraph } from "@langchain/langgraph";
import type { RequestAnalysis } from "@repo/shared";
import type { UserInputRecord } from "../agents/request/user-input";
import { parseUserInputNode, requestAgentNode } from "./nodes/request-node";
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
  /* 
    解析 user_input，为 Request Agent 和后续 Agent 准备统一输入。
  */
  .addNode("parse_user_input", parseUserInputNode)

  /* 
    Request Agent 结点：
      根据 user_input，形成 Request Analysis；
      提供 Request Analysis 给后续结点使用。
  */
  .addNode("request_agent", requestAgentNode)

  // 结点的连接逻辑
  .addEdge(START, "parse_user_input")
  .addEdge("parse_user_input", "request_agent")
  .addEdge("request_agent", END)

  .compile();

/**
 * 此处开始就开始根据 LangGraph 相关逻辑进行一系列的运行，后续整个 LangGraph 流程大致为：
 *   初始信息输入 ->
 *     Request Agent 进行分析 ->
 *       生成对应的 request_analysis ->
 *         ProductDirector Agent ->
 *           Planner Agent ->
 *             Executor Agent ->
 *               Critique Agent ->
 *               Document Agent -> 文档保存
 * 其中还有很多分支逻辑处理，待完善。
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
