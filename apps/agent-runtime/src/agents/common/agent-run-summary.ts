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
import {
  AIMessage,
  ToolMessage,
  createMiddleware,
  type AnyAgentMiddleware,
  type BaseMessage,
} from "langchain";

type AgentRunSummarySection = "thinking" | "tools" | "context" | "output" | "subagents";

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

/**
 * 单次 SubAgent 调用记录，保持主 Agent 能追溯子代理的委派输入和最终输出。
 */
interface SubagentInvocationRecord {
  toolCallId?: string;
  subagentType: string;
  description: string;
  input: unknown;
  output: unknown;
  thinkingChunks: string[];
  startedAt: string;
  completedAt?: string;
}

export interface SubagentTaskCallRecord {
  toolCallId?: string;
  subagentType: string;
  description: string;
  input: Record<string, unknown>;
}

export interface SubagentTaskResultRecord {
  toolCallId?: string;
  subagentType: string;
  output: unknown;
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
  /**
   * 记录主 Agent 通过 task 工具调用的 SubAgent 信息。
   * 调用时机：检测到 task 工具调用时记录 subagent_type / description 等元数据。
   */
  recordSubagentCall(event: {
    toolCallId?: string;
    subagentType: string;
    description: string;
    input: unknown;
  }): void;
  recordSubagentThinking(event: {
    toolCallId?: string;
    subagentType?: string;
    content: string;
  }): boolean;
  /**
   * 记录 SubAgent 返回给主 Agent 的最终输出。
   * 调用时机：task 工具结果返回时记录输出内容。
   */
  recordSubagentResult(event: {
    toolCallId?: string;
    subagentType: string;
    output: unknown;
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
  recordSubagentCall() {},
  recordSubagentThinking() {
    return false;
  },
  recordSubagentResult() {},
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
  /** SubAgent 调用记录，按 task 工具调用顺序排列。 */
  const subagentInvocations: SubagentInvocationRecord[] = [];
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
          subagentInvocations,
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
    recordSubagentCall(event) {
      if (!config.enabledSections.has("subagents")) return;
      subagentInvocations.push({
        toolCallId: event.toolCallId,
        subagentType: event.subagentType,
        description: event.description,
        input: event.input,
        output: undefined,
        thinkingChunks: [],
        startedAt: new Date().toISOString(),
        completedAt: undefined,
      });
    },
    recordSubagentThinking(event) {
      if (!config.enabledSections.has("subagents") || !event.content) {
        return false;
      }

      const invocation = findSubagentInvocation(subagentInvocations, {
        toolCallId: event.toolCallId,
        subagentType: event.subagentType,
        preferOpen: true,
      });
      if (!invocation) return false;

      invocation.thinkingChunks.push(event.content);
      return true;
    },
    recordSubagentResult(event) {
      if (!config.enabledSections.has("subagents")) return;
      const invocation = findSubagentInvocation(subagentInvocations, {
        toolCallId: event.toolCallId,
        subagentType: event.subagentType,
        preferOpen: true,
      });
      if (!invocation) return;

      invocation.output = event.output;
      invocation.completedAt = new Date().toISOString();
      return;
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
/**
 * 从 AIMessage 中提取 DeepAgents task 工具调用，兼容 LangChain 规范化字段和 provider 原始字段。
 */
export function extractSubagentTaskCalls(
  message: BaseMessage,
): SubagentTaskCallRecord[] {
  if (!AIMessage.isInstance(message)) return [];

  const calls = new Map<string, SubagentTaskCallRecord>();

  for (const toolCall of message.tool_calls ?? []) {
    if (toolCall.name !== "task") continue;
    const input = normalizeToolCallArgs(toolCall.args);
    const call = createSubagentTaskCallRecord(toolCall.id, input);
    calls.set(toolCall.id ?? `normalized-${calls.size}`, call);
  }

  for (const rawToolCall of extractRawToolCalls(message)) {
    const rawRecord = isPlainRecord(rawToolCall) ? rawToolCall : {};
    const functionRecord = isPlainRecord(rawRecord.function)
      ? rawRecord.function
      : {};
    const name =
      readString(functionRecord, "name") ??
      readString(rawRecord, "name") ??
      "";
    if (name !== "task") continue;

    const toolCallId = readString(rawRecord, "id");
    const input = normalizeToolCallArgs(
      functionRecord.arguments ?? rawRecord.args ?? rawRecord.arguments,
    );
    const key = toolCallId ?? `raw-${calls.size}`;
    const existing = calls.get(key);
    const mergedInput =
      existing && Object.keys(existing.input).length > 0
        ? { ...input, ...existing.input }
        : input;

    calls.set(key, createSubagentTaskCallRecord(toolCallId, mergedInput));
  }

  return Array.from(calls.values());
}

/**
 * 从 ToolMessage 中提取 DeepAgents task 返回结果，并根据已知 task 调用映射识别 SubAgent。
 */
export function extractSubagentTaskResult(
  message: BaseMessage,
  knownTaskCalls: ReadonlyMap<string, string>,
): SubagentTaskResultRecord | null {
  if (!ToolMessage.isInstance(message)) return null;

  const toolCallId = getToolMessageCallId(message, knownTaskCalls);
  const subagentType =
    (toolCallId ? knownTaskCalls.get(toolCallId) : undefined) ?? "unknown";
  const isTaskResult = message.name === "task" || subagentType !== "unknown";
  if (!isTaskResult) return null;

  return {
    toolCallId,
    subagentType,
    output: message.content,
  };
}

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
  if (isEnabled(process.env.AGENT_SUMMARY_SUBAGENTS_ENABLED)) {
    enabledSections.add("subagents");
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
    isEnabled(process.env.AGENT_SUMMARY_OUTPUT_ENABLED) ||
    isEnabled(process.env.AGENT_SUMMARY_SUBAGENTS_ENABLED)
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
  subagentInvocations,
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
  subagentInvocations: SubagentInvocationRecord[];
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
  if (config.enabledSections.has("subagents")) {
    lines.push("", "## 5. SubAgent 执行汇总", "");
    lines.push(renderSubagentSection(subagentInvocations));
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
 * 渲染 SubAgent 调用和返回汇总，展示主 Agent 通过 task 工具委派子代理的
 * 输入信息、输出结果和执行时间。
 */
function renderSubagentSection(
  invocations: SubagentInvocationRecord[],
): string {
  if (invocations.length === 0) return "_无 SubAgent 调用记录_";

  return invocations
    .map((invocation, index) => {
      const parts: string[] = [
        `### ${index + 1}. SubAgent: \`${invocation.subagentType}\``,
        "",
        `- 调用时间: ${invocation.startedAt}`,
        `- 完成时间: ${invocation.completedAt ?? "未完成"}`,
        `- 描述: ${invocation.description}`,
      ];

      if (invocation.input !== undefined) {
        parts.push(
          "",
          "#### 输入",
          "",
          formatUnknownBlock(invocation.input),
        );
      }

      if (invocation.thinkingChunks.length > 0) {
        parts.push(
          "",
          "#### 思考过程",
          "",
          formatTextBlock(invocation.thinkingChunks.join("")),
        );
      }

      if (invocation.output !== undefined) {
        parts.push(
          "",
          "#### 返回给主 Agent 的结果",
          "",
          formatUnknownBlock(invocation.output),
        );
      }

      return parts.join("\n");
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
/**
 * 匹配 SubAgent 调用记录，优先使用 tool_call_id，兼容缺失 id 时的最近未完成调用。
 */
function findSubagentInvocation(
  invocations: SubagentInvocationRecord[],
  options: {
    toolCallId?: string;
    subagentType?: string;
    preferOpen?: boolean;
  },
): SubagentInvocationRecord | undefined {
  if (options.toolCallId) {
    const byToolCall = invocations.find(
      (invocation) => invocation.toolCallId === options.toolCallId,
    );
    if (byToolCall) return byToolCall;
  }

  for (let index = invocations.length - 1; index >= 0; index -= 1) {
    const invocation = invocations[index];
    if (options.preferOpen && invocation.completedAt) continue;
    if (
      options.subagentType &&
      options.subagentType !== "unknown" &&
      invocation.subagentType !== options.subagentType
    ) {
      continue;
    }
    return invocation;
  }

  return invocations[invocations.length - 1];
}

/**
 * 构造标准化 SubAgent task 调用记录。
 */
function createSubagentTaskCallRecord(
  toolCallId: string | undefined,
  input: Record<string, unknown>,
): SubagentTaskCallRecord {
  const subagentType =
    readString(input, "subagent_type") ??
    readString(input, "subagentType") ??
    readString(input, "subagent_name") ??
    readString(input, "subagentName") ??
    readString(input, "agent") ??
    "unknown";
  const description = readString(input, "description") ?? "";

  return {
    toolCallId,
    subagentType,
    description,
    input,
  };
}

/**
 * 归一化工具调用参数，兼容对象、JSON 字符串和空参数。
 */
function normalizeToolCallArgs(args: unknown): Record<string, unknown> {
  if (isPlainRecord(args)) return args;
  if (typeof args !== "string") return {};

  try {
    const parsed = JSON.parse(args);
    return isPlainRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 读取 provider 原始 tool_calls，补足 LangChain 规范化字段丢失的 task 参数。
 */
function extractRawToolCalls(message: BaseMessage): unknown[] {
  const record = message as unknown as Record<string, unknown>;
  const additionalKwargs = isPlainRecord(record.additional_kwargs)
    ? record.additional_kwargs
    : {};
  const responseMetadata = isPlainRecord(record.response_metadata)
    ? record.response_metadata
    : {};
  const rawToolCalls = [
    additionalKwargs.tool_calls,
    additionalKwargs.toolCalls,
    responseMetadata.tool_calls,
    responseMetadata.toolCalls,
  ];

  return rawToolCalls.flatMap((value) => (Array.isArray(value) ? value : []));
}

/**
 * 提取 ToolMessage 对应的 tool_call_id，兼容不同 LangChain 字段命名。
 */
function getToolMessageCallId(
  message: ToolMessage,
  knownTaskCalls: ReadonlyMap<string, string>,
): string | undefined {
  const record = message as unknown as Record<string, unknown>;
  const additionalKwargs = isPlainRecord(record.additional_kwargs)
    ? record.additional_kwargs
    : {};
  const responseMetadata = isPlainRecord(record.response_metadata)
    ? record.response_metadata
    : {};
  const candidates = [
    record.tool_call_id,
    record.toolCallId,
    record.id,
    additionalKwargs.tool_call_id,
    additionalKwargs.toolCallId,
    responseMetadata.tool_call_id,
    responseMetadata.toolCallId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && knownTaskCalls.has(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * 读取字符串字段。
 */
function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === "string" && item.length > 0 ? item : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
