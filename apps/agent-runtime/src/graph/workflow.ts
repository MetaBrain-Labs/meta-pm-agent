import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  ExecutorAgentResult,
  ProductDirectorWorkflowResult,
  RequestAnalysis,
  TaskExecutionPlan,
} from "@repo/shared";
import type { UserInputRecord } from "../agents/request/user-input";
import type { ProductWorkflowStreamEvent } from "../agents/product-workflow/agent";
import {
  executorAgentNode,
  plannerAgentNode,
  productDirectorAgentNode,
} from "./nodes/product-workflow-node";
import { parseUserInputNode, requestAgentNode } from "./nodes/request-node";
import { WorkflowGraphState, type WorkflowGraphStateValue } from "./state";

export interface WorkflowGraphInput {
  productContext?: string;
  userInputBlock: string;
  signal?: AbortSignal;
}

export interface WorkflowGraphResult {
  requestAnalysis: RequestAnalysis;
  requestAnalysisBlock: string;
  userInput: UserInputRecord[];
  plan?: TaskExecutionPlan | null;
  executorResults: ExecutorAgentResult[];
  productWorkflow?: ProductDirectorWorkflowResult | null;
}

export type WorkflowGraphStreamEvent =
  | { type: "reasoning"; content: string; agentType: "request" }
  | { type: "request-analysis-start"; agentType: "request" }
  | {
      type: "request-analysis-complete";
      content: string;
      analysis: RequestAnalysis;
      agentType: "request";
    }
  | ProductWorkflowStreamEvent;

/**
 * Meta PM Agent 的 LangGraph 主图，负责从用户输入整理到产品工作流的阶段规划。
 */
export const graph = new StateGraph(WorkflowGraphState)
  // 将 Conversation Agent 的 <user-input> block 转成结构化输入。
  .addNode("parse_user_input", parseUserInputNode)
  // Request Agent 负责对用户输入进行业务建模分类。
  .addNode("request_agent", requestAgentNode)
  // Planner Agent 负责把业务建模项规划为可执行 DAG。
  .addNode("planner_agent", plannerAgentNode)
  // Executor Agent 负责按 DAG 生成各领域图谱增量。
  .addNode("executor_agent", executorAgentNode)
  // ProductDirector Agent 负责验收 Planner 与 Executor 的完整结果。
  .addNode("product_director_agent", productDirectorAgentNode)

  .addEdge(START, "parse_user_input")
  .addEdge("parse_user_input", "request_agent")
  .addConditionalEdges("request_agent", selectNextNodeAfterRequestAgent, {
    planner_agent: "planner_agent",
    end: END,
  })
  .addEdge("planner_agent", "executor_agent")
  .addEdge("executor_agent", "product_director_agent")
  .addEdge("product_director_agent", END)
  .compile();

/**
 * 运行完整 LangGraph 主图，适用于不需要 SSE 中间事件的调用场景。
 */
export async function runWorkflowGraph(
  input: WorkflowGraphInput,
): Promise<WorkflowGraphResult> {
  const result = await graph.invoke(
    {
      productContext: input.productContext ?? "",
      userInputBlock: input.userInputBlock,
    },
    { signal: input.signal },
  );

  if (!result.requestAnalysis) {
    throw new Error("Workflow graph completed without request analysis.");
  }

  return {
    requestAnalysis: result.requestAnalysis,
    requestAnalysisBlock: result.requestAnalysisBlock,
    userInput: result.userInput,
    plan: result.plan,
    executorResults: result.executorResults,
    productWorkflow: result.productWorkflow,
  };
}

/**
 * 流式运行主工作图，供 SSE 路径复用图编排并保留中间 Agent 事件。
 */
export async function* streamWorkflowGraph(
  input: WorkflowGraphInput,
): AsyncGenerator<WorkflowGraphStreamEvent> {
  const stream = await graph.stream(
    {
      productContext: input.productContext ?? "",
      userInputBlock: input.userInputBlock,
    },
    { signal: input.signal, streamMode: "custom" },
  );

  for await (const event of stream) {
    yield event as WorkflowGraphStreamEvent;
  }
}

/**
 * 根据 Request Agent 是否识别到业务建模项，决定是否进入产品工作流。
 */
function selectNextNodeAfterRequestAgent(state: WorkflowGraphStateValue) {
  return state.requestAnalysis?.business_model.length
    ? "planner_agent"
    : "end";
}
