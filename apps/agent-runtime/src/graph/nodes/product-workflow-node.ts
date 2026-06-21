import { runProductDirectorWorkflow } from "../../agents/product-workflow/agent";
import type { WorkflowGraphStateValue } from "../state";

/**
 * 执行产品工作流节点，由 ProductDirector 编排 Planner 和 Executor 生成待确认结果。
 */
export async function productWorkflowNode(state: WorkflowGraphStateValue) {
  if (
    !state.requestAnalysis ||
    state.requestAnalysis.business_model.length === 0
  ) {
    return {};
  }

  return {
    productWorkflow: await runProductDirectorWorkflow({
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      userInput: state.userInput,
    }),
  };
}
