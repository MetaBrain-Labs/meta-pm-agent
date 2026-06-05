import { StateGraph, END, START } from "@langchain/langgraph";
import { ChatMessage } from "@repo/shared";

interface AgentState {
  messages: ChatMessage[];
  intent: string;
  plan: string;
}

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

function routeByIntent(state: AgentState): string {
  if (state.intent === "plan") return "generate_plan";
  if (state.intent === "estimate") return "estimate_effort";
  return "general_response";
}

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

graph.addNode("classify", classifyIntent);
graph.addNode("generate_plan", generatePlan);
graph.addNode("estimate_effort", estimateEffort);
graph.addNode("general_response", generalResponse);

graph.addEdge(START, "classify");
graph.addConditionalEdges("classify", routeByIntent, {
  generate_plan: "generate_plan",
  estimate_effort: "estimate_effort",
  general_response: "general_response",
});
graph.addEdge("generate_plan", END);
graph.addEdge("estimate_effort", END);
graph.addEdge("general_response", END);

const app = graph.compile();

export async function runAgent(
  message: ChatMessage,
): Promise<ChatMessage | null> {
  const state = await app.invoke({ messages: [message] });
  return (
    state.messages.find((m: ChatMessage) => m.role === "assistant") ?? null
  );
}
