/**
 * 工作区侧边栏
 *
 * 展示当前工作区导航、对话历史和工作区信息入口。侧边栏只负责用户导航动作，
 * 不直接加载聊天消息或文档生成状态。
 *
 * Responsibilities:
 * - 提供新建对话、知识图谱和策划产出文档入口
 * - 展示当前工作区的会话列表
 * - 支持展开/收起状态
 *
 * Notes:
 * - 文档生成页面由上层路由切换，本组件只触发导航。
 */

import { Layout, Button, Tooltip } from "antd";
import {
  ApartmentOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LinuxOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { ThreadInfo, WorkspaceInfo } from "../types";

const { Sider } = Layout;

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
}

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
              <button
                key={thread.id}
                type="button"
                className={`chat-thread ${
                  thread.id === activeId ? "is-active" : ""
                }`}
                onClick={() => onSelect(thread.id)}
              >
                <div className="w-full flex justify-between items-center">
                  <span>{thread.title || TEXT.untitledConversation}</span>
                  <div>{<DeleteOutlined />}</div>
                </div>
              </button>
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
