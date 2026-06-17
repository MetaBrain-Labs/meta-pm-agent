import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { RequestAnalysis } from "@repo/shared";
import {
  formatRequestAnalysisBlock,
  runRequestAgent,
} from "./agent";
import {
  parseUserInputBlock,
  type UserInputRecord,
} from "./user-input";

const RequestWorkflowState = Annotation.Root({
  // productContext 由 API 读取工作区概述性文档后注入，可为空。
  productContext: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  // userInputBlock 是 Conversation Agent 输出的原始 <user-input> 内容。
  userInputBlock: Annotation<string>(),
  // userInput 是解析后的独立语句列表，供 Request Agent 分类使用。
  userInput: Annotation<UserInputRecord[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  // requestAnalysis 保存 Request Agent 的结构化分类结果。
  requestAnalysis: Annotation<RequestAnalysis | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  // requestAnalysisBlock 用于沿用现有 SSE/消息内容中的 tagged block 传输方式。
  requestAnalysisBlock: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
});

export interface RequestWorkflowInput {
  productContext?: string;
  userInputBlock: string;
}

export interface RequestWorkflowResult {
  requestAnalysis: RequestAnalysis;
  requestAnalysisBlock: string;
  userInput: UserInputRecord[];
}

const requestWorkflow = new StateGraph(RequestWorkflowState)
  // 先把 Conversation Agent 的输出规范化，后续分类节点只处理解析后的记录。
  .addNode("parse_user_input", (state: typeof RequestWorkflowState.State) => ({
    userInput: parseUserInputBlock(state.userInputBlock),
  }))
  // 这是 user_input 之后第一个无需用户参与的下游处理节点。
  .addNode("request_agent", async (state: typeof RequestWorkflowState.State) => {
    const requestAnalysis = await runRequestAgent({
      productContext: state.productContext,
      userInput: state.userInput,
    });

    return {
      requestAnalysis,
      requestAnalysisBlock: formatRequestAnalysisBlock(requestAnalysis),
    };
  })
  .addEdge(START, "parse_user_input")
  .addEdge("parse_user_input", "request_agent")
  .addEdge("request_agent", END)
  .compile();

export async function runRequestWorkflow(
  input: RequestWorkflowInput,
): Promise<RequestWorkflowResult> {
  const result = await requestWorkflow.invoke({
    productContext: input.productContext ?? "",
    userInputBlock: input.userInputBlock,
  });

  if (!result.requestAnalysis) {
    throw new Error("Request workflow completed without request analysis.");
  }

  return {
    requestAnalysis: result.requestAnalysis,
    requestAnalysisBlock: result.requestAnalysisBlock,
    userInput: result.userInput,
  };
}
