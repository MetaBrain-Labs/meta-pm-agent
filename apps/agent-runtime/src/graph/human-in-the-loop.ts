/**
 * LangGraph Human-in-the-Loop 中断桥接。
 *
 * 将现有 Question Form 表单包装为 LangChain/LangGraph 可恢复的人审中断。
 * 该图只负责释放 interrupt 信号和接收 Command(resume)，不承载后续业务编排。
 *
 * Responsibilities:
 * - 将表单内容转换为 HITLRequest 风格的 interrupt payload
 * - 通过 LangGraph interrupt() 释放中断信号
 * - 通过 Command({ resume }) 记录用户恢复决策
 *
 * Notes:
 * - 产品工作流主图仍由 workflow.ts 负责；这里避免把表单人审状态混入业务图状态。
 */

import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
} from "@langchain/langgraph";

/**
 * Question Form 在 HITL payload 中对应的一次待处理动作。
 */
export interface HumanInTheLoopActionRequest {
  name: "question_form";
  args: {
    questionForm: string;
    formId: string;
    agentType?: string;
  };
  description?: string;
}

/**
 * LangChain Human-in-the-Loop 前端可渲染的中断请求。
 */
export interface HumanInTheLoopRequest {
  actionRequests: HumanInTheLoopActionRequest[];
  reviewConfigs: Array<{
    allowedDecisions: Array<"approve" | "reject" | "edit" | "respond">;
  }>;
}

/**
 * 用户恢复 HITL 中断时提交的决策。
 */
export interface HumanInTheLoopResponse {
  decisions: Array<
    | { type: "approve" }
    | { type: "reject"; message?: string }
    | {
        type: "edit";
        editedAction: {
          name: string;
          args: Record<string, unknown>;
        };
      }
    | { type: "respond"; message: string }
  >;
}

/**
 * 释放给 API/SSE 的中断元数据。
 */
export interface HumanInTheLoopInterrupt {
  id: string;
  threadId: string;
  value: HumanInTheLoopRequest;
}

interface HumanInTheLoopGraphInput {
  threadId: string;
  questionForm: string;
  agentType?: string;
}

const HumanInTheLoopGraphState = Annotation.Root({
  request: Annotation<HumanInTheLoopRequest | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),
  response: Annotation<HumanInTheLoopResponse | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),
});

const humanInTheLoopGraph = new StateGraph(HumanInTheLoopGraphState)
  .addNode("release_interrupt", releaseInterruptNode)
  .addEdge(START, "release_interrupt")
  .addEdge("release_interrupt", END)
  .compile({ checkpointer: new MemorySaver() });

/**
 * 释放 Question Form 对应的人审中断，并返回 LangGraph 生成的 interrupt 信息。
 */
export async function releaseQuestionFormHumanInterrupt(
  input: HumanInTheLoopGraphInput,
): Promise<HumanInTheLoopInterrupt | null> {
  const request = buildQuestionFormRequest(input);
  const stream = await humanInTheLoopGraph.stream(
    { request },
    {
      configurable: { thread_id: input.threadId },
      streamMode: "values",
    },
  );

  for await (const chunk of stream) {
    if (isInterrupted<HumanInTheLoopRequest>(chunk)) {
      const graphInterrupt = chunk[INTERRUPT][0];
      if (!graphInterrupt?.id || !graphInterrupt.value) return null;

      return {
        id: graphInterrupt.id,
        threadId: input.threadId,
        value: graphInterrupt.value,
      };
    }
  }

  return null;
}

/**
 * 使用用户决策恢复指定 HITL 线程，完成 LangGraph 中断闭环。
 */
export async function resumeQuestionFormHumanInterrupt({
  threadId,
  response,
}: {
  threadId: string;
  response: HumanInTheLoopResponse;
}): Promise<HumanInTheLoopResponse | null> {
  let resumed: HumanInTheLoopResponse | null = null;
  const stream = await humanInTheLoopGraph.stream(
    new Command({ resume: response }),
    {
      configurable: { thread_id: threadId },
      streamMode: "values",
    },
  );

  for await (const chunk of stream) {
    if (
      chunk &&
      typeof chunk === "object" &&
      "response" in chunk &&
      isHumanInTheLoopResponse((chunk as { response?: unknown }).response)
    ) {
      resumed = (chunk as { response: HumanInTheLoopResponse }).response;
    }
  }

  return resumed;
}

/**
 * 根据业务作用域和表单 ID 构造稳定的 LangGraph HITL thread id。
 */
export function createHumanInTheLoopThreadId({
  scopeId,
  formId,
}: {
  scopeId?: string;
  formId: string;
}): string {
  return `hitl:${scopeId ?? "local"}:${formId}`;
}

/**
 * 从 question-form tagged block 中提取表单 ID。
 */
export function extractQuestionFormId(questionForm: string): string {
  const openTag = /<question-form\b([^>]*)>/i.exec(questionForm);
  const attrs = openTag?.[1] ?? "";
  const id = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(attrs);
  return decodeHtmlAttribute(id?.[1] ?? id?.[2] ?? "question-form");
}

/**
 * Graph 节点：调用 LangGraph interrupt()，由框架写入 __interrupt__。
 */
function releaseInterruptNode(
  state: typeof HumanInTheLoopGraphState.State,
) {
  if (!state.request) return {};

  const response = interrupt<HumanInTheLoopRequest, HumanInTheLoopResponse>(
    state.request,
  );

  return { response };
}

/**
 * 把 Question Form 包装成 LangChain HITLRequest 风格 payload。
 */
function buildQuestionFormRequest(
  input: HumanInTheLoopGraphInput,
): HumanInTheLoopRequest {
  const formId = extractQuestionFormId(input.questionForm);

  return {
    actionRequests: [
      {
        name: "question_form",
        args: {
          questionForm: input.questionForm,
          formId,
          ...(input.agentType ? { agentType: input.agentType } : {}),
        },
        description: "Agent 需要人工补充或确认结构化表单信息。",
      },
    ],
    reviewConfigs: [{ allowedDecisions: ["respond"] }],
  };
}

/**
 * 校验 resume payload，避免把异常请求写入 LangGraph checkpoint。
 */
function isHumanInTheLoopResponse(
  value: unknown,
): value is HumanInTheLoopResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const decisions = (value as { decisions?: unknown }).decisions;
  return Array.isArray(decisions);
}

/**
 * 还原 question-form 标签属性中的基础 HTML 实体。
 */
function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
