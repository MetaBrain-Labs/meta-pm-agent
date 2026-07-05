/**
 * Agent 运行汇总写入器
 *
 * 负责根据 .env 调试开关，在单个 Agent 运行结束后把本轮接收上下文、
 * 推理过程、工具调用和最终输出增量保存为 Markdown 文件。默认关闭时返回空实现，
 * 不创建目录、不序列化上下文、不影响现有 Agent 执行链路。
 *
 * Responsibilities:
 * - 读取 Agent 汇总相关环境变量
 * - 在 Agent 结束后生成按类别排列的 Markdown 诊断文件
 * - 吞掉汇总写入失败，避免测试诊断能力影响主业务流程
 *
 * Notes:
 * - 默认输出目录为仓库根目录下的 .agent-summaries/
 * - 本模块不调用模型，不对业务结果做二次总结
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMiddleware, type AnyAgentMiddleware } from "langchain";

type AgentRunSummarySection = "thinking" | "tools" | "context" | "output";

interface AgentRunSummaryConfig {
  enabledSections: Set<AgentRunSummarySection>;
  outputDir: string;
}

export interface AgentRunSummaryOptions {
  agentLabel: string;
  agentName: string;
  agentType: string;
  context?: unknown;
}

export interface AgentRunSummaryFinishOptions {
  error?: unknown;
  output?: unknown;
  status?: string;
  tokenUsage?: unknown;
}

export interface AgentRunSummaryRecorder {
  finish(options?: AgentRunSummaryFinishOptions): Promise<void>;
  recordOutput(content: string): void;
  recordRuntimeContext(context: unknown): void;
  recordSystemPrompt(content: string): void;
  recordThinking(content: string): void;
  recordToolCall(event: {
    toolArgs?: unknown;
    toolCallId?: string;
    toolName: string;
  }): void;
  recordToolResult(event: {
    toolCallId?: string;
    toolName: string;
    toolResult: unknown;
  }): void;
}

interface ToolSummaryRecord {
  at: string;
  kind: "tool-call" | "tool-result";
  toolArgs?: unknown;
  toolCallId?: string;
  toolName: string;
  toolResult?: unknown;
}

const MAX_SECTION_CHARS = 120_000;
const NOOP_RECORDER: AgentRunSummaryRecorder = {
  async finish() {},
  recordOutput() {},
  recordRuntimeContext() {},
  recordSystemPrompt() {},
  recordThinking() {},
  recordToolCall() {},
  recordToolResult() {},
};

let runCounter = 0;

/**
 * 创建单次 Agent 运行的汇总记录器。
 */
export function createAgentRunSummaryRecorder(
  options: AgentRunSummaryOptions,
): AgentRunSummaryRecorder {
  const config = getAgentRunSummaryConfig();
  if (config.enabledSections.size === 0) {
    return NOOP_RECORDER;
  }

  const startedAt = new Date();
  const runId = createRunId(startedAt, options.agentType, options.agentName);
  const thinkingChunks: string[] = [];
  const toolRecords: ToolSummaryRecord[] = [];
  const outputChunks: string[] = [];
  const runtimeContexts: unknown[] = [];
  let actualSystemPrompt = "";
  let finished = false;

  return {
    async finish(finishOptions = {}) {
      if (finished) return;
      finished = true;

      try {
        const endedAt = new Date();
        const markdown = renderAgentRunMarkdown({
          config,
          context: options.context,
          endedAt,
          finishOptions,
          outputChunks,
          runId,
          runtimeContexts,
          startedAt,
          summaryOptions: options,
          actualSystemPrompt,
          thinkingChunks,
          toolRecords,
        });
        const dateDir = startedAt.toISOString().slice(0, 10);
        const outputDir = path.join(config.outputDir, dateDir);
        await mkdir(outputDir, { recursive: true });
        await writeFile(path.join(outputDir, `${runId}.md`), markdown, "utf8");
      } catch (error) {
        // 汇总文件仅用于本地测试诊断，写入失败不应打断线上/本地 Agent 流程。
        console.warn(
          `[agent-run-summary] failed to write summary: ${getErrorMessage(
            error,
          )}`,
        );
      }
    },
    recordOutput(content) {
      if (config.enabledSections.has("output") && content) {
        outputChunks.push(content);
      }
    },
    recordRuntimeContext(context) {
      if (
        config.enabledSections.has("context") &&
        context !== undefined &&
        !isEmptyPlainObject(context)
      ) {
        runtimeContexts.push(context);
      }
    },
    recordSystemPrompt(content) {
      if (
        config.enabledSections.has("context") &&
        content.trim() &&
        !actualSystemPrompt
      ) {
        actualSystemPrompt = content;
      }
    },
    recordThinking(content) {
      if (config.enabledSections.has("thinking") && content) {
        thinkingChunks.push(content);
      }
    },
    recordToolCall(event) {
      if (!config.enabledSections.has("tools")) return;
      toolRecords.push({
        at: new Date().toISOString(),
        kind: "tool-call",
        toolArgs: event.toolArgs,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      });
    },
    recordToolResult(event) {
      if (!config.enabledSections.has("tools")) return;
      toolRecords.push({
        at: new Date().toISOString(),
        kind: "tool-result",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolResult: event.toolResult,
      });
    },
  };
}

/**
 * 创建用于捕获 DeepAgents 最终模型请求上下文的 middleware。
 */
export function createAgentRunSummaryMiddleware(
  recorder: AgentRunSummaryRecorder | undefined,
): AnyAgentMiddleware[] {
  if (!recorder || !hasAgentRunSummaryEnabledSection()) return [];

  return [
    createMiddleware({
      name: "AgentRunSummaryCaptureMiddleware",
      wrapModelCall: async (request, handler) => {
        // 在真正调用模型前记录 DeepAgents/LangChain middleware 已组装好的系统消息。
        recorder.recordSystemPrompt(
          stringifySystemMessage(
            (request as { systemMessage?: unknown; systemPrompt?: unknown })
              .systemMessage ??
              (request as { systemPrompt?: unknown }).systemPrompt,
          ),
        );
        recorder.recordRuntimeContext(
          (request as { runtime?: { context?: unknown } }).runtime?.context,
        );

        return handler(request);
      },
    }) as AnyAgentMiddleware,
  ];
}

/**
 * 判断当前进程是否开启了任一 Agent 汇总开关。
 */
function getAgentRunSummaryConfig(): AgentRunSummaryConfig {
  const enabledSections = new Set<AgentRunSummarySection>();

  if (isEnabled(process.env.AGENT_SUMMARY_THINKING_ENABLED)) {
    enabledSections.add("thinking");
  }
  if (isEnabled(process.env.AGENT_SUMMARY_TOOL_CALLS_ENABLED)) {
    enabledSections.add("tools");
  }
  if (isEnabled(process.env.AGENT_SUMMARY_CONTEXT_ENABLED)) {
    enabledSections.add("context");
  }
  if (isEnabled(process.env.AGENT_SUMMARY_OUTPUT_ENABLED)) {
    enabledSections.add("output");
  }

  return {
    enabledSections,
    outputDir: resolveSummaryOutputDir(),
  };
}

/**
 * 快速判断是否需要追加捕获 middleware，关闭时完全不改变 DeepAgent middleware 链。
 */
function hasAgentRunSummaryEnabledSection(): boolean {
  return (
    isEnabled(process.env.AGENT_SUMMARY_THINKING_ENABLED) ||
    isEnabled(process.env.AGENT_SUMMARY_TOOL_CALLS_ENABLED) ||
    isEnabled(process.env.AGENT_SUMMARY_CONTEXT_ENABLED) ||
    isEnabled(process.env.AGENT_SUMMARY_OUTPUT_ENABLED)
  );
}

/**
 * 解析布尔环境变量，兼容常见的 true/1/yes/on 写法。
 */
function isEnabled(value: string | undefined): boolean {
  return /^(true|1|yes|on)$/i.test(value?.trim() ?? "");
}

/**
 * 解析 Markdown 汇总输出目录，默认落在仓库根目录。
 */
function resolveSummaryOutputDir(): string {
  const configuredDir =
    process.env.AGENT_SUMMARY_OUTPUT_DIR?.trim() || ".agent-summaries";
  if (path.isAbsolute(configuredDir)) {
    return configuredDir;
  }

  return path.resolve(getRepositoryRoot(), configuredDir);
}

/**
 * 从当前模块位置反推 monorepo 根目录，兼容 src 和 dist 两种运行位置。
 */
function getRepositoryRoot(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../..",
  );
}

/**
 * 生成带时间和进程信息的文件名，确保并发 Agent 不会互相覆盖。
 */
function createRunId(startedAt: Date, agentType: string, agentName: string) {
  runCounter += 1;
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const sequence = String(runCounter).padStart(4, "0");
  return `${timestamp}-${process.pid}-${sequence}-${sanitizeFilePart(
    agentType,
  )}-${sanitizeFilePart(agentName)}`;
}

/**
 * 清理文件名片段中的非法字符。
 */
function sanitizeFilePart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "agent"
  );
}

/**
 * 渲染单次 Agent 运行的 Markdown 汇总。
 */
function renderAgentRunMarkdown({
  actualSystemPrompt,
  config,
  context,
  endedAt,
  finishOptions,
  outputChunks,
  runId,
  runtimeContexts,
  startedAt,
  summaryOptions,
  thinkingChunks,
  toolRecords,
}: {
  actualSystemPrompt: string;
  config: AgentRunSummaryConfig;
  context: unknown;
  endedAt: Date;
  finishOptions: AgentRunSummaryFinishOptions;
  outputChunks: string[];
  runId: string;
  runtimeContexts: unknown[];
  startedAt: Date;
  summaryOptions: AgentRunSummaryOptions;
  thinkingChunks: string[];
  toolRecords: ToolSummaryRecord[];
}): string {
  const lines = [
    "# Agent Run Summary",
    "",
    `- Run ID: ${runId}`,
    `- Agent label: ${summaryOptions.agentLabel}`,
    `- Agent type: \`${summaryOptions.agentType}\``,
    `- Agent name: \`${summaryOptions.agentName}\``,
    `- Status: ${finishOptions.status ?? "completed"}`,
    `- Started at: ${startedAt.toISOString()}`,
    `- Ended at: ${endedAt.toISOString()}`,
    `- Duration: ${endedAt.getTime() - startedAt.getTime()} ms`,
  ];

  if (finishOptions.tokenUsage) {
    lines.push(
      "",
      "## Token Usage",
      "",
      formatJsonBlock(finishOptions.tokenUsage),
    );
  }
  if (finishOptions.error) {
    lines.push(
      "",
      "## Error",
      "",
      formatTextBlock(getErrorMessage(finishOptions.error)),
    );
  }

  // 按用户指定的四类汇总顺序输出，只渲染已开启的类别。
  if (config.enabledSections.has("thinking")) {
    lines.push("", "## 1. Agent 思考过程汇总", "");
    lines.push(renderThinkingSection(thinkingChunks));
  }
  if (config.enabledSections.has("tools")) {
    lines.push("", "## 2. Agent 工具调用汇总", "");
    lines.push(renderToolSection(toolRecords));
  }
  if (config.enabledSections.has("context")) {
    lines.push("", "## 3. Agent 接收上下文汇总", "");
    lines.push(renderContextSection(context, actualSystemPrompt, runtimeContexts));
  }
  if (config.enabledSections.has("output")) {
    lines.push("", "## 4. Agent 输出汇总", "");
    lines.push(renderOutputSection(outputChunks, finishOptions.output));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * 渲染完整推理内容，避免把流式切片拆成多段影响排查阅读。
 */
function renderThinkingSection(chunks: string[]): string {
  if (chunks.length === 0) return "_无记录_";

  return formatTextBlock(chunks.join(""));
}

/**
 * 渲染 Agent 接收上下文，并把 systemPrompt/payload 从 JSON 元数据中拆出来。
 */
function renderContextSection(
  context: unknown,
  actualSystemPrompt: string,
  runtimeContexts: unknown[],
): string {
  const record = isPlainRecord(context) ? context : null;
  if (!record) return formatJsonBlock(context ?? null);

  const providedSystemPrompt =
    typeof record.systemPrompt === "string" ? record.systemPrompt : null;
  const systemPrompt = actualSystemPrompt || providedSystemPrompt;
  const hasPayload = Object.prototype.hasOwnProperty.call(record, "payload");
  const runtimeContext = collectRuntimeContexts(record.runtimeContext, runtimeContexts);
  const metadata = omitContextSpecialFields(record);
  const sections: string[] = [];

  if (systemPrompt !== null) {
    sections.push(
      "### Actual System Prompt",
      "",
      systemPrompt.trim() ? limitSectionText(systemPrompt) : "_空_",
    );
  }

  if (
    providedSystemPrompt &&
    systemPrompt &&
    providedSystemPrompt.trim() !== systemPrompt.trim()
  ) {
    sections.push(
      "### Custom System Prompt Provided To DeepAgents",
      "",
      limitSectionText(providedSystemPrompt),
    );
  }

  if (hasPayload) {
    sections.push("### Payload", "", formatJsonBlock(record.payload));
  }

  if (runtimeContext.length > 0) {
    sections.push("### Runtime Context", "", formatJsonBlock(runtimeContext));
  }

  if (Object.keys(metadata).length > 0) {
    sections.push("### Runtime Metadata", "", formatJsonBlock(metadata));
  }

  return sections.length > 0 ? sections.join("\n\n") : formatJsonBlock(record);
}

/**
 * 判断未知值是否为普通记录，避免把数组或 Date 当成上下文字段容器。
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * 移除已经单独展示的上下文字段，剩余内容作为运行元数据展示。
 */
function omitContextSpecialFields(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      key === "systemPrompt" ||
      key === "payload" ||
      key === "runtimeContext"
    ) {
      continue;
    }
    metadata[key] = value;
  }

  return metadata;
}

/**
 * 合并手工传入和 middleware 捕获到的运行时上下文。
 */
function collectRuntimeContexts(
  providedContext: unknown,
  capturedContexts: unknown[],
): unknown[] {
  const contexts: unknown[] = [];
  if (providedContext !== undefined && !isEmptyPlainObject(providedContext)) {
    contexts.push(providedContext);
  }
  for (const context of capturedContexts) {
    if (!isEmptyPlainObject(context)) {
      contexts.push(context);
    }
  }

  return contexts;
}

/**
 * 判断对象是否为空普通对象，用于过滤未配置的 runtime.context。
 */
function isEmptyPlainObject(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

/**
 * 将 LangChain SystemMessage 或字符串系统提示转换为 Markdown 文本。
 */
function stringifySystemMessage(systemMessage: unknown): string {
  if (!systemMessage) return "";
  if (typeof systemMessage === "string") return systemMessage;

  const message = systemMessage as {
    content?: unknown;
    contentBlocks?: unknown;
  };

  if (Array.isArray(message.contentBlocks)) {
    return message.contentBlocks.map(stringifyMessageContentBlock).join("\n\n");
  }

  return stringifyMessageContentBlock(message.content ?? systemMessage);
}

/**
 * 将消息内容块转换为可读文本，优先保留 Markdown 原文。
 */
function stringifyMessageContentBlock(block: unknown): string {
  if (typeof block === "string") return block;
  if (Array.isArray(block)) {
    return block.map(stringifyMessageContentBlock).join("\n\n");
  }
  if (isPlainRecord(block)) {
    if (typeof block.text === "string") return block.text;
    if (typeof block.content === "string") return block.content;
  }

  return safeStringify(block);
}

/**
 * 渲染工具调用和工具结果，保留 Agent 流中的出现顺序。
 */
function renderToolSection(records: ToolSummaryRecord[]): string {
  if (records.length === 0) return "_无记录_";

  return records
    .map((record, index) => {
      const title =
        record.kind === "tool-call"
          ? `### ${index + 1}. Tool Call: \`${record.toolName}\``
          : `### ${index + 1}. Tool Result: \`${record.toolName}\``;
      const payload =
        record.kind === "tool-call" ? record.toolArgs : record.toolResult;

      return [
        title,
        "",
        `- Time: ${record.at}`,
        `- Tool call ID: ${record.toolCallId ?? "n/a"}`,
        "",
        formatJsonBlock(payload ?? null),
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * 渲染模型文本输出和最终返回值。
 */
function renderOutputSection(chunks: string[], finalOutput: unknown): string {
  const streamedOutput = chunks.join("");
  const sections: string[] = [];

  if (streamedOutput.trim()) {
    sections.push("### Streamed Output", "", formatTextBlock(streamedOutput));
  }
  if (finalOutput !== undefined) {
    sections.push("### Final Output", "", formatUnknownBlock(finalOutput));
  }

  return sections.length > 0 ? sections.join("\n") : "_无记录_";
}

/**
 * 根据值类型选择 Markdown 代码块格式。
 */
function formatUnknownBlock(value: unknown): string {
  return typeof value === "string"
    ? formatTextBlock(value)
    : formatJsonBlock(value);
}

/**
 * 渲染 JSON 代码块并处理循环引用。
 */
function formatJsonBlock(value: unknown): string {
  return ["````json", limitSectionText(safeStringify(value)), "````"].join(
    "\n",
  );
}

/**
 * 渲染普通文本代码块，避免内容中的 Markdown 破坏结构。
 */
function formatTextBlock(value: string): string {
  return ["````text", limitSectionText(value), "````"].join("\n");
}

/**
 * 对过长片段做本地截断，避免测试诊断文件无限膨胀。
 */
function limitSectionText(value: string): string {
  if (value.length <= MAX_SECTION_CHARS) return value;

  return `${value.slice(0, MAX_SECTION_CHARS).trimEnd()}\n\n[truncated: ${
    value.length - MAX_SECTION_CHARS
  } chars omitted]`;
}

/**
 * 将任意值转换为可读 JSON。
 */
function safeStringify(value: unknown): string {
  const ancestors: object[] = [];
  const json = JSON.stringify(
    value,
    function replaceSharedValue(this: unknown, _key, nestedValue) {
      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }
      if (typeof nestedValue === "object" && nestedValue !== null) {
        while (
          ancestors.length > 0 &&
          ancestors[ancestors.length - 1] !== this
        ) {
          ancestors.pop();
        }
        if (ancestors.includes(nestedValue)) return "[Circular]";
        ancestors.push(nestedValue);
      }
      return nestedValue;
    },
    2,
  );

  return json ?? String(value);
}

/**
 * 提取异常消息，供 Markdown 错误区和写入失败日志使用。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
