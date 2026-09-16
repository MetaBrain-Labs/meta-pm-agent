/**
 * 本地项目工作台
 *
 * 展示已关联的本地目录项目，并提供项目重命名、路径修改和软移除操作。
 *
 * Responsibilities:
 * - 展示 active 项目列表并打开项目
 * - 提供本地项目基础管理菜单
 * - 提供本地设置入口
 *
 * Notes:
 * - 从列表移除项目不会删除磁盘目录或关联业务数据。
 */

import { Avatar, Button, Menu } from "antd";
import type { MenuProps } from "antd";
import type { ThreadInfo, WorkspaceInfo } from "../../types";
import { DEFAULT_CHAT_TITLE } from "../../constants/app";
import { WorkspaceLocalStoragePanel } from "../../components/WorkspaceLocalStoragePanel";
import {
  DeleteOutlined,
  EditOutlined,
  RightOutlined,
  SettingOutlined,
  SwapOutlined,
} from "@ant-design/icons";

type MenuItem = Required<MenuProps>["items"][number];

const PROJECT_ACTIONS = {
  rename: "项目重命名",
  migrate: "修改本地路径",
  remove: "从列表中移除",
};

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
 * 工作台首页，负责展示项目列表、本地设置入口和项目操作区。
 *
 * 项目列表使用 Menu 组件渲染，每个项目为一个 SubMenu，鼠标移入时
 * 展示项目操作项（重命名、修改本地路径、移除）。
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

  // 当前激活的项目 key，用于 Menu 高亮
  const selectedKeys: string[] = activeWorkspaceId ? [activeWorkspaceId] : [];

  // 将项目列表映射为 SubMenu 菜单项
  const projectMenuItems: MenuItem[] = workspaces.map((workspace) => ({
    key: workspace.id,
    label: (
      <div className="flex flex-col">
        <div className="flex items-center">
          <span className="text-base leading-snug font-bold">
            {workspace.name || "项目名称"}
          </span>
          {activeWorkspace?.id === workspace.id && (
            <em className="ml-1.5 rounded bg-[rgb(102,157,235)] px-1.5 py-1 text-[12px] leading-none text-gray-400 not-italic">
              <span className="text-[#ffffff]">上次打开</span>
            </em>
          )}
        </div>
        <small className="mt-1 inline-block max-w-[240px] truncate text-xs text-gray-400">
          {workspace.localPath || "未设置本地路径"}
        </small>
      </div>
    ),
    onTitleClick: () => onOpenWorkspace(workspace.id),
    style: {
      paddingLeft: "4px",
      paddingBottom: "4px",
    },
    children: [
      {
        key: `${workspace.id}:rename`,
        icon: <EditOutlined />,
        label: PROJECT_ACTIONS.rename,
      },
      {
        key: `${workspace.id}:migrate`,
        icon: <SwapOutlined />,
        label: PROJECT_ACTIONS.migrate,
      },
      {
        key: `${workspace.id}:remove`,
        icon: <DeleteOutlined />,
        label: PROJECT_ACTIONS.remove,
        danger: true,
      },
    ],
  }));

  /** 处理子菜单操作项点击，从 key 中解析项目 ID 和操作类型 */
  const handleMenuClick: MenuProps["onClick"] = (e) => {
    const colonIndex = e.key.indexOf(":");
    if (colonIndex === -1) return;
    const workspaceId = e.key.slice(0, colonIndex);
    const action = e.key.slice(colonIndex + 1);
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
    <div className="workspace-shell">
      <aside className="workspace-projects">
        <div className="workspace-project-list">
          {workspaces.length > 0 ? (
            <Menu
              mode="vertical"
              selectedKeys={selectedKeys}
              items={projectMenuItems}
              onClick={handleMenuClick}
              style={{ background: "#ffffff" }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col gap-2">
                <span className="text-lg font-bold text-center">暂无项目</span>
                <span className="text-gray-500">
                  添加一个本地项目后会显示在这里
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="w-full  p-4" onClick={onLocalSettings}>
          <div className="flex items-center justify-between cursor-pointer rounded bg-white hover:bg-gray-100 p-2">
            <div className="flex items-center gap-2">
              <SettingOutlined style={{ fontSize: "16px", color: "#1890ff" }} />
              <span className="text-sm font-bold">本地设置</span>
            </div>

            <RightOutlined />
          </div>
        </div>
      </aside>

      <main className="workspace-main">
        <section className="workspace-brand">
          <Avatar
            shape="square"
            size={128}
            src={<img draggable={false} src="/icon.png" alt="avatar" />}
          />
          <h1>问渠</h1>
          <p>v0.1</p>
        </section>

        <section className="workspace-actions" aria-label="项目操作">
          <ActionRow
            title="添加本地项目"
            description="关联 API 所在机器上的已有本地目录"
            buttonLabel="添加"
            primary
            loading={creatingWorkspace}
            onClick={onNewWorkspace}
          />
        </section>
        {error && <div className="workspace-error">{error}</div>}
        {activeWorkspace && <WorkspaceLocalStoragePanel workspaceId={activeWorkspace.id} refreshKey={activeWorkspace.localPath ?? ""} />}
        {threads.length > 0 && (
          <div className="workspace-recent">
            最近对话：{threads[0]?.title || DEFAULT_CHAT_TITLE}
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * 工作台项目操作行，统一添加本地项目动作的布局。
 */
function ActionRow({
  title,
  description,
  buttonLabel,
  primary,
  loading,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  primary?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="workspace-action-row">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <Button
        type={primary ? "primary" : "default"}
        loading={loading}
        onClick={onClick}
      >
        {buttonLabel}
      </Button>
    </div>
  );
}
