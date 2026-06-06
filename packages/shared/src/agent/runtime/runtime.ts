import { WorkflowState } from "../state/workflow-state";

export interface WorkflowRuntime {
  execute(state: WorkflowState): Promise<WorkflowState>;
}
