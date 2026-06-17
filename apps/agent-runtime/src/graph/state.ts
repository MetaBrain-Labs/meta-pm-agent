import { Annotation } from "@langchain/langgraph";
import type { RequestAnalysis } from "@repo/shared";
import type { UserInputRecord } from "../agents/request/user-input";

/**
 * 公共 LangGraph 状态。后续新增 Planner、QA 或模块 Agent 时，
 * 都应继续在这里扩展跨节点共享的状态字段。
 */
export const WorkflowGraphState = Annotation.Root({
  // API 读取工作区概述性文档后注入，可为空。
  productContext: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),

  // Conversation Agent 输出的原始 <user-input> 内容。
  userInputBlock: Annotation<string>(),

  // 解析后的独立语句列表，供 Request Agent 及后续 Agent 使用。
  userInput: Annotation<UserInputRecord[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  // Request Agent 的结构化分类结果。
  requestAnalysis: Annotation<RequestAnalysis | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // 沿用现有 SSE/消息内容中的 tagged block 传输方式。
  requestAnalysisBlock: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
});

export type WorkflowGraphStateValue = typeof WorkflowGraphState.State;
