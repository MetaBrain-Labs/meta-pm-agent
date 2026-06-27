/**
 * 工具调用卡片
 *
 * 以折叠卡片展示用户可见工具调用，支持联网搜索和知识图谱工具的摘要化结果。
 * 实时流和历史消息共用同一完成态判断，避免缺少工具结果时一直显示加载。
 *
 * Responsibilities:
 * - 汇总工具调用完成/失败数量
 * - 渲染联网搜索结果和知识图谱工具摘要
 * - 对未知工具输出做安全兜底展示
 */

import { Collapse, Empty, List, Tag, Typography } from "antd";
import {
  CaretRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LinkOutlined,
  LoadingOutlined,
  SearchOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { Message } from "../types";

type ToolCall = NonNullable<Message["toolCalls"]>[number];

interface Props {
  toolCalls: ToolCall[];
}

interface WebSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
}

interface WebSearchPayload {
  query?: string;
  source?: string;
  results?: WebSearchResult[];
  warnings?: string[];
  error?: string;
}

const TOOL_NAME_LABELS: Record<string, string> = {
  write_todos: "生成任务",
  ask_user: "询问用户",
  search_knowledge: "搜索知识库",
  read_file: "读取文件",
  write_file: "写入文件",
  execute_command: "执行命令",
  generate_artifact: "生成文档",
  web_search: "联网搜索",
  web_fetch: "抓取页面",
  kg_file_create: "知识图谱文件",
  kg_file_read: "知识图谱文件",
  kg_file_insert: "知识图谱文件",
  kg_file_update: "知识图谱文件",
  kg_file_delete_content: "知识图谱文件",
  kg_file_add_summary: "知识图谱文件",
  kg_file_add_nodes: "知识图谱文件",
  kg_file_add_relations: "知识图谱文件",
  kg_file_add_decisions: "知识图谱文件",
  kg_file_add_risks: "知识图谱文件",
  kg_file_add_open_questions: "知识图谱文件",
};

const KG_TOOL_TYPE_LABELS: Record<string, string> = {
  kg_file_create: "新增",
  kg_file_read: "查询",
  kg_file_insert: "插入",
  kg_file_update: "更新",
  kg_file_delete_content: "删除",
  kg_file_add_summary: "摘要",
  kg_file_add_nodes: "节点",
  kg_file_add_relations: "关系",
  kg_file_add_decisions: "决策",
  kg_file_add_risks: "风险",
  kg_file_add_open_questions: "问题",
};

/**
 * 以折叠卡片展示 Agent 工具调用，避免工具结果挤占普通回复正文。
 */
export function ToolCallsCard({ toolCalls }: Props) {
  if (toolCalls.length === 0) return null;

  const completedCount = toolCalls.filter(
    (toolCall) => isToolCallComplete(toolCall),
  ).length;
  const failedCount = toolCalls.filter((toolCall) => {
    const payload = parseWebSearchPayload(toolCall.result);
    return Boolean(payload?.error);
  }).length;
  const allSearch = toolCalls.every((toolCall) => toolCall.name === "web_search");

  return (
    <Collapse
      className="mb-2"
      defaultActiveKey={[]}
      expandIcon={({ isActive }) => (
        <CaretRightOutlined rotate={isActive ? 90 : 0} />
      )}
      items={[
        {
          key: "tools",
          label: (
            <div className="flex items-center gap-2">
              {allSearch ? (
                <SearchOutlined style={{ color: "var(--primary)" }} />
              ) : (
                <ToolOutlined style={{ color: "var(--primary)" }} />
              )}
              <span className="text-[14px] font-extrabold text-[var(--ink)]">
                {allSearch ? "联网搜索" : "工具调用"}
              </span>
              <Tag
                style={{
                  marginInlineEnd: 0,
                  border: "none",
                  borderRadius: 6,
                  background: "var(--primary-soft)",
                  color: "var(--primary)",
                  fontFamily: "var(--sans)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {completedCount}/{toolCalls.length}
              </Tag>
              {failedCount > 0 && (
                <Tag
                  style={{
                    marginInlineEnd: 0,
                    border: "none",
                    borderRadius: 6,
                    background: "#fff1f2",
                    color: "var(--danger)",
                    fontFamily: "var(--sans)",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {failedCount} 失败
                </Tag>
              )}
            </div>
          ),
          children: (
            <List
              size="small"
              dataSource={toolCalls}
              renderItem={(toolCall, index) => (
                <ToolCallItem key={index} toolCall={toolCall} />
              )}
            />
          ),
        },
      ]}
    />
  );
}

/**
 * 展示单个工具调用，根据工具类型选择更具体的结果视图。
 */
function ToolCallItem({ toolCall }: { toolCall: ToolCall }) {
  const completed = isToolCallComplete(toolCall);
  const searchPayload =
    toolCall.name === "web_search"
      ? parseWebSearchPayload(toolCall.result)
      : null;
  const kgFilePayload = isKnowledgeGraphFileTool(toolCall.name)
    ? parseKnowledgeGraphToolPayload(toolCall.result)
    : null;

  return (
    <List.Item
      style={{
        alignItems: "flex-start",
        borderBottom: "1px solid var(--line-soft)",
        paddingLeft: 0,
        paddingRight: 0,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Tag
            icon={
              !completed ? (
                <LoadingOutlined />
              ) : searchPayload?.error ? (
                <CloseCircleOutlined />
              ) : (
                <CheckCircleOutlined />
              )
            }
            style={{
              marginInlineEnd: 0,
              border: "none",
              borderRadius: 6,
              background: searchPayload?.error
                ? "#fff1f2"
                : completed
                  ? "var(--success-soft)"
                  : "var(--primary-soft)",
              color: searchPayload?.error
                ? "var(--danger)"
                : completed
                  ? "var(--success)"
                  : "var(--primary)",
              fontFamily: "var(--sans)",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {mapToolName(toolCall.name)}
          </Tag>
          {searchPayload?.source && (
            <Tag className="!m-0 text-[11px]">{searchPayload.source}</Tag>
          )}
          {isKnowledgeGraphFileTool(toolCall.name) && (
            <Tag className="!m-0 text-[11px]">
              type: {getKnowledgeGraphToolType(toolCall)}
            </Tag>
          )}
        </div>

        {toolCall.name === "web_search" ? (
          <WebSearchResultView toolCall={toolCall} payload={searchPayload} />
        ) : isKnowledgeGraphFileTool(toolCall.name) ? (
          <KnowledgeGraphToolResultView
            toolCall={toolCall}
            payload={kgFilePayload}
          />
        ) : (
          <GenericToolResult toolCall={toolCall} />
        )}
      </div>
    </List.Item>
  );
}

/**
 * 展示联网搜索的查询、结果列表和错误信息。
 */
function WebSearchResultView({
  toolCall,
  payload,
}: {
  toolCall: ToolCall;
  payload: WebSearchPayload | null;
}) {
  const completed = isToolCallComplete(toolCall);
  const query = payload?.query ?? readQueryFromArgs(toolCall.args);
  const results = payload?.results ?? [];

  return (
    <div className="space-y-2">
      {query && (
        <Typography.Text className="block text-[13px] text-[var(--ink-faint)]">
          查询：{query}
        </Typography.Text>
      )}

      {!completed && (
        <Typography.Text className="block text-[13px] text-[var(--ink-faint)]">
          正在等待搜索结果...
        </Typography.Text>
      )}

      {completed && !payload && <GenericToolResult toolCall={toolCall} />}

      {payload?.error && (
        <div className="rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[13px] text-[var(--danger)]">
          {payload.error}
        </div>
      )}

      {payload?.warnings?.map((warning, index) => (
        <div
          key={index}
          className="rounded-md border border-[rgba(217,119,6,0.22)] bg-[rgba(217,119,6,0.08)] px-3 py-2 text-[12px] text-[var(--warning)]"
        >
          {warning}
        </div>
      ))}

      {results.length > 0 ? (
        <List
          size="small"
          dataSource={results}
          renderItem={(result) => (
            <List.Item className="!items-start !px-0">
              <div className="min-w-0">
                <a
                  className="inline-flex items-start gap-1 text-[13px] font-bold text-[var(--primary)]"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <LinkOutlined className="mt-0.5 shrink-0" />
                  <span className="wrap-break-word">
                    {result.title || result.url}
                  </span>
                </a>
                {result.snippet && (
                  <div className="mt-1 text-[13px] leading-relaxed text-[var(--ink-mute)]">
                    {result.snippet}
                  </div>
                )}
              </div>
            </List.Item>
          )}
        />
      ) : (
        completed &&
        payload &&
        !payload.error && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无搜索结果"
          />
        )
      )}
    </div>
  );
}

interface KnowledgeGraphToolPayload {
  path?: string;
  workspaceId?: string;
  action?: string;
  size?: number;
  preview?: string;
  error?: string;
}

/**
 * 展示知识图谱文件工具的操作摘要，避免把完整 markdown 挤进聊天正文。
 */
function KnowledgeGraphToolResultView({
  toolCall,
  payload,
}: {
  toolCall: ToolCall;
  payload: KnowledgeGraphToolPayload | null;
}) {
  const completed = isToolCallComplete(toolCall);
  const path = payload?.path ?? readStringArg(toolCall.args, "path");

  return (
    <div className="space-y-2">
      {!completed && (
        <Typography.Text className="block text-[13px] text-[var(--ink-faint)]">
          正在执行文件工具...
        </Typography.Text>
      )}

      {payload?.error && (
        <div className="rounded-md border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[13px] text-[var(--danger)]">
          {payload.error}
        </div>
      )}

      {(path || payload?.workspaceId || typeof payload?.size === "number") && (
        <div className="grid gap-1 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--ink-mute)]">
          {path && <span>文件：{path}</span>}
          {payload?.workspaceId && <span>工作区：{payload.workspaceId}</span>}
          {typeof payload?.size === "number" && (
            <span>大小：{payload.size} 字符</span>
          )}
        </div>
      )}

      {payload?.preview ? (
        <pre className="themed-scrollbar max-h-[220px] overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-[12px] leading-relaxed text-[var(--ink-mute)]">
          {payload.preview}
        </pre>
      ) : (
        completed && !payload?.error && <GenericToolResult toolCall={toolCall} />
      )}
    </div>
  );
}

/**
 * 对未知工具输出做保底展示，方便调试和后续扩展。
 */
function GenericToolResult({ toolCall }: { toolCall: ToolCall }) {
  return (
    <pre className="themed-scrollbar max-h-[220px] overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-[12px] leading-relaxed text-[var(--ink-mute)]">
      {toolCall.result !== undefined
        ? stringifyUnknown(toolCall.result)
        : stringifyUnknown(toolCall.args)}
    </pre>
  );
}

/**
 * 判断工具调用是否已结束；部分工具只通过 Agent 完成事件收敛，没有独立结果消息。
 */
function isToolCallComplete(toolCall: ToolCall): boolean {
  return toolCall.result !== undefined || toolCall.status === "complete";
}

/**
 * 将工具名转换为前端显示名。
 */
function mapToolName(name: string): string {
  return TOOL_NAME_LABELS[name] ?? name;
}

/**
 * 判断工具是否属于受控知识图谱文件工具。
 */
function isKnowledgeGraphFileTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(KG_TOOL_TYPE_LABELS, name);
}

/**
 * 获取知识图谱文件工具的操作类型展示文案。
 */
function getKnowledgeGraphToolType(toolCall: ToolCall): string {
  const payload = parseKnowledgeGraphToolPayload(toolCall.result);
  const action = payload?.action;
  if (action === "created") return "新增";
  if (action === "read") return "查询";
  if (action === "inserted") return "插入";
  if (action === "updated") return "更新";
  if (action === "deleted_content") return "删除";
  if (action === "not_found") return "未命中";
  return KG_TOOL_TYPE_LABELS[toolCall.name] ?? toolCall.name;
}

/**
 * 解析知识图谱文件工具返回的 JSON 摘要。
 */
function parseKnowledgeGraphToolPayload(
  value: unknown,
): KnowledgeGraphToolPayload | null {
  const payload = parseObjectPayload(value);
  if (!payload) return null;

  return {
    path: readStringArg(payload, "path"),
    workspaceId: readStringArg(payload, "workspaceId"),
    action: readStringArg(payload, "action"),
    size: typeof payload.size === "number" ? payload.size : undefined,
    preview: readStringArg(payload, "preview"),
    error: readStringArg(payload, "error"),
  };
}

/**
 * 解析联网搜索工具返回的 JSON 内容。
 */
function parseWebSearchPayload(value: unknown): WebSearchPayload | null {
  return parseObjectPayload(value) as WebSearchPayload | null;
}

/**
 * 从工具调用参数里读取查询词。
 */
function readQueryFromArgs(args: Record<string, unknown> | undefined): string {
  return readStringArg(args, "query");
}

/**
 * 从对象字段中读取字符串。
 */
function readStringArg(
  args: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = args?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * 将未知工具返回值解析为对象。
 */
function parseObjectPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

/**
 * 稳定格式化未知工具数据。
 */
function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
