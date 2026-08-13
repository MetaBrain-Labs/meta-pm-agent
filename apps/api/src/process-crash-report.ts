/**
 * Node.js 进程崩溃与异常工作流中止报告
 *
 * 在不吞掉致命异常、不改变 Node.js 默认退出语义的前提下，将未捕获异常写入
 * `.agent-summaries/errors`，为本地和部署环境保留可追踪的进程级诊断证据。
 *
 * Responsibilities:
 * - 注册 uncaughtExceptionMonitor 监听器
 * - 同步写入带时间戳、PID 和序号的 Markdown 崩溃报告
 * - 为非手动的连接中止写入单独分类的工作流报告
 * - 限制报告内容，不记录环境变量、请求正文或凭据
 *
 * Notes:
 * - 默认开启；仅当 PROCESS_CRASH_REPORT_ENABLED 显式为 false/0/no/off 时关闭
 * - monitor 监听器不会阻止 Node.js 按默认行为退出
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let installed = false;
let reportSequence = 0;
const processStartedAt = new Date();

/** 已捕获但非用户主动触发的工作流中止诊断上下文。 */
export interface AbnormalWorkflowAbortReportInput {
  activeAgentTypes: string[];
  conversationId?: string;
  error: unknown;
  origin: "client_disconnect" | "unknown";
  requestFormId?: string;
}

/** 安装一次进程崩溃监听器，并保持 Node.js 原有致命异常退出行为。 */
export function installProcessCrashReporter(): void {
  if (installed || !isCrashReportingEnabled()) return;
  installed = true;
  process.on("uncaughtExceptionMonitor", writeProcessCrashReport);
}

/**
 * 同步写入一次进程级错误报告。
 *
 * 同步 I/O 是刻意选择：触发该方法时进程即将退出，异步写入没有完成保证。
 */
export function writeProcessCrashReport(
  error: unknown,
  origin: NodeJS.UncaughtExceptionOrigin = "uncaughtException",
): string | null {
  if (!isCrashReportingEnabled()) return null;

  try {
    const occurredAt = new Date();
    const outputDir = resolveCrashReportOutputDir();
    const filePath = path.join(outputDir, createCrashReportFileName(occurredAt));
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      filePath,
      renderCrashReport(error, origin, occurredAt),
      "utf8",
    );
    return filePath;
  } catch (reportError) {
    // 崩溃报告失败时只能同步写 stderr；不得再次抛错覆盖原始致命异常。
    process.stderr.write(
      `[process-crash-report] failed to write report: ${formatError(reportError)}\n`,
    );
    return null;
  }
}

/**
 * 写入非预期工作流中止报告。
 *
 * 该报告不宣称 Node.js 已崩溃；它用于覆盖客户端连接异常关闭但异常已被请求边界捕获的路径，
 * 从而避免 `.agent-summaries/errors` 只在未捕获致命异常时才有证据。
 */
export function writeAbnormalWorkflowAbortReport(
  input: AbnormalWorkflowAbortReportInput,
): string | null {
  if (!isCrashReportingEnabled()) return null;

  try {
    const occurredAt = new Date();
    const outputDir = resolveCrashReportOutputDir();
    const filePath = path.join(
      outputDir,
      createReportFileName(occurredAt, "workflow-abort"),
    );
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      filePath,
      renderAbnormalWorkflowAbortReport(input, occurredAt),
      "utf8",
    );
    return filePath;
  } catch (reportError) {
    process.stderr.write(
      `[workflow-abort-report] failed to write report: ${formatError(reportError)}\n`,
    );
    return null;
  }
}

/** 判断崩溃报告是否开启；未配置时默认开启。 */
export function isCrashReportingEnabled(): boolean {
  const configured = process.env.PROCESS_CRASH_REPORT_ENABLED?.trim();
  if (!configured) return true;
  return !/^(false|0|no|off)$/i.test(configured);
}

/** 解析仓库根目录下固定的崩溃报告目录。 */
export function resolveCrashReportOutputDir(): string {
  return path.resolve(getRepositoryRoot(), ".agent-summaries", "errors");
}

/** 生成不含冒号且可按时间排序的唯一报告文件名。 */
function createCrashReportFileName(occurredAt: Date): string {
  return createReportFileName(occurredAt, "process-crash");
}

/** 为错误目录中的不同报告类型生成统一的时间戳文件名。 */
function createReportFileName(
  occurredAt: Date,
  reportType: "process-crash" | "workflow-abort",
): string {
  reportSequence += 1;
  const timestamp = occurredAt.toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${process.pid}-${String(reportSequence).padStart(4, "0")}-${reportType}.md`;
}

/** 渲染不包含环境变量和业务负载的紧凑 Markdown 报告。 */
function renderCrashReport(
  error: unknown,
  origin: NodeJS.UncaughtExceptionOrigin,
  occurredAt: Date,
): string {
  const memory = process.memoryUsage();
  return [
    "# Node.js Process Crash Report",
    "",
    `- Occurred at: ${occurredAt.toISOString()}`,
    `- Process started at: ${processStartedAt.toISOString()}`,
    `- Uptime: ${process.uptime().toFixed(3)} seconds`,
    `- PID: ${process.pid}`,
    `- Origin: \`${origin}\``,
    `- Node.js: ${process.version}`,
    `- Platform: ${process.platform} ${process.arch}`,
    `- RSS: ${memory.rss} bytes`,
    `- Heap used: ${memory.heapUsed} bytes`,
    `- Heap total: ${memory.heapTotal} bytes`,
    `- External memory: ${memory.external} bytes`,
    "",
    "## Fatal Error",
    "",
    "````text",
    limitText(formatError(error), 120_000),
    "````",
    "",
    "## Notes",
    "",
    "- This report was written by `uncaughtExceptionMonitor` before Node.js applied its default fatal-exception behavior.",
    "- Environment variables, API keys, request bodies, and Agent payloads are intentionally omitted.",
    "",
  ].join("\n");
}

/** 渲染不含消息正文、模型载荷和环境变量的工作流中止诊断。 */
function renderAbnormalWorkflowAbortReport(
  input: AbnormalWorkflowAbortReportInput,
  occurredAt: Date,
): string {
  return [
    "# Abnormal Workflow Abort Report",
    "",
    `- Occurred at: ${occurredAt.toISOString()}`,
    `- PID: ${process.pid}`,
    `- Process still running when written: yes`,
    `- Abort origin: \`${input.origin}\``,
    `- Conversation ID: ${limitText(input.conversationId ?? "unknown", 200)}`,
    `- Request Form ID: ${limitText(input.requestFormId ?? "unknown", 200)}`,
    `- Active Agent types: ${input.activeAgentTypes.length > 0 ? input.activeAgentTypes.join(", ") : "unknown"}`,
    "",
    "## Error",
    "",
    "````text",
    limitText(formatError(input.error), 120_000),
    "````",
    "",
    "## Classification",
    "",
    "- This request-level abort was caught by the API boundary; it is not proof of a Node.js process crash.",
    "- Manual stop and page-unload aborts do not generate this report.",
    "- Environment variables, API keys, request bodies, messages, and Agent payloads are intentionally omitted.",
    "",
  ].join("\n");
}

/** 将未知错误转换为优先保留堆栈的诊断文本。 */
function formatError(error: unknown, seen = new Set<unknown>()): string {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    if (seen.has(error)) return "[circular error cause]";
    seen.add(error);
  }
  if (error instanceof Error) {
    const details = error.stack || `${error.name}: ${error.message}`;
    return error.cause === undefined
      ? details
      : `${details}\n\nCause:\n${formatError(error.cause, seen)}`;
  }
  try {
    if (typeof error === "string") return error;
    return JSON.stringify(error, null, 2) ?? String(error);
  } catch {
    return String(error);
  }
}

/** 限制异常链文本，避免极端错误对象耗尽崩溃阶段的内存。 */
function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[crash report truncated]`;
}

/** 从 src/dist 模块位置反推 monorepo 根目录。 */
function getRepositoryRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}
