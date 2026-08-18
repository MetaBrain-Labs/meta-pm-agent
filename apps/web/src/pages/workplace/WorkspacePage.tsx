import { Avatar, Button, Menu } from "antd";
import type { MenuProps } from "antd";
import type { AccountInfo, ThreadInfo, WorkspaceInfo } from "../../types";
import { DEFAULT_CHAT_TITLE } from "../../constants/app";
import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinuxOutlined,
  RightOutlined,
  SwapOutlined,
} from "@ant-design/icons";

type MenuItem = Required<MenuProps>["items"][number];

const PROJECT_ACTIONS = {
  rename: "项目重命名",
  migrate: "项目路径迁移",
  openExplorer: "在资源管理器打开",
  remove: "从列表中移除",
};

interface WorkspacePageProps {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  threads: ThreadInfo[];
  account: AccountInfo | null;
  error: string | null;
  creating: boolean;
  creatingWorkspace: boolean;
  onOpenWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onAccountInfo: () => void;
  onOpenProject: () => void;
  /** 项目重命名回调 */
  onWorkspaceRename?: (id: string) => void;
  /** 项目路径迁移回调 */
  onWorkspaceMigrate?: (id: string) => void;
  /** 在资源管理器打开项目 */
  onWorkspaceOpenExplorer?: (id: string) => void;
  /** 从列表中移除项目 */
  onWorkspaceRemove?: (id: string) => void;
}

/**
 * 工作台首页，负责展示项目列表、账号入口和项目操作区。
 *
 * 项目列表使用 Menu 组件渲染，每个项目为一个 SubMenu，鼠标移入时
 * 展示项目操作项（重命名、路径迁移、资源管理器打开、移除）。
 */
export function WorkspacePage({
  workspaces,
  activeWorkspaceId,
  threads,
  account,
  error,
  creating,
  creatingWorkspace,
  onOpenWorkspace,
  onNewWorkspace,
  onAccountInfo,
  onOpenProject,
  onWorkspaceRename,
  onWorkspaceMigrate,
  onWorkspaceOpenExplorer,
  onWorkspaceRemove,
}: WorkspacePageProps) {
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    null;

  // 当前激活的项目 key，用于 Menu 高亮
  const selectedKeys: string[] = activeWorkspaceId ? [activeWorkspaceId] : [];

  // 将项目列表映射为 SubMenu 菜单项
  const projectMenuItems: MenuItem[] = workspaces.map((workspace, index) => ({
    key: workspace.id,
    label: (
      <div className="flex flex-col">
        <div className="flex items-center">
          <span className="text-base leading-snug font-bold">
            {workspace.name || "项目名称"}
          </span>
          {activeWorkspace.id === workspace.id && (
            <em className="ml-1.5 rounded bg-[rgb(102,157,235)] px-1.5 py-1 text-[12px] leading-none text-gray-400 not-italic">
              <span className="text-[#ffffff]">上次打开</span>
            </em>
          )}
        </div>
        <small className="mt-1 inline-block max-w-[240px] truncate text-xs text-gray-400">
          {workspace.localPath ||
            workspace.cloudPath ||
            "项目存储地址/云端地址"}
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
        key: `${workspace.id}:open-explorer`,
        icon: <FolderOpenOutlined />,
        label: PROJECT_ACTIONS.openExplorer,
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
      case "open-explorer":
        onWorkspaceOpenExplorer?.(workspaceId);
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
                  新建或打开一个项目后会显示在这里
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="w-full  p-4" onClick={onAccountInfo}>
          <div className="flex items-center justify-between cursor-pointer rounded bg-white hover:bg-gray-100 p-2">
            <div className="flex items-center gap-2">
              <LinuxOutlined style={{ fontSize: "16px", color: "#1890ff" }} />
              <span className="text-sm font-bold">
                {account?.username || "Local User"}
              </span>
            </div>

            <RightOutlined />
          </div>
        </div>
      </aside>

      <main className="workspace-main">
        <div className="window-controls" aria-hidden="true">
          <span>−</span>
          <span>×</span>
        </div>
        <section className="workspace-brand">
          <Avatar
            shape="square"
            size={128}
            src={<img draggable={false} src="/icon.svg" alt="avatar" />}
          />
          <h1>问渠</h1>
          <p>V1.01</p>
        </section>

        <section className="workspace-actions" aria-label="项目操作">
          <ActionRow
            title="新建项目"
            description="在指定文件夹下创建一个新的项目"
            buttonLabel="创建"
            primary
            loading={creatingWorkspace}
            onClick={onNewWorkspace}
          />
          <ActionRow
            title="打开项目"
            description={
              activeWorkspace
                ? `打开 ${activeWorkspace.name}`
                : "将指定本地文件夹作为项目打开"
            }
            buttonLabel="打开"
            loading={creating}
            onClick={onOpenProject}
          />
          <ActionRow
            title="云端同步"
            description="将远程服务中的项目同步至本地"
            buttonLabel="同步"
            primary
            onClick={onOpenProject}
          />
        </section>
        {error && <div className="workspace-error">{error}</div>}
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
 * 工作台项目操作行，统一新建、打开和同步动作的布局。
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
