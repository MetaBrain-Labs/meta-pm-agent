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
};

/**
 * 以折叠卡片展示 Agent 工具调用，避免工具结果挤占普通回复正文。
 */
export function ToolCallsCard({ toolCalls }: Props) {
  if (toolCalls.length === 0) return null;

  const completedCount = toolCalls.filter(
    (toolCall) => toolCall.result !== undefined,
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
  const completed = toolCall.result !== undefined;
  const searchPayload =
    toolCall.name === "web_search"
      ? parseWebSearchPayload(toolCall.result)
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
        </div>

        {toolCall.name === "web_search" ? (
          <WebSearchResultView toolCall={toolCall} payload={searchPayload} />
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
  const completed = toolCall.result !== undefined;
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
 * 将工具名转换为前端显示名。
 */
function mapToolName(name: string): string {
  return TOOL_NAME_LABELS[name] ?? name;
}

/**
 * 解析联网搜索工具返回的 JSON 内容。
 */
function parseWebSearchPayload(value: unknown): WebSearchPayload | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as WebSearchPayload;
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && value !== null) {
    return value as WebSearchPayload;
  }

  return null;
}

/**
 * 从工具调用参数里读取查询词。
 */
function readQueryFromArgs(args: Record<string, unknown> | undefined): string {
  const query = args?.query;
  return typeof query === "string" ? query : "";
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
