import { TaskEdge } from "./task-edge";
import { TaskNode } from "./task-node";

export interface ExecutionGraph {
  nodes: TaskNode[];

  edges: TaskEdge[];
}
