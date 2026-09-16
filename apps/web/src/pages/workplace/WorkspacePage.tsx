/**
 * 本地项目工作台首页
 *
 * 展示已关联的本地目录项目，并提供项目重命名、路径修改和软移除操作；
 * 右侧展示上下文与 PRD 的本地保存状态。
 *
 * Responsibilities:
 * - 展示 active 项目列表并打开项目
 * - 提供本地项目基础管理菜单
 * - 提供本地设置入口和本地保存状态面板
 *
 * Notes:
 * - 从列表移除项目不会删除磁盘目录或关联业务数据。
 * - 页面只负责布局与交互反馈，业务动作全部由上层回调驱动。
 */

import { Avatar, Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  EditOutlined,
  EllipsisOutlined,
  FolderOutlined,
  HistoryOutlined,
  PlusOutlined,
  RightOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { ThreadInfo, WorkspaceInfo } from "../../types";
import { DEFAULT_CHAT_TITLE } from "../../constants/app";
import { WorkspaceLocalStoragePanel } from "../../components/WorkspaceLocalStoragePanel";

type MenuItem = Required<MenuProps>["items"][number];

const TEXT = {
  workspaceSection: "工作区",
  emptyList: "暂无项目",
  emptyListHint: "添加第一个本地项目后会显示在这里",
  localSettings: "本地设置",
  appName: "问渠",
  version: "v0.1",
  tagline: "管理本地项目与产品上下文",
  addProject: "添加本地项目",
  addProjectHint:
    "将 API 服务所在机器上的已有目录关联到问渠，产品上下文与 PRD 会同步保存到该目录。",
  currentSection: "当前项目",
  recentThread: "最近对话",
  justOpened: "上次打开",
  noPath: "未关联本地路径",
} as const;

/** 项目行操作项，点击行右侧图标弹出。 */
const projectActionItems: MenuItem[] = [
  { key: "rename", icon: <EditOutlined />, label: "项目重命名" },
  { key: "migrate", icon: <FolderOutlined />, label: "修改本地路径" },
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
 * 工作台首页，左侧为项目列表，右侧为页面标题与当前项目本地数据。
 *
 * 列表项只负责导航，项目改名、路径迁移和软移除收在行尾的 Dropdown 菜单中。
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
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    null;
  const activeThread = threads[0] ?? null;

  /** 分发项目行操作，key 直接对应上层回调。 */
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

  /** 新增项目在两个位置复用同一主操作，加载态由 creatingWorkspace 统一驱动。 */
  const addProjectButton = (
    <Button
      type="primary"
      icon={<PlusOutlined />}
      loading={creatingWorkspace}
      onClick={onNewWorkspace}
    >
      {TEXT.addProject}
    </Button>
  );

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-head">
          <h2>{TEXT.workspaceSection}</h2>
          <span className="workspace-sidebar-count">{workspaces.length}</span>
        </div>

        <div className="workspace-project-list">
          {workspaces.length > 0 ? (
            workspaces.map((workspace) => (
              <ProjectListItem
                key={workspace.id}
                workspace={workspace}
                active={activeWorkspace?.id === workspace.id}
                onOpen={() => onOpenWorkspace(workspace.id)}
                onAction={(action) => handleProjectAction(workspace.id, action)}
              />
            ))
          ) : (
            <div className="workspace-empty-list">
              <FolderOutlined />
              <strong>{TEXT.emptyList}</strong>
              <span>{TEXT.emptyListHint}</span>
            </div>
          )}
        </div>

        <button type="button" className="workspace-sidebar-nav" onClick={onLocalSettings}>
          <SettingOutlined className="workspace-sidebar-nav-icon" />
          <span className="workspace-sidebar-nav-label">{TEXT.localSettings}</span>
          <RightOutlined className="workspace-sidebar-nav-arrow" />
        </button>
      </aside>

      <main className="workspace-main">
        <div className="workspace-content">
          <header className="workspace-header">
            <Avatar
              shape="square"
              size={56}
              className="workspace-logo"
              src={<img draggable={false} src="/icon.png" alt="问渠" />}
            />
            <div className="workspace-header-text">
              <div className="workspace-header-title">
                <h1>{TEXT.appName}</h1>
                <span className="workspace-version">{TEXT.version}</span>
              </div>
              <p>{TEXT.tagline}</p>
            </div>
          </header>

          <div className="workspace-body">
            <section className="workspace-section" aria-label="本地项目">
              <div className="workspace-section-head">
                <h2>本地项目</h2>
              </div>
              <div className="workspace-add-row">
                <p>{TEXT.addProjectHint}</p>
                {addProjectButton}
              </div>
            </section>

            <section className="workspace-section" aria-label="当前项目">
              <div className="workspace-section-head">
                <h2>{TEXT.currentSection}</h2>
                {activeWorkspace && (
                  <span className="workspace-section-meta">本地数据保存状态</span>
                )}
              </div>

              {activeWorkspace ? (
                <WorkspaceLocalStoragePanel
                  workspaceId={activeWorkspace.id}
                  refreshKey={activeWorkspace.localPath ?? ""}
                  projectName={activeWorkspace.name}
                  projectPath={activeWorkspace.localPath}
                />
              ) : (
                <div className="workspace-empty-panel">
                  <span>还没有关联本地项目。</span>
                  {addProjectButton}
                </div>
              )}
            </section>

            {error && <div className="workspace-error">{error}</div>}

            {activeThread && activeWorkspace && (
              <button
                type="button"
                className="workspace-recent"
                onClick={() => onOpenWorkspace(activeWorkspace.id)}
              >
                <HistoryOutlined />
                <span className="workspace-recent-label">{TEXT.recentThread}</span>
                <span className="workspace-recent-title">
                  {activeThread.title || DEFAULT_CHAT_TITLE}
                </span>
                <RightOutlined className="workspace-recent-arrow" />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * 项目列表项：名称、单行本地路径与行尾操作菜单。
 *
 * 选中态通过左侧 accent indicator 和浅色背景表达，避免与页面标题争夺注意力。
 */
function ProjectListItem({
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
      className={active ? "project-item is-active" : "project-item"}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="project-item-body">
        <div className="project-item-title">
          <span className="project-item-name">{workspace.name || "未命名项目"}</span>
          {active && <span className="project-item-badge">{TEXT.justOpened}</span>}
        </div>
        {workspace.localPath ? (
          <Tooltip title={workspace.localPath} placement="right">
            <span className="project-item-path">{workspace.localPath}</span>
          </Tooltip>
        ) : (
          <span className="project-item-path is-muted">{TEXT.noPath}</span>
        )}
      </div>

      <Dropdown
        trigger={["click"]}
        menu={{
          items: projectActionItems,
          onClick: ({ key, domEvent }) => {
            // 行操作不再触发行本身的打开动作。
            domEvent.stopPropagation();
            onAction(key);
          },
        }}
      >
        <Button
          type="text"
          size="small"
          className="project-item-more"
          aria-label="项目操作"
          icon={<EllipsisOutlined />}
          onClick={(event) => event.stopPropagation()}
        />
      </Dropdown>
    </div>
  );
}
