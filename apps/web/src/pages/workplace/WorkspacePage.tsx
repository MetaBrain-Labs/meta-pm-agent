/**
 * 本地项目列表页
 *
 * 展示已关联的本地目录项目，并提供项目重命名、路径修改、软移除和本地设置
 * 入口。页面只负责布局与交互反馈，业务动作全部由上层回调驱动。
 *
 * Responsibilities:
 * - 展示 active 项目网格与项目搜索
 * - 提供新建项目、重命名、修改本地路径和从列表移除
 * - 展示当前项目的本地保存状态与最近对话入口
 *
 * Notes:
 * - 从列表移除项目不会删除磁盘目录或关联业务数据。
 * - 全局侧边栏由应用外壳提供，本页不再自带导航栏。
 */

import { useMemo, useState } from "react";
import { Button, Dropdown, Input, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  EditOutlined,
  EllipsisOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ThreadInfo, WorkspaceInfo } from "../../types";
import { DEFAULT_CHAT_TITLE } from "../../constants/app";
import { WorkspaceLocalStoragePanel } from "../../components/WorkspaceLocalStoragePanel";

type MenuItem = Required<MenuProps>["items"][number];

const TEXT = {
  title: "项目列表",
  description:
    "关联 API 服务所在机器上的已有目录，产品上下文与 PRD 会同步保存到该目录。",
  searchPlaceholder: "搜索项目",
  emptyList: "暂无项目",
  emptyListHint: "添加第一个本地项目后会显示在这里",
  emptySearch: "没有匹配的项目",
  addProject: "新建项目",
  noPath: "未关联本地路径",
  recentThread: "最近对话",
} as const;

/** 项目卡片操作项，点击卡片右上角图标弹出。 */
const projectActionItems: MenuItem[] = [
  { key: "rename", icon: <EditOutlined />, label: "项目重命名" },
  { key: "migrate", icon: <FolderOpenOutlined />, label: "修改本地路径" },
  { type: "divider" },
  { key: "remove", label: "从列表中移除", danger: true },
];

interface WorkspacePageProps {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  threads: ThreadInfo[];
  error: string | null;
  creatingWorkspace: boolean;
  onOpenWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onLocalSettings: () => void;
  /** 项目重命名回调 */
  onWorkspaceRename?: (id: string) => void;
  /** 项目路径迁移回调 */
  onWorkspaceMigrate?: (id: string) => void;
  /** 从列表中移除项目 */
  onWorkspaceRemove?: (id: string) => void;
}

/**
 * 项目列表页：项目网格 + 当前项目本地数据。
 */
export function WorkspacePage({
  workspaces,
  activeWorkspaceId,
  threads,
  error,
  creatingWorkspace,
  onOpenWorkspace,
  onNewWorkspace,
  onLocalSettings,
  onWorkspaceRename,
  onWorkspaceMigrate,
  onWorkspaceRemove,
}: WorkspacePageProps) {
  const [keyword, setKeyword] = useState("");
  const visibleWorkspaces = useMemo(
    () => filterWorkspaces(workspaces, keyword),
    [keyword, workspaces],
  );
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    null;
  const activeThread = threads[0] ?? null;

  /** 分发项目卡片操作，key 直接对应上层回调。 */
  const handleProjectAction = (workspaceId: string, action: string) => {
    switch (action) {
      case "rename":
        onWorkspaceRename?.(workspaceId);
        break;
      case "migrate":
        onWorkspaceMigrate?.(workspaceId);
        break;
      case "remove":
        onWorkspaceRemove?.(workspaceId);
        break;
    }
  };

  return (
    <div className="workspace-page">
      <div className="workspace-page-content">
        <header className="workspace-page-head">
          <div>
            <h1>{TEXT.title}</h1>
            <p>{TEXT.description}</p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={creatingWorkspace}
            onClick={onNewWorkspace}
          >
            {TEXT.addProject}
          </Button>
        </header>

        {workspaces.length > 0 && (
          <div className="workspace-page-search">
            <Input
              allowClear
              value={keyword}
              prefix={<SearchOutlined aria-hidden="true" />}
              placeholder={TEXT.searchPlaceholder}
              aria-label={TEXT.searchPlaceholder}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        )}

        {workspaces.length === 0 ? (
          <div className="workspace-page-empty">
            <FolderOutlined />
            <strong>{TEXT.emptyList}</strong>
            <span>{TEXT.emptyListHint}</span>
          </div>
        ) : visibleWorkspaces.length === 0 ? (
          <div className="workspace-page-empty">
            <strong>{TEXT.emptySearch}</strong>
          </div>
        ) : (
          <div className="workspace-card-grid">
            {visibleWorkspaces.map((workspace) => (
              <ProjectCard
                key={workspace.id}
                workspace={workspace}
                active={activeWorkspace?.id === workspace.id}
                onOpen={() => onOpenWorkspace(workspace.id)}
                onAction={(action) => handleProjectAction(workspace.id, action)}
              />
            ))}
          </div>
        )}

        <div className="workspace-page-foot">
          {error && <div className="workspace-page-error">{error}</div>}

          <div className="ds-section-header">
            <div className="ds-section-header-copy">
              <h2 className="ds-section-title">当前项目</h2>
              <p className="ds-section-description">
                {activeWorkspace
                  ? "产品上下文与 PRD 的本地保存状态。"
                  : "还没有关联本地项目。"}
              </p>
            </div>
            <div className="ds-section-actions">
              {activeThread && activeWorkspace && (
                <Button
                  type="text"
                  icon={<RightOutlined />}
                  onClick={() => onOpenWorkspace(activeWorkspace.id)}
                >
                  {TEXT.recentThread}：{activeThread.title || DEFAULT_CHAT_TITLE}
                </Button>
              )}
              <Button type="text" onClick={onLocalSettings}>
                本地设置
              </Button>
            </div>
          </div>

          {activeWorkspace && (
            <WorkspaceLocalStoragePanel
              workspaceId={activeWorkspace.id}
              refreshKey={activeWorkspace.localPath ?? ""}
              projectName={activeWorkspace.name}
              projectPath={activeWorkspace.localPath}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 项目卡片：名称、本地路径与卡片操作菜单。
 *
 * 选中态只用细边框区分，不使用高饱和主题色或大面积封面。
 */
function ProjectCard({
  workspace,
  active,
  onOpen,
  onAction,
}: {
  workspace: WorkspaceInfo;
  active: boolean;
  onOpen: () => void;
  onAction: (action: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      className="project-card"
      data-active={active ? "true" : "false"}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="project-card-mark" aria-hidden="true">
        <FolderOutlined />
      </span>

      <div className="project-card-body">
        <div className="project-card-name">
          {workspace.name || "未命名项目"}
        </div>
        {workspace.localPath ? (
          <Tooltip title={workspace.localPath} placement="bottomLeft">
            <span className="project-card-path">{workspace.localPath}</span>
          </Tooltip>
        ) : (
          <span className="project-card-path">{TEXT.noPath}</span>
        )}
        <span className="project-card-meta">
          更新于 {formatUpdatedAt(workspace.updatedAt)}
        </span>
      </div>

      <Dropdown
        trigger={["click"]}
        menu={{
          items: projectActionItems,
          onClick: ({ key, domEvent }) => {
            // 卡片操作不再触发卡片本身的打开动作。
            domEvent.stopPropagation();
            onAction(key);
          },
        }}
      >
        <Button
          type="text"
          size="small"
          className="project-card-more"
          aria-label={`${workspace.name || "未命名项目"} 的项目操作`}
          icon={<EllipsisOutlined />}
          onClick={(event) => event.stopPropagation()}
        />
      </Dropdown>
    </div>
  );
}

/** 按名称或本地路径过滤项目，不触发任何请求。 */
function filterWorkspaces(
  workspaces: WorkspaceInfo[],
  keyword: string,
): WorkspaceInfo[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return workspaces;
  return workspaces.filter(
    (workspace) =>
      workspace.name.toLowerCase().includes(normalized) ||
      (workspace.localPath ?? "").toLowerCase().includes(normalized),
  );
}

/** 项目更新时间按本地化日期展示，缺少有效时间时回退为占位符。 */
function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleDateString();
}
