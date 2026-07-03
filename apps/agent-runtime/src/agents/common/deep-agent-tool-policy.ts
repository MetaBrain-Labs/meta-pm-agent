/**
 * DeepAgents 工具可见性策略
 *
 * DeepAgents 会默认注入 write_todos、task 和文件系统工具。该模块在最终模型
 * 请求前按业务 Agent 的显式授权清单过滤工具，避免内置工具绕过 runtime tool-access
 * 策略进入模型可见工具集。
 *
 * Responsibilities:
 * - 创建 DeepAgent 工具 allowlist middleware
 * - 过滤 DeepAgents 内置工具和未授权业务工具
 * - 暴露纯函数供单元测试覆盖工具过滤规则
 *
 * Notes:
 * - Document Agent 是例外，它会显式允许 write_todos/task；其他 Agent 默认只保留调用方传入的业务工具。
 */

import {
  ToolMessage,
  createMiddleware,
  type AnyAgentMiddleware,
} from "langchain";

interface NamedToolLike {
  name?: unknown;
}

export interface DeepAgentToolAllowlistOptions {
  /** 当前 DeepAgent 实例名称，用于标识 middleware 来源。 */
  agentName: string;
  /** 允许进入最终模型请求的工具名。 */
  allowedToolNames: Iterable<string>;
}

/**
 * 创建按工具名白名单过滤最终模型请求的 middleware。
 */
export function createDeepAgentToolAllowlistMiddleware({
  agentName,
  allowedToolNames,
}: DeepAgentToolAllowlistOptions): AnyAgentMiddleware {
  const allowedToolNameSet = new Set(allowedToolNames);

  return createMiddleware({
    name: `DeepAgentToolAllowlistMiddleware:${agentName}`,
    wrapModelCall: async (request, handler) => {
      // 在所有 DeepAgents 内置 middleware 注入工具后，再按业务授权收口。
      return handler({
        ...request,
        tools: filterToolsByAllowedNames(request.tools, allowedToolNameSet),
      });
    },
    wrapToolCall: async (request, handler) => {
      const toolName = getToolName(request.tool ?? request.toolCall);
      if (toolName && allowedToolNameSet.has(toolName)) {
        return handler(request);
      }

      // 防御异常模型输出：即使生成了未授权工具调用，也不能进入真实工具实现。
      return new ToolMessage({
        content: `Tool "${toolName || "unknown"}" is not available to this agent.`,
        name: toolName || "unknown",
        tool_call_id: request.toolCall.id ?? "",
        status: "error",
      });
    },
  }) as AnyAgentMiddleware;
}

/**
 * 根据允许的工具名过滤工具数组；没有 name 的工具视为未授权。
 */
export function filterToolsByAllowedNames<T extends NamedToolLike>(
  tools: readonly T[] = [],
  allowedToolNames: ReadonlySet<string>,
): T[] {
  return tools.filter((toolItem) => {
    const toolName = getToolName(toolItem);
    return Boolean(toolName && allowedToolNames.has(toolName));
  });
}

/**
 * 从不同 LangChain/DeepAgents 工具对象形状中读取稳定工具名。
 */
export function getToolName(tool: NamedToolLike): string {
  return typeof tool.name === "string" ? tool.name : "";
}
