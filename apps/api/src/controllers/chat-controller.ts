import type { Context } from "hono";
import { stream } from "hono/streaming";
import { streamConversation } from "@repo/agent-runtime";
import {
  ChatRequestSchema,
  CreateChatRequestSchema,
  CreateWorkspaceRequestSchema,
  ListChatsQuerySchema,
} from "../schemas";
import { toApiEvent } from "../services/agent-stream-service";
import {
  type AgentConversationOutput,
  createChat,
  listMessages,
  listChats,
  persistConversationResult,
  persistConversationStart,
} from "../services/chat-service";
import { loadProductContextForConversation } from "../services/product-context-service";
import {
  createWorkspace,
  getAccount,
  listWorkspaces,
} from "../services/workspace-service";
import { writeSse, writeSseDone } from "../utils/sse";

/**
 * SSE 处理期间的 Agent 输出累加器，内部始终保留可写的工具调用数组。
 */
type AgentOutputAccumulator = AgentConversationOutput & {
  reasoningContent: string;
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>;
};

/**
 * 获取当前本地用户的账户信息。
 */
export async function getAccountHandler(c: Context) {
  return c.json({
    account: await getAccount(),
  });
}

/**
 * 获取当前本地用户的所有工作区列表。
 */
export async function listWorkspacesHandler(c: Context) {
  return c.json({
    workspaces: await listWorkspaces(),
  });
}

/**
 * 创建新工作区，校验并解析请求体中的名称和本地路径。
 */
export async function createWorkspaceHandler(c: Context) {
  const body = await readJsonBody(c.req.raw);
  const parsed = CreateWorkspaceRequestSchema.safeParse(body ?? {});

  // 请求体校验失败时返回 400 及详细错误信息
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  return c.json(
    {
      workspace: await createWorkspace(
        parsed.data.name,
        parsed.data.localPath,
      ),
    },
    201,
  );
}

/**
 * 按工作区 ID 查询当前用户的活跃会话列表。
 */
export async function listChatsHandler(c: Context) {
  const parsed = ListChatsQuerySchema.safeParse({
    workspaceId: c.req.query("workspaceId"),
  });

  // 查询参数校验失败时返回 400
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  return c.json({
    chats: await listChats(parsed.data.workspaceId),
  });
}

/**
 * 获取指定会话的所有历史消息。
 */
export async function listMessagesHandler(c: Context) {
  return c.json({
    messages: await listMessages(c.req.param("id")!),
  });
}

/**
 * 在指定工作区中创建新会话，校验请求体后调用业务服务。
 */
export async function createChatHandler(c: Context) {
  const body = await readJsonBody(c.req.raw);
  const parsed = CreateChatRequestSchema.safeParse(body ?? {});

  // 请求体校验失败时返回 400
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { chat, requestForm } = await createChat(
    parsed.data.workspaceId,
    parsed.data.title,
  );

  return c.json({ chat, requestForm }, 201);
}

/**
 * 处理 SSE 流式对话请求，负责消息持久化、上下文加载和流式事件转发。
 */
export async function chatStreamHandler(c: Context) {
  const body = await readJsonBody(c.req.raw);
  const parsed = ChatRequestSchema.safeParse(body);

  // 请求体校验失败时返回 400
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // 设置 SSE 响应头
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (writer) => {
    // 发送 SSE 开始事件
    await writeSse(writer, { type: "start" });

    let responseLength = 0;
    const agentOutputs = new Map<string, AgentOutputAccumulator>();

    try {
      // 持久化用户发送的消息
      await persistConversationStart(
        parsed.data.chatId,
        parsed.data.messages,
      );

      // Request Agent 需要产品概述上下文；按会话加载工作区概述文档
      const productContext = await loadProductContextForConversation(
        parsed.data.chatId,
      );

      // 启动 agent-runtime 流式对话
      for await (const event of streamConversation(
        parsed.data.messages,
        {
          enabledTools: parsed.data.enabledTools,
          productContext,
        },
      )) {
        if ("content" in event && event.type === "reasoning") {
          getAgentOutput(agentOutputs, getEventAgentType(event)).reasoningContent +=
            event.content;
        }
        if (event.type === "tool-call") {
          const output = getAgentOutput(agentOutputs, getEventAgentType(event));
          output.toolCalls.push({
            name: event.toolName,
            args: event.toolArgs,
          });
        }
        if (event.type === "tool-result") {
          const output = getAgentOutput(agentOutputs, getEventAgentType(event));
          attachToolResult(output.toolCalls, event.toolName, event.toolResult);
        }
        if (
          "content" in event &&
          event.type !== "reasoning"
        ) {
          responseLength += event.content.length;
          getAgentOutput(agentOutputs, getEventAgentType(event)).content +=
            event.content;
        }
        await writeSse(writer, toApiEvent(event));
      }

      // Agent 完成后持久化结果
      await persistConversationResult({
        conversationId: parsed.data.chatId,
        requestFormId: parsed.data.requestFormId,
        agentOutputs: [...agentOutputs.values()],
      });

      console.log(
        `[chat] Stream complete, response length: ${responseLength}`,
      );
    } catch (error) {
      console.error("[chat] Error:", error);
      await writeSse(writer, {
        type: "error",
        error: getErrorMessage(error),
      });
    }

    // 发送 SSE 结束信号
    await writeSseDone(writer);
  });
}

/**
 * 安全地将请求体解析为 JSON，解析失败时返回 undefined 而非抛出异常。
 */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * 将 unknown 类型的错误对象转换为可读字符串。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 按事件来源推断 Agent 类型，确保后续新增 Agent 时可以优先使用事件自带标识。
 */
function getEventAgentType(event: { type: string; agentType?: string }): string {
  if (event.agentType) return event.agentType;
  if (event.type.startsWith("request-analysis")) return "request";
  return "conversation";
}

/**
 * 获取指定 Agent 的输出累加器，统一收集正文和推理内容。
 */
function getAgentOutput(
  outputs: Map<string, AgentOutputAccumulator>,
  type: string,
): AgentOutputAccumulator {
  const existing = outputs.get(type);
  if (existing) return existing;

  const created = {
    type,
    content: "",
    reasoningContent: "",
    toolCalls: [],
  };
  outputs.set(type, created);
  return created;
}

/**
 * 将工具结果挂到最近一次同名工具调用上，恢复历史消息时可重新展示工具卡片。
 */
function attachToolResult(
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>,
  toolName: string,
  toolResult: unknown,
): void {
  const targetIndex = findPendingToolCallIndex(toolCalls, toolName);

  if (targetIndex === -1) {
    toolCalls.push({ name: toolName, result: toolResult });
    return;
  }

  toolCalls[targetIndex] = {
    ...toolCalls[targetIndex],
    result: toolResult,
  };
}

/**
 * 从后往前查找同名未完成工具调用，避免依赖较新的数组运行时 API。
 */
function findPendingToolCallIndex(
  toolCalls: NonNullable<AgentConversationOutput["toolCalls"]>,
  toolName: string,
): number {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const toolCall = toolCalls[index];
    if (
      toolCall?.name === toolName &&
      !Object.prototype.hasOwnProperty.call(toolCall, "result")
    ) {
      return index;
    }
  }

  return -1;
}
