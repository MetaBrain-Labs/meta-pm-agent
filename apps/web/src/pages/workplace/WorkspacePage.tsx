/**
 * 本地项目列表页
 *
 * 展示已关联的本地目录项目，并提供打开、重命名、路径迁移、在资源管理器打开和
 * 从列表移除。页面只负责布局与交互反馈，业务动作全部由上层回调驱动。
 *
 * Responsibilities:
 * - 展示项目封面网格与项目搜索
 * - 提供新建项目入口、主快捷动作与页面更多操作菜单
 * - 展示当前项目两个产物的本地保存状态
 *
 * Notes:
 * - 从列表移除项目不会删除磁盘目录或关联业务数据。
 * - 全局侧边栏由应用外壳提供，本页不再自带导航栏。
 * - 封面配色只用于识别，使用低饱和 tint，不引入高饱和色块。
 * - 项目路径等本地细节不在此页展示：统一由 Workspace Header 的同步状态承载。
 */

import { useMemo, useState, type CSSProperties } from "react";
import { Button, Dropdown, Input, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type { ThreadInfo, WorkspaceInfo } from "../../types";
import { WorkspaceLocalStoragePanel } from "../../components/WorkspaceLocalStoragePanel";
import { getProjectCoverStyle } from "../../utils/project-cover";
import { canRevealLocalPath, revealLocalPath } from "../../utils/reveal-path";

type MenuItem = Required<MenuProps>["items"][number];

const TEXT = {
  title: "项目列表",
  searchPlaceholder: "搜索项目",
  emptyList: "暂无项目",
  emptyListHint: "新建第一个本地项目后会显示在这里",
  emptySearch: "没有匹配的项目",
  addProject: "新建项目",
  noPath: "未关联本地路径",
  recentThread: "最近对话",
  localSettings: "本地设置",
} as const;

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
 * 项目列表页：项目封面网格 + 当前项目本地数据。
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
  const revealSupported = canRevealLocalPath();

  /**
   * 页面级更多操作。
   *
   * 只收纳已有真实能力：本地模型列表设置与当前项目的资源管理器入口。
   * 没有宿主能力时保留入口并说明原因，不伪装成可用功能。
   */
  const pageMenuItems: MenuItem[] = [
    {
      key: "local-settings",
      icon: <SettingOutlined />,
      label: TEXT.localSettings,
      onClick: onLocalSettings,
    },
    {
      key: "reveal",
      icon: <FolderOpenOutlined />,
      label: "在资源管理器中打开项目",
      disabled: !revealSupported || !activeWorkspace?.localPath,
      onClick: () => void revealLocalPath(activeWorkspace?.localPath),
    },
  ];

  return (
    <div className="workspace-page">
      <div className="workspace-page-content">
        <header className="workspace-page-head">
          <h1>{TEXT.title}</h1>
          <div className="workspace-page-head-actions">
            <Input
              allowClear
              value={keyword}
              prefix={<SearchOutlined aria-hidden="true" />}
              placeholder={TEXT.searchPlaceholder}
              aria-label={TEXT.searchPlaceholder}
              className="workspace-page-search"
              onChange={(event) => setKeyword(event.target.value)}
            />
            {/*
              标题区只保留一个主快捷动作；其余项目管理操作进入 More 菜单，
              避免「最近对话 / 本地设置」与页面标题同级。
            */}
            {activeWorkspace && activeThread && (
              <Button
                type="text"
                icon={<RightOutlined />}
                onClick={() => onOpenWorkspace(activeWorkspace.id)}
              >
                {TEXT.recentThread}
              </Button>
            )}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={creatingWorkspace}
              onClick={onNewWorkspace}
            >
              {TEXT.addProject}
            </Button>
            <Dropdown
              trigger={["click"]}
              menu={{ items: pageMenuItems }}
              placement="bottomRight"
            >
              <Button
                type="text"
                shape="circle"
                aria-label="更多操作"
                icon={<EllipsisOutlined />}
              />
            </Dropdown>
          </div>
        </header>

        {error && <div className="workspace-page-error">{error}</div>}

        {workspaces.length === 0 ? (
          <div className="workspace-page-empty">
            <FolderOutlined />
            <strong>{TEXT.emptyList}</strong>
            <span>{TEXT.emptyListHint}</span>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onNewWorkspace}
            >
              {TEXT.addProject}
            </Button>
          </div>
        ) : visibleWorkspaces.length === 0 ? (
          <div className="workspace-page-empty">
            <strong>{TEXT.emptySearch}</strong>
          </div>
        ) : (
          <div className="project-grid">
            {visibleWorkspaces.map((workspace) => (
              <ProjectCard
                key={workspace.id}
                workspace={workspace}
                active={activeWorkspace?.id === workspace.id}
                revealSupported={revealSupported}
                onOpen={() => onOpenWorkspace(workspace.id)}
                onRename={() => onWorkspaceRename?.(workspace.id)}
                onMigrate={() => onWorkspaceMigrate?.(workspace.id)}
                onRemove={() => onWorkspaceRemove?.(workspace.id)}
              />
            ))}
          </div>
        )}

        {/*
          当前项目只保留轻量本地状态：项目名 + 每个产物的同步状态。
          项目路径、上下文路径、PRD 路径与拷贝说明属于技术细节，
          统一收进 Workspace Header 的同步状态详情层。
        */}
        <section className="workspace-page-foot">
          <div className="ds-section-header">
            <div className="ds-section-header-copy">
              <h2 className="ds-section-title">本地保存状态</h2>
              <p className="ds-section-description">
                {activeWorkspace
                  ? `${activeWorkspace.name} 的产品上下文与 PRD 副本。`
                  : "还没有关联本地项目。"}
              </p>
            </div>
          </div>

          {activeWorkspace && (
            <WorkspaceLocalStoragePanel
              workspaceId={activeWorkspace.id}
              refreshKey={activeWorkspace.localPath ?? ""}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * 项目卡片：封面、名称、更新时间与更多操作。
 *
 * 封面只提供识别辅助，选中态用细边框表达，不使用高饱和主题色。
 */
function ProjectCard({
  workspace,
  active,
  revealSupported,
  onOpen,
  onRename,
  onMigrate,
  onRemove,
}: {
  workspace: WorkspaceInfo;
  active: boolean;
  revealSupported: boolean;
  onOpen: () => void;
  onRename: () => void;
  onMigrate: () => void;
  onRemove: () => void;
}) {
  const actionItems: MenuItem[] = [
    {
      key: "rename",
      icon: <EditOutlined />,
      label: "项目重命名",
      onClick: onRename,
    },
    {
      key: "migrate",
      icon: <FolderOpenOutlined />,
      label: "项目路径迁移",
      onClick: onMigrate,
    },
    {
      key: "reveal",
      icon: <FolderOpenOutlined />,
      label: "在资源管理器中打开",
      // 缺少宿主能力时保留入口但明确禁用原因，不伪装成可用功能。
      disabled: !revealSupported || !workspace.localPath,
      onClick: () => void revealLocalPath(workspace.localPath),
    },
    { type: "divider" },
    {
      key: "remove",
      icon: <DeleteOutlined />,
      label: "从列表中移除",
      danger: true,
      onClick: onRemove,
    },
  ];

  return (
    <div
      className="project-card"
      data-active={active ? "true" : "false"}
      style={getProjectCoverStyle(workspace.id) as CSSProperties}
    >
      <button
        type="button"
        className="project-card-open"
        aria-current={active ? "true" : undefined}
        onClick={onOpen}
      >
        <span className="project-cover" aria-hidden="true">
          <FolderOutlined />
        </span>
        <span className="project-card-name">
          {workspace.name || "未命名项目"}
        </span>
        <span className="project-card-meta">
          更新于 {formatUpdatedAt(workspace.updatedAt)}
        </span>
      </button>

      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        menu={{ items: actionItems }}
      >
        <Button
          type="text"
          size="small"
          shape="circle"
          className="project-card-more"
          aria-label={`${workspace.name || "未命名项目"} 的项目操作`}
          icon={<EllipsisOutlined />}
        />
      </Dropdown>

      {workspace.localPath ? (
        <Tooltip title={workspace.localPath} placement="bottomLeft">
          <span className="project-card-path" tabIndex={0}>
            {workspace.localPath}
          </span>
        </Tooltip>
      ) : (
        <span className="project-card-path is-muted">{TEXT.noPath}</span>
      )}
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
