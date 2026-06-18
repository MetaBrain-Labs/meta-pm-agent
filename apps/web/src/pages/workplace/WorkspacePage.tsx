import { Button } from "antd";
import type { AccountInfo, ThreadInfo, WorkspaceInfo } from "../../types";
import { DEFAULT_CHAT_TITLE } from "../../constants/app";

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
}

/**
 * 工作台首页，负责展示项目列表、账号入口和项目操作区。
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
}: WorkspacePageProps) {
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    null;

  return (
    <div className="workspace-shell">
      <aside className="workspace-projects">
        <div className="workspace-project-list">
          {workspaces.length > 0 ? (
            workspaces.map((workspace, index) => (
              <button
                key={workspace.id}
                type="button"
                className={`workspace-project-item ${
                  workspace.id === activeWorkspaceId ? "is-active" : ""
                }`}
                onClick={() => onOpenWorkspace(workspace.id)}
              >
                <span>
                  <strong>{workspace.name || "项目名称"}</strong>
                  {index === 0 && <em>上次打开</em>}
                </span>
                <small>
                  {workspace.localPath ||
                    workspace.cloudPath ||
                    "项目存储地址/云端地址"}
                </small>
                <i aria-hidden="true">›</i>
              </button>
            ))
          ) : (
            <div className="workspace-empty-projects">
              <strong>暂无项目</strong>
              <small>新建或打开一个项目后会显示在这里</small>
            </div>
          )}
        </div>
        <button
          type="button"
          className="workspace-account"
          onClick={onAccountInfo}
        >
          <AvatarMark src={account?.avatar} />
          <b>{account?.username || "Local User"}</b>
          <i aria-hidden="true">›</i>
        </button>
      </aside>

      <main className="workspace-main">
        <div className="window-controls" aria-hidden="true">
          <span>−</span>
          <span>×</span>
        </div>
        <section className="workspace-brand">
          <div className="workspace-logo" />
          <h1>问澜</h1>
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
 * 展示账号头像，缺省时使用账号入口的文字标识。
 */
function AvatarMark({ src }: { src?: string | null }) {
  return src ? (
    <img src={src} alt="" className="avatar-mark" />
  ) : (
    <span className="avatar-mark" aria-hidden="true">
      账
    </span>
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
