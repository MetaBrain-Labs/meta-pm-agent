import { Annotation } from "@langchain/langgraph";
import type {
  ExecutorAgentResult,
  ProductKnowledgeGraph,
  ProductWorkflowResult,
  RequestAnalysis,
  TaskExecutionPlan,
} from "@repo/shared";
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

  // 当前会话所属工作区 ID，用于隔离运行时知识图谱文件。
  workspaceId: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
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

  // 当前产品知识图谱快照，供 Planner 和 Executor 共享上下文。
  knowledgeGraph: Annotation<ProductKnowledgeGraph | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Planner Agent 生成的 DAG 计划，后续 Executor 节点按该计划执行。
  plan: Annotation<TaskExecutionPlan | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Executor Agent 对 Planner DAG 中每个任务的结构化产出。
  executorResults: Annotation<ExecutorAgentResult[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  // Planner Agent 对 Planner 和 Executor 结果的最终汇总结果。
  productWorkflow: Annotation<ProductWorkflowResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export type WorkflowGraphStateValue = typeof WorkflowGraphState.State;
