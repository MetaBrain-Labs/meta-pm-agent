/**
 * Resume SubAgent 契约与载荷构造
 *
 * 定义恢复判断的输入类型、载荷构造和回退逻辑。
 *
 * Responsibilities:
 * - 定义 ResumeSubagentInput 类型
 * - buildResumePayload()：构造 Agent 输入载荷
 * - createFallbackResumeCheckResult()：模型不可用时给出保守回退
 */
import {
  type OrchestratorResumeCheckResult,
  type ProductKnowledgeGraph,
} from "@repo/shared";

export interface ResumeSubagentInput {
  userMessage: string;
  recentMessages: Array<{ role: string; content: string }>;
  productContext?: string;
  knowledgeGraph?: ProductKnowledgeGraph | null;
  workspaceId?: string;
  workflowThreadId?: string;
  signal?: AbortSignal;
}

/**
 * 构造 Resume 输入载荷。
 */
export function buildResumePayload(input: ResumeSubagentInput) {
  const graph = input.knowledgeGraph;
  return {
    latest_user_message: input.userMessage,
    recent_messages: input.recentMessages.slice(-8),
    workspace_id: input.workspaceId ?? null,
    workflow_thread_id: input.workflowThreadId ?? null,
    product_context:
      input.productContext?.trim() || "No product context provided.",
    graph_stats: graph
      ? {
          current_state: graph.current_state ?? null,
          description: graph.description ?? "",
          entities: graph.entities.length,
          relations: graph.relations.length,
          decisions: graph.decisions.length,
          risks: graph.risks.length,
          open_questions: graph.open_questions.length,
          summary_items: graph.summary.length,
        }
      : null,
  };
}

/**
 * 模型失败或 Agent 无输出时保守回到普通路由。
 */
export function createFallbackResumeCheckResult(
  reason: string,
): OrchestratorResumeCheckResult {
  return {
    decision: "CONTINUE_NORMAL_ROUTING",
    confidence: "low",
    reason_summary: `Fallback retained normal routing because resume-check failed: ${reason}`.slice(
      0,
      500,
    ),
  };
}
