import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  ProductDirectorWorkflowResult,
  RequestAnalysis,
} from "@repo/shared";
import {
  formatRequestAnalysisBlock,
  streamRequestAgent,
} from "../agents/request/agent";
import {
  parseUserInputBlock,
  type UserInputRecord,
} from "../agents/request/user-input";
import {
  streamProductDirectorWorkflow,
  type ProductWorkflowStreamEvent,
} from "../agents/product-workflow/agent";
import { productWorkflowNode } from "./nodes/product-workflow-node";
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
  // ProductDirector 节点内部继续编排 Planner 与 Executor。
  .addNode("product_workflow", productWorkflowNode)

  .addEdge(START, "parse_user_input")
  .addEdge("parse_user_input", "request_agent")
  .addConditionalEdges("request_agent", selectNextNodeAfterRequestAgent, {
    product_workflow: "product_workflow",
    end: END,
  })
  .addEdge("product_workflow", END)
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
    productWorkflow: result.productWorkflow,
  };
}

/**
 * 流式运行主工作图，供 SSE 路径复用图编排并保留中间 Agent 事件。
 */
export async function* streamWorkflowGraph(
  input: WorkflowGraphInput,
): AsyncGenerator<WorkflowGraphStreamEvent> {
  const userInput = parseUserInputBlock(input.userInputBlock);

  yield { type: "request-analysis-start", agentType: "request" };

  for await (const event of streamRequestAgent({
    productContext: input.productContext,
    userInput,
    signal: input.signal,
  })) {
    if (event.type === "reasoning") {
      yield event;
      continue;
    }

    yield {
      type: "request-analysis-complete",
      content: formatRequestAnalysisBlock(event.analysis),
      analysis: event.analysis,
      agentType: "request",
    };

    if (event.analysis.business_model.length === 0) {
      return;
    }

    for await (const workflowEvent of streamProductDirectorWorkflow({
      productContext: input.productContext,
      requestAnalysis: event.analysis,
      userInput,
      signal: input.signal,
    })) {
      yield workflowEvent;
    }
  }
}

/**
 * 根据 Request Agent 是否识别到业务建模项，决定是否进入产品工作流。
 */
function selectNextNodeAfterRequestAgent(state: WorkflowGraphStateValue) {
  return state.requestAnalysis?.business_model.length
    ? "product_workflow"
    : "end";
}
