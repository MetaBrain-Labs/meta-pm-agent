/**
 * 产品工作流轮次分类
 *
 * 集中判断当前输入应生成首轮还是补充 DAG，避免 Graph、Orchestrator 与 Planner
 * 各自维护表单答案识别规则。
 *
 * Responsibilities:
 * - 根据显式补充 Agent 或表单答案返回轮次类型
 * - 复用统一的 Question Form 答案解析规则
 */

import { isFormAnswer } from "../../utils/form-parser";

export type ProductWorkflowRoundType = "initial" | "supplement";

/** 判断产品工作流当前轮次类型。 */
export function classifyProductWorkflowRound({
  userInput,
  supplementAgentTypes,
}: {
  userInput: ReadonlyArray<{ content: string }>;
  supplementAgentTypes?: readonly string[];
}): ProductWorkflowRoundType {
  return Boolean(supplementAgentTypes?.length) ||
    userInput.some((item) => isFormAnswer(item.content))
    ? "supplement"
    : "initial";
}
