/**
 * 应用入口组件
 *
 * 负责挂载全局 Provider、应用外壳布局和顶层页面选择。具体聊天、文档生成、
 * 工作区列表和弹窗内部逻辑分别下沉到对应页面、组件和 hook。
 *
 * Responsibilities:
 * - 挂载 Ant Design 主题与本地化配置
 * - 根据当前路由组合侧边栏和工作区详情页
 * - 挂载项目创建与配置弹窗
 *
 * Notes:
 * - 不在此处承载页面级业务逻辑、API 调用或 SSE 消费。
 */

import { ConfigProvider, Layout } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Sidebar } from "./components/Sidebar";
import { ConfigModal } from "./components/modals/ConfigModal";
import { ProjectCreateModal } from "./components/modals/ProjectCreateModal";
import { useAppShell } from "./hooks/useAppShell";
import { ThreadChatPage } from "./pages/chat/ThreadChatPage";
import { DocumentPlanningPage } from "./pages/documents/DocumentPlanningPage";
import { WorkspacePage } from "./pages/workplace/WorkspacePage";
import { APP_THEME } from "./theme/app-theme";

/**
 * 应用入口，保留 Provider 和页面组合，不承载页面内部业务逻辑。
 */
export default function App() {
  const app = useAppShell();

  return (
    <ConfigProvider theme={APP_THEME} locale={zhCN}>
      <Layout className="h-screen app-shell" style={{ gap: 0 }}>
        {app.workspaceDetailOpen && app.activeWorkspaceId ? (
          <>
            <Sidebar
              workspaces={app.workspaces}
              activeWorkspaceId={app.activeWorkspaceId}
              threads={app.threads}
              activeId={app.activeThread?.id ?? null}
              activeMode={app.route.name === "documents" ? "documents" : "chat"}
              collapsed={app.sidebarCollapsed}
              creating={app.isCreatingChat}
              onWorkspaceInfo={() => app.openConfigModal("workspace")}
              onSelect={app.handleSelectThread}
              onDocuments={app.handleOpenDocuments}
              onNew={app.handleNewChat}
              onToggle={() => app.setSidebarCollapsed(!app.sidebarCollapsed)}
            />
            <Layout style={{ background: "transparent" }}>
              {app.route.name === "documents" ? (
                <DocumentPlanningPage
                  workspaceId={app.activeWorkspaceId}
                  workspaceName={app.activeWorkspaceName}
                  onBack={app.handleBackToWorkspaceList}
                />
              ) : (
                <ThreadChatPage
                  workspaceId={app.activeWorkspaceId}
                  workspaceName={app.activeWorkspaceName}
                  thread={app.activeThread}
                  creationError={app.creationError}
                  onNewThread={app.handleNewThread}
                  onThreadMessageStarted={app.handleThreadMessageStarted}
                  onThreadTitleChange={app.handleThreadTitleChange}
                  onBack={app.handleBackToWorkspaceList}
                />
              )}
            </Layout>
          </>
        ) : (
          <WorkspacePage
            workspaces={app.workspaces}
            activeWorkspaceId={app.activeWorkspaceId}
            threads={app.threads}
            account={app.account}
            error={app.creationError}
            creating={app.isCreatingChat}
            creatingWorkspace={app.isCreatingWorkspace}
            onOpenWorkspace={app.handleOpenWorkspace}
            onNewWorkspace={app.openProjectModal}
            onAccountInfo={() => app.openConfigModal("account")}
            onOpenProject={() => {
              if (app.activeWorkspaceId) {
                app.handleOpenWorkspace(app.activeWorkspaceId);
                return;
              }
              void app.handleNewChat();
            }}
          />
        )}
      </Layout>

      <ProjectCreateModal
        open={app.projectModalOpen}
        form={app.projectForm}
        locationHint={app.projectLocationHint}
        creating={app.isCreatingWorkspace}
        directoryInputRef={app.directoryInputRef}
        onBrowseDirectory={app.handleBrowseDirectory}
        onDirectoryInputChange={app.handleDirectoryInputChange}
        onCreate={app.handleNewWorkspace}
        onCancel={() => app.setProjectModalOpen(false)}
      />
      <ConfigModal
        open={app.configModalOpen}
        activeTab={app.configTab}
        showWorkspace={app.configWorkspaceVisible}
        accountRows={[
          ["账号 ID", app.account?.id ?? "-"],
          ["用户名", app.account?.username ?? "Local User"],
          ["邮箱", app.account?.email ?? "-"],
          ["头像", app.account?.avatar ?? "默认头像"],
        ]}
        workspaceRows={[
          ["工作区 ID", app.activeWorkspace?.id ?? "-"],
          ["名称", app.activeWorkspace?.name ?? "-"],
          ["本地路径", app.activeWorkspace?.localPath ?? "-"],
          ["存储类型", app.activeWorkspace?.storageType ?? "-"],
          ["同步状态", app.activeWorkspace?.syncStatus ?? "-"],
        ]}
        onTabChange={app.setConfigTab}
        onClose={() => app.setConfigModalOpen(false)}
      />
    </ConfigProvider>
  );
}
