/**
 * 全局侧边栏
 *
 * 承载应用级导航：品牌、新建对话、项目、交付文档、外部知识库、最近会话和用户
 * 区域。会话历史按真实更新时间分组，搜索框只过滤本地已加载的会话。
 *
 * Responsibilities:
 * - 展示品牌、主操作和最近会话列表，并触发导航回调
 * - 提供会话搜索、重命名与删除入口
 * - 在收起态退化为图标栏，保留 Tooltip 可访问名称
 *
 * Notes:
 * - 只消费上层传入的数据与回调，不加载会话、不读写本地存储、不修改业务状态。
 * - 外部知识库在当前版本尚未实现，以禁用态呈现，不冒充已有功能。
 */

import { useMemo, useState, type ReactNode } from "react";
import { Avatar, Dropdown, Input, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { ThreadInfo } from "../../types";
import { DEFAULT_CHAT_TITLE } from "../../constants/app";
type MenuItem = Required<MenuProps>["items"][number];

const TEXT = {
  appName: "问渠",
  version: "v0.1",
  newConversation: "新建对话",
  projects: "项目",
  documents: "交付文档",
  knowledge: "外部知识库",
  knowledgeHint: "外部知识库将在后续版本接入",
  searchPlaceholder: "搜索对话",
  emptyThreads: "暂无对话",
  emptyThreadsHint: "新建对话后，最近记录会显示在这里。",
  emptySearch: "没有匹配的对话",
  localSettings: "本地设置",
  renameThread: "对话重命名",
  deleteThread: "删除对话",
  account: "User",
  settingsHint: "项目与模型设置",
} as const;

/** 会话行尾操作菜单。 */
const threadActionItems: MenuItem[] = [
  { key: "rename", icon: <EditOutlined />, label: TEXT.renameThread },
  { type: "divider" },
  { key: "delete", icon: <DeleteOutlined />, label: TEXT.deleteThread, danger: true },
];

interface Props {
  /** 当前项目名称，用作项目导航行标题。 */
  workspaceName: string | null;
  threads: ThreadInfo[];
  activeThreadId: string | null;
  activeMode: "chat" | "documents";
  collapsed: boolean;
  creatingThread: boolean;
  onNewThread: () => void | Promise<void>;
  onOpenProjects: () => void;
  onOpenDocuments: () => void;
  onSelectThread: (threadId: string) => void;
  onThreadRename?: (threadId: string) => void;
  onThreadDelete?: (threadId: string) => void;
}

export function AppSidebar({
  workspaceName,
  threads,
  activeThreadId,
  activeMode,
  collapsed,
  creatingThread,
  onNewThread,
  onOpenProjects,
  onOpenDocuments,
  onSelectThread,
  onThreadRename,
  onThreadDelete,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const groups = useMemo(
    () => groupThreadsByDate(filterThreads(threads, keyword)),
    [keyword, threads],
  );
  const hasThreads = threads.length > 0;

  /** 分发会话行尾操作。 */
  const handleThreadAction = (threadId: string, action: string) => {
    if (action === "rename") onThreadRename?.(threadId);
    if (action === "delete") onThreadDelete?.(threadId);
  };

  if (collapsed) {
    return (
      <div className="app-nav is-collapsed">
        <div className="app-nav-brand is-collapsed">
          <Avatar
            shape="square"
            size={28}
            src={<img draggable={false} src="/icon.png" alt={TEXT.appName} />}
          />
        </div>

        <div className="app-nav-group">
          <NavIconButton
            label={TEXT.newConversation}
            icon={<PlusOutlined />}
            loading={creatingThread}
            onClick={() => void onNewThread()}
          />
          <NavIconButton
            label={TEXT.projects}
            icon={<AppstoreOutlined />}
            active={activeMode === "chat" && !activeThreadId}
            onClick={onOpenProjects}
          />
          <NavIconButton
            label={TEXT.documents}
            icon={<FileTextOutlined />}
            active={activeMode === "documents"}
            onClick={onOpenDocuments}
          />
          <NavIconButton
            label={TEXT.knowledgeHint}
            icon={<BookOutlined />}
            disabled
            onClick={() => undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app-nav">
      <div className="app-nav-brand">
        <Avatar
          shape="square"
          size={28}
          src={<img draggable={false} src="/icon.png" alt={TEXT.appName} />}
        />
        <span className="app-nav-brand-name">{TEXT.appName}</span>
        <span className="app-nav-brand-version">{TEXT.version}</span>
      </div>

      <div className="app-nav-actions">
        <button
          type="button"
          className="app-nav-action"
          disabled={creatingThread}
          onClick={() => void onNewThread()}
        >
          <PlusOutlined aria-hidden="true" />
          <span>{TEXT.newConversation}</span>
        </button>
      </div>

      <nav className="app-nav-group" aria-label="全局导航">
        <NavRow
          icon={<AppstoreOutlined />}
          label={TEXT.projects}
          hint={workspaceName}
          active={activeMode === "chat"}
          onClick={onOpenProjects}
        />
        <NavRow
          icon={<FileTextOutlined />}
          label={TEXT.documents}
          active={activeMode === "documents"}
          onClick={onOpenDocuments}
        />
        <NavRow
          icon={<BookOutlined />}
          label={TEXT.knowledge}
          disabled
          onClick={() => undefined}
        />
      </nav>

      <div className="app-nav-section">
        <Input
          allowClear
          size="small"
          value={keyword}
          prefix={<SearchOutlined aria-hidden="true" />}
          placeholder={TEXT.searchPlaceholder}
          aria-label={TEXT.searchPlaceholder}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="app-nav-threads scrollbar-none">
        {!hasThreads ? (
          <div className="app-nav-empty">
            <strong>{TEXT.emptyThreads}</strong>
            <p>{TEXT.emptyThreadsHint}</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="app-nav-empty">
            <strong>{TEXT.emptySearch}</strong>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="app-nav-thread-group">
              <h2 className="app-nav-thread-date">{group.label}</h2>
              {group.threads.map((thread) => (
                <div
                  key={thread.id}
                  className="app-thread"
                  data-active={thread.id === activeThreadId ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="app-thread-title"
                    title={thread.title || DEFAULT_CHAT_TITLE}
                    onClick={() => onSelectThread(thread.id)}
                  >
                    {thread.title || DEFAULT_CHAT_TITLE}
                  </button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: threadActionItems,
                      onClick: ({ key }) => handleThreadAction(thread.id, key),
                    }}
                  >
                    <button
                      type="button"
                      className="app-thread-more"
                      aria-label={`${thread.title || DEFAULT_CHAT_TITLE} 的对话操作`}
                    >
                      <MoreOutlined aria-hidden="true" />
                    </button>
                  </Dropdown>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 侧栏用户区域：由 AppShell 放在固定底部行，账户入口始终可见。
 */
export function SidebarUserArea({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="app-nav-user">
      <button
        type="button"
        className="app-nav-user-chip"
        title={TEXT.settingsHint}
        aria-label={TEXT.settingsHint}
        onClick={onOpenSettings}
      >
        <Avatar size={24} className="app-nav-user-avatar" alt={TEXT.account}>
          {TEXT.account.slice(0, 1)}
        </Avatar>
        <span className="app-nav-user-name">{TEXT.account}</span>
        <SettingOutlined aria-hidden="true" className="app-nav-user-icon" />
      </button>
    </div>
  );
}

/**
 * 展开态导航行：图标、标签和可选的项目副标题。
 */
function NavRow({
  icon,
  label,
  hint,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string | null;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="app-nav-row"
      data-active={active ? "true" : "false"}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="app-nav-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="app-nav-row-label">{label}</span>
      {hint && <span className="app-nav-row-hint">{hint}</span>}
    </button>
  );
}

/** 收起态图标按钮，可访问名称由 Tooltip 与 aria-label 共同提供。 */
function NavIconButton({
  label,
  icon,
  active = false,
  disabled = false,
  loading = false,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={label} placement="right">
      <button
        type="button"
        className="app-nav-icon-button"
        data-active={active ? "true" : "false"}
        aria-label={label}
        disabled={disabled || loading}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/** 按标题关键字过滤已加载会话，不触发任何请求。 */
function filterThreads(threads: ThreadInfo[], keyword: string): ThreadInfo[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return threads;
  return threads.filter((thread) =>
    (thread.title || DEFAULT_CHAT_TITLE).toLowerCase().includes(normalized),
  );
}

/**
 * 按真实更新时间把会话分组，避免把所有记录都归入“今天”。
 */
function groupThreadsByDate(
  threads: ThreadInfo[],
): Array<{ label: string; threads: ThreadInfo[] }> {
  const groups = new Map<string, ThreadInfo[]>();
  const ordered = [...threads].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

  for (const thread of ordered) {
    const label = formatThreadGroupLabel(thread.updatedAt);
    const bucket = groups.get(label);
    if (bucket) bucket.push(thread);
    else groups.set(label, [thread]);
  }

  return [...groups].map(([label, groupThreads]) => ({
    label,
    threads: groupThreads,
  }));
}

/** 会话分组标签：今天、昨天、近 7 天或具体月份。 */
function formatThreadGroupLabel(value: string): string {
  const updated = new Date(value);
  if (Number.isNaN(updated.getTime())) return "更早";

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const elapsedDays = Math.floor(
    (startOfToday - new Date(
      updated.getFullYear(),
      updated.getMonth(),
      updated.getDate(),
    ).getTime()) /
      86_400_000,
  );

  if (elapsedDays <= 0) return "今天";
  if (elapsedDays === 1) return "昨天";
  if (elapsedDays < 7) return "近 7 天";
  return `${updated.getFullYear()}-${String(updated.getMonth() + 1).padStart(2, "0")}`;
}
