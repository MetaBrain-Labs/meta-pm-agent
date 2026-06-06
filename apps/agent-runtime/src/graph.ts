import { StateGraph, END, START } from "@langchain/langgraph";
import { ChatMessage } from "@repo/shared";
import { analyzeConversation } from "./conversation-agent";

interface AgentState {
  messages: ChatMessage[];
  intent: string;
  plan: string;
  conversationPhase: string;
  compressedContext: string;
}

/**
 * 对话 Agent：检测意图 → 生成 Question-Form / 处理表单答案 → 压缩上下文
 */
async function conversationNode(state: AgentState): Promise<Partial<AgentState>> {
  const result = await analyzeConversation(state.messages);

  if (result.action === "question_form") {
    const response: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.content,
      timestamp: new Date().toISOString(),
      sessionId: state.messages[0]?.sessionId ?? "",
    };
    return {
      messages: [response],
      conversationPhase: "gathering",
    };
  }

  // summarize: form answers received, compression done
  return {
    conversationPhase: "done",
    compressedContext: result.compressedContext ?? "",
  };
}

/**
 * 对话阶段路由：还需要补充信息则结束等待用户回复，否则进入下游意图分类
 */
function routeAfterConversation(
  state: AgentState,
): "classify" | typeof END {
  if (state.conversationPhase === "done") return "classify";
  return END;
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
 * 生成计划（使用压缩后的上下文）
 */
function generatePlan(state: AgentState): Partial<AgentState> {
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

  const context = state.compressedContext
    ? `\n\nContext:\n${state.compressedContext}`
    : "";

  const response: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: `Here is a project plan:${context}\n\n${plan}`,
    timestamp: new Date().toISOString(),
    sessionId: state.messages.at(-1)!.sessionId,
  };

  return { plan, messages: [response] };
}

/**
 * 预计工作量（使用压缩后的上下文）
 */
function estimateEffort(state: AgentState): Partial<AgentState> {
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

  const context = state.compressedContext
    ? `\n\nContext:\n${state.compressedContext}`
    : "";

  const response: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: `Estimate:${context}\n\n${estimates}`,
    timestamp: new Date().toISOString(),
    sessionId: state.messages.at(-1)!.sessionId,
  };

  return { messages: [response] };
}

/**
 * 路由未命中保底响应
 */
function generalResponse(state: AgentState): Partial<AgentState> {
  const last = state.messages.at(-1)!;
  const context = state.compressedContext
    ? `\n\nContext:\n${state.compressedContext}`
    : "";

  const response: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: `I can help you with:\n- Plan a project: say "plan a website"\n- Estimate effort: say "estimate these features"\n\nYou said: "${last.content}"${context}`,
    timestamp: new Date().toISOString(),
    sessionId: last.sessionId,
  };

  return { messages: [response] };
}

const graph = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (a: ChatMessage[], b: ChatMessage[]) => [...a, ...b],
      default: () => [],
    },
    intent: { value: (_a: string, b: string) => b, default: () => "" },
    plan: { value: (_a: string, b: string) => b, default: () => "" },
    conversationPhase: { value: (_a: string, b: string) => b, default: () => "" },
    compressedContext: { value: (_a: string, b: string) => b, default: () => "" },
  },
});

graph.addNode("conversation", conversationNode);
graph.addNode("classify", classifyIntent);
graph.addNode("generate_plan", generatePlan);
graph.addNode("estimate_effort", estimateEffort);
graph.addNode("general_response", generalResponse);

graph.addEdge(START, "conversation");
graph.addConditionalEdges("conversation", routeAfterConversation, {
  classify: "classify",
  [END]: END,
});
graph.addConditionalEdges("classify", routeByIntent, {
  generate_plan: "generate_plan",
  estimate_effort: "estimate_effort",
  general_response: "general_response",
});
graph.addEdge("generate_plan", END);
graph.addEdge("estimate_effort", END);
graph.addEdge("general_response", END);

const app = graph.compile();

/**
 * @param messages 完整的对话历史（包含最新用户消息）
 * @returns assistant 的回复消息，如果没有则返回 null
 */
export async function runAgent(
  messages: ChatMessage[],
): Promise<ChatMessage | null> {
  const state = await app.invoke({ messages });
  return (
    state.messages.find((m: ChatMessage) => m.role === "assistant") ?? null
  );
}
