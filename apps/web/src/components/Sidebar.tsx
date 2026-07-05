/**
 * 工作区侧边栏
 *
 * 展示当前工作区导航、对话历史和工作区信息入口。侧边栏只负责用户导航动作，
 * 不直接加载聊天消息或文档生成状态。
 *
 * Responsibilities:
 * - 提供新建对话、知识图谱和策划产出文档入口
 * - 展示当前工作区的会话列表，每项支持点击弹出操作菜单
 * - 支持展开/收起状态
 *
 * Notes:
 * - 文档生成页面由上层路由切换，本组件只触发导航。
 * - 对话操作菜单通过点击 RightOutlined 图标触发 Dropdown popup。
 */

import { Layout, Button, Tooltip, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  ApartmentOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  LinuxOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  PushpinOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { ThreadInfo, WorkspaceInfo } from "../types";

const { Sider } = Layout;

type MenuItem = Required<MenuProps>["items"][number];

const TEXT = {
  appName: "问渠",
  emptyConversation: "还未有对话历史，创建一个新对话开始构建一款新产品吧！",
  expand: "展开侧边栏",
  collapse: "收起侧边栏",
  newConversation: "创建新对话",
  knowledge: "设计知识图谱",
  document: "策划产出文档",
  conversationHistory: "对话历史",
  today: "今天",
  account: "账号",
  untitledConversation: "对话总结对话总结对话总结对话总结对话对...",
  renameThread: "对话重命名",
  pinThread: "对话置顶",
  archiveThread: "对话归档",
  deleteThread: "删除对话",
};

interface Props {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  threads: ThreadInfo[];
  activeId: string | null;
  activeMode: "chat" | "documents";
  collapsed: boolean;
  creating: boolean;
  onWorkspaceInfo: () => void;
  onSelect: (id: string) => void;
  onDocuments: () => void;
  onNew: () => void | Promise<void>;
  onToggle: () => void;
  /** 对话重命名回调 */
  onThreadRename?: (id: string) => void;
  /** 对话置顶回调 */
  onThreadPin?: (id: string) => void;
  /** 对话归档回调 */
  onThreadArchive?: (id: string) => void;
  /** 删除对话回调 */
  onThreadDelete?: (id: string) => void;
}

/**
 * 对话操作 Dropdown 菜单项，点击对话行右侧图标弹出。
 */
const threadActionItems: MenuItem[] = [
  { key: "rename", icon: <EditOutlined />, label: "对话重命名" },
  { key: "pin", icon: <PushpinOutlined />, label: "对话置顶" },
  { key: "archive", icon: <InboxOutlined />, label: "对话归档" },
  { type: "divider" },
  { key: "delete", icon: <DeleteOutlined />, label: "删除对话", danger: true },
];

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  threads,
  activeId,
  activeMode,
  collapsed,
  creating,
  onWorkspaceInfo,
  onSelect,
  onDocuments,
  onNew,
  onToggle,
  onThreadRename,
  onThreadPin,
  onThreadArchive,
  onThreadDelete,
}: Props) {
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0];
  const navClassName = [
    "chat-nav",
    collapsed ? "is-collapsed" : "",
    activeMode === "documents" ? "is-documents" : "is-chat",
  ]
    .filter(Boolean)
    .join(" ");
  const documentButtonClassName =
    activeMode === "documents" ? "sidebar-nav-active" : "";
  const collapsedDocumentButtonClassName = [
    "sidebar-create",
    documentButtonClassName,
  ]
    .filter(Boolean)
    .join(" ");

  /** 处理对话操作菜单项点击 */
  const handleThreadAction = (threadId: string, action: string) => {
    switch (action) {
      case "rename":
        onThreadRename?.(threadId);
        break;
      case "pin":
        onThreadPin?.(threadId);
        break;
      case "archive":
        onThreadArchive?.(threadId);
        break;
      case "delete":
        onThreadDelete?.(threadId);
        break;
    }
  };

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={onToggle}
      trigger={null}
      width={304}
      collapsedWidth={72}
      className={`app-sidebar chat-sidebar h-screen !bg-white ${
        collapsed ? "is-collapsed" : "is-expanded"
      }`}
      style={{ position: "relative", zIndex: 2 }}
    >
      <div className={collapsed ? "chat-brand is-collapsed" : "chat-brand"}>
        {!collapsed && (
          <div className="chat-brand-mark">
            <span />
            <strong>{TEXT.appName}</strong>
          </div>
        )}
        <Tooltip title={collapsed ? TEXT.expand : TEXT.collapse}>
          <Button
            type="text"
            className="sidebar-toggle"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={onToggle}
          />
        </Tooltip>
      </div>

      <div className={navClassName}>
        {collapsed ? (
          <>
            <Tooltip title={TEXT.newConversation} placement="right">
              <Button
                className="sidebar-create"
                icon={<EditOutlined />}
                loading={creating}
                disabled={creating || !activeWorkspaceId}
                onClick={onNew}
              />
            </Tooltip>
            <Tooltip title={TEXT.knowledge} placement="right">
              <Button
                className="sidebar-create"
                icon={<ApartmentOutlined />}
                disabled={!activeWorkspaceId}
              />
            </Tooltip>
            <Tooltip title={TEXT.document} placement="right">
              <Button
                className={collapsedDocumentButtonClassName}
                type={activeMode === "documents" ? "primary" : "default"}
                icon={<FolderOpenOutlined />}
                disabled={!activeWorkspaceId}
                onClick={onDocuments}
              />
            </Tooltip>
          </>
        ) : (
          <>
            <Button
              icon={<EditOutlined />}
              block
              loading={creating}
              disabled={creating || !activeWorkspaceId}
              onClick={onNew}
            >
              {TEXT.newConversation}
            </Button>
            <Button
              icon={<ApartmentOutlined />}
              block
              disabled={!activeWorkspaceId}
            >
              {TEXT.knowledge}
            </Button>
            <Button
              icon={<FolderOpenOutlined />}
              block
              className={documentButtonClassName}
              type={activeMode === "documents" ? "primary" : "default"}
              disabled={!activeWorkspaceId}
              onClick={onDocuments}
            >
              {TEXT.document}
            </Button>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="chat-history-head">
          <h2>{TEXT.conversationHistory}</h2>
          {threads.length === 0 && <p>{TEXT.emptyConversation}</p>}
        </div>
      )}

      <div className="chat-history scrollbar-none">
        {!collapsed && threads.length > 0 && (
          <>
            <div className="chat-history-date">{TEXT.today}</div>
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`chat-thread ${
                  thread.id === activeId ? "is-active" : ""
                }`}
              >
                <div className="w-full flex justify-between items-center gap-2">
                  <div
                    className="flex-1 min-w-0 truncate cursor-pointer"
                    onClick={() => onSelect(thread.id)}
                  >
                    <span>{thread.title || TEXT.untitledConversation}</span>
                  </div>
                  <div>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: threadActionItems,
                        onClick: ({ key }) =>
                          handleThreadAction(thread.id, key),
                      }}
                    >
                      <MenuOutlined
                        className="cursor-pointer shrink-0 p-1 rounded hover:bg-gray-200 transition-colors"
                        style={{ fontSize: "12px", color: "#999" }}
                      />
                    </Dropdown>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {!collapsed && (
        <div className="w-full  p-4" onClick={onWorkspaceInfo}>
          <div className="flex items-center justify-between cursor-pointer rounded bg-white hover:bg-gray-100 p-2">
            <div className="flex items-center gap-2">
              <LinuxOutlined style={{ fontSize: "16px", color: "#1890ff" }} />
              <span className="text-sm font-bold">
                {activeWorkspace?.name || TEXT.account}
              </span>
            </div>

            <RightOutlined style={{ fontSize: "12px", color: "#1890ff" }} />
          </div>
        </div>
      )}
    </Sider>
  );
}
