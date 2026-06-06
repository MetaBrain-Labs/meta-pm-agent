import { ExecutionGraph } from "../graph/execution-graph";
import { TaskNode } from "../graph/task-node";
import { TaskState } from "../state/task-state";

export class Scheduler {
  getReadyTasks(
    graph: ExecutionGraph,
    tasks: Record<string, TaskState>,
  ): TaskNode[] {
    return graph.nodes.filter((node) => {
      const state = tasks[node.id];

      if (state && state.status !== "pending") {
        return false;
      }

      return node.dependencies.every((dep) => {
        return tasks[dep]?.status === "completed";
      });
    });
  }
}
