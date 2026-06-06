import { StateGraph, END, START } from "@langchain/langgraph";
import { ChatMessage } from "@repo/shared";

interface AgentState {
  messages: ChatMessage[];
  intent: string;
  plan: string;
}

/**
 * 意图分类器
 */
function classifyIntent(state: AgentState): Partial<AgentState> {
  const last = state.messages.at(-1);
  const content = last?.content.toLowerCase() ?? "";

  if (
    content.includes("plan") ||
    content.includes("roadmap") ||
    content.includes("break") ||
    content.includes("step")
  ) {
    return { intent: "plan" };
  }
  if (
    content.includes("estimate") ||
    content.includes("time") ||
    content.includes("effort") ||
    content.includes("how long")
  ) {
    return { intent: "estimate" };
  }
  return { intent: "general" };
}

/**
 * 根据意图进行路由
 */
function routeByIntent(
  state: AgentState,
): "generate_plan" | "estimate_effort" | "general_response" {
  if (state.intent === "plan") return "generate_plan";
  if (state.intent === "estimate") return "estimate_effort";
  return "general_response";
}

/**
 * 生成计划
 */
function generatePlan(state: AgentState): Partial<AgentState> {
  const last = state.messages.at(-1)!;
  const plan = [
    "Phase 1: Requirements & Discovery",
    "  - Define project scope and goals",
    "  - Identify stakeholders",
    "",
    "Phase 2: Design & Architecture",
    "  - Create system architecture",
    "  - Design data models",
    "",
    "Phase 3: Implementation",
    "  - Set up project scaffolding",
    "  - Implement core features",
    "  - Write unit tests",
    "",
    "Phase 4: Testing & QA",
    "  - Integration testing",
    "  - Performance testing",
    "",
    "Phase 5: Deployment",
    "  - Set up CI/CD pipeline",
    "  - Deploy to staging",
    "  - Production release",
  ].join("\n");

  const response: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: `Here is a project plan for "${last.content}":\n\n${plan}`,
    timestamp: new Date().toISOString(),
    sessionId: last.sessionId,
  };

  return { plan, messages: [response] };
}

/**
 * 预计工作量
 */
function estimateEffort(state: AgentState): Partial<AgentState> {
  const last = state.messages.at(-1)!;
  const estimates = [
    "Task Breakdown & Estimates:",
    "",
    "| Task | Effort | Priority |",
    "|------|--------|----------|",
    "| Requirements gathering | 3 days | High |",
    "| Technical design | 5 days | High |",
    "| Core development | 10 days | High |",
    "| Testing & bug fixes | 5 days | Medium |",
    "| Documentation | 3 days | Medium |",
    "| Deployment & release | 2 days | Medium |",
    "",
    "Total estimated: ~28 days",
  ].join("\n");

  const response: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: `Estimate for "${last.content}":\n\n${estimates}`,
    timestamp: new Date().toISOString(),
    sessionId: last.sessionId,
  };

  return { messages: [response] };
}

/**
 * 路由未命中保底响应
 */
function generalResponse(state: AgentState): Partial<AgentState> {
  const last = state.messages.at(-1)!;
  const response: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: `I can help you with:\n- Plan a project: say "plan a website"\n- Estimate effort: say "estimate these features"\n\nYou said: "${last.content}"`,
    timestamp: new Date().toISOString(),
    sessionId: last.sessionId,
  };

  return { messages: [response] };
}

/**
 * 创建一个状态图实例
 *   value: 更新逻辑：当节点返回新值时，如何与旧值合并
 *   default: 图启动时该字段的默认值
 */
const graph = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (a: ChatMessage[], b: ChatMessage[]) => [...a, ...b],
      default: () => [],
    },
    intent: { value: (_a: string, b: string) => b, default: () => "" },
    plan: { value: (_a: string, b: string) => b, default: () => "" },
  },
});

// 添加路由分类器节点
graph.addNode("classify", classifyIntent);
// 如果路由命中plan，则调用该节点
graph.addNode("generate_plan", generatePlan);
// 如果路由命中estimate，则调用该节点
graph.addNode("estimate_effort", estimateEffort);
// 保底措施，上述都未命中，则调用该节点
graph.addNode("general_response", generalResponse);

// 执行顺序：入口
graph.addEdge(START, "classify");
// 入口：条件路由
graph.addConditionalEdges("classify", routeByIntent, {
  generate_plan: "generate_plan",
  estimate_effort: "estimate_effort",
  general_response: "general_response",
});
// plan分支处理
graph.addEdge("generate_plan", END);
// estimate分支处理
graph.addEdge("estimate_effort", END);
// 保底分支处理
graph.addEdge("general_response", END);

/**
 * 把图结构编译成一个可运行的对象。此时 LangGraph 会检查：
 *   所有节点是否可达
 *   是否有死循环
 *   状态类型是否匹配
 */
const app = graph.compile();

/**
 * 对外暴露的调用接口
 *   app.invoke({ messages: [message] })	启动图执行，把用户消息作为初始状态传入
 *   state.messages	执行结束后，从最终状态里取出所有消息
 *   .find(m => m.role === "assistant")	过滤出 AI 的回复消息
 *   ?? null	如果没找到 assistant 消息，返回 null
 */
export async function runAgent(
  message: ChatMessage,
): Promise<ChatMessage | null> {
  const state = await app.invoke({ messages: [message] });
  return (
    state.messages.find((m: ChatMessage) => m.role === "assistant") ?? null
  );
}
