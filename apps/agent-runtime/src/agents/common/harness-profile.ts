/**
 * DeepAgents Harness Profile 注册
 *
 * 在全局注册 HarnessProfile，排除 DeepAgents 默认注入的文件系统工具，
 * 确保这些工具在所有 Agent 的模型请求中不可见。与业务侧
 * DeepAgentToolAllowlistMiddleware（allowlist 模式）互补，形成双重防护。
 *
 * Responsibilities:
 * - 通过 registerHarnessProfile 全局排除文件枚举、变更和执行工具
 * - 保留 read_file，由业务 Agent allowlist 决定是否读取隔离的 StateBackend 文件
 * - 在应用启动早期执行，优先于所有 Agent 实例创建
 *
 * Notes:
 * - 本项目使用 ChatOpenAI 实例，DeepAgents 将其映射为 provider "openai"
 * - 如果未来切换为其他模型 provider（如 ChatAnthropic），需同步注册对应 provider 的 profile
 */

import { registerHarnessProfile } from "deepagents";

/** DeepAgents 默认注入但本项目不允许模型使用的文件系统工具名。 */
const EXCLUDED_FILESYSTEM_TOOLS = [
  "ls",
  "write_file",
  "edit_file",
  "delete",
  "glob",
  "grep",
  "execute",
] as const;

registerHarnessProfile("openai", {
  excludedTools: [...EXCLUDED_FILESYSTEM_TOOLS],
});
