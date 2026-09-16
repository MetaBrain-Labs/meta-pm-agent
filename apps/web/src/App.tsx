/**
 * 应用入口组件
 *
 * 负责挂载全局 Provider、应用外壳布局和顶层页面选择。项目内部页面共用同一
 * 个工作区外壳，因此 Workspace Header 与右侧面板不会随路由切换重新挂载。
 *
 * Responsibilities:
 * - 挂载 Ant Design 主题与本地化配置
 * - 组合全局侧边栏、项目列表页与项目内部工作区外壳
 * - 挂载项目创建、重命名与配置弹窗
 *
 * Notes:
 * - 不在此处承载页面级业务逻辑、API 调用或 SSE 消费。
 * - 工作区面板标识由 useAppShell 持有，是 Tabs 与面板内容的唯一来源。
 */

import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AppShell } from "./components/shell/AppShell";
import { AppSidebar, SidebarUserArea } from "./components/shell/AppSidebar";
import { WorkspacePanelContent } from "./components/shell/WorkspacePanelContent";
import { WorkspaceShell } from "./components/shell/WorkspaceShell";
import { WorkspaceSyncStatus } from "./components/shell/WorkspaceSyncStatus";
import { ProjectOverviewPanel } from "./components/shell/ProjectOverviewPanel";
import { ConfigModal } from "./components/modals/ConfigModal";
import { ProjectCreateModal } from "./components/modals/ProjectCreateModal";
import { TextValueModal } from "./components/modals/TextValueModal";
import { useAppShell } from "./hooks/useAppShell";
import { useRegisteredPanelRenderer } from "./hooks/useRegisteredPanelRenderer";
import { ThreadChatPage } from "./pages/chat/ThreadChatPage";
import { DocumentPlanningPage } from "./pages/documents/DocumentPlanningPage";
import { WorkspacePage } from "./pages/workplace/WorkspacePage";
import { APP_THEME } from "./theme/app-theme";

/**
 * 应用入口，保留 Provider 和页面组合，不承载页面内部业务逻辑。
 */
export default function App() {
  const app = useAppShell();
  /**
   * 任务历史与知识图谱面板的渲染函数。
   *
   * 两者数据都只存在于聊天页面（当前会话消息、工作区图谱），因此由聊天页登记
   * 渲染函数，外壳只负责把它放进面板容器，无需把状态提升到这一层。
   * 登记契约见 useRegisteredPanelRenderer：不能把 setState 直接当回调传。
   */
  const [tasksPanel, handleTasksPanelChange] = useRegisteredPanelRenderer();
  const [graphPanel, handleGraphPanelChange] = useRegisteredPanelRenderer();
  const inProject =
    app.route.name !== "workspace" && Boolean(app.activeWorkspaceId);

  return (
    <ConfigProvider theme={APP_THEME} locale={zhCN}>
      <AntdApp className="h-screen">
        <AppShell
          collapsed={app.sidebarCollapsed}
          onCollapsedChange={app.handleSidebarCollapsedChange}
          sidebarFooter={
            <SidebarUserArea
              onOpenSettings={() => app.openConfigModal("workspace")}
            />
          }
          sidebar={
            <AppSidebar
              workspaceName={app.activeWorkspaceName}
              threads={app.activeWorkspaceId ? app.threads : []}
              activeThreadId={app.activeThread?.id ?? null}
              activeMode={app.route.name === "documents" ? "documents" : "chat"}
              collapsed={app.sidebarCollapsed}
              creatingThread={app.isCreatingChat}
              onNewThread={app.handleNewChat}
              onOpenProjects={app.handleBackToWorkspaceList}
              onOpenDocuments={app.handleOpenDocuments}
              onSelectThread={app.handleSelectThread}
              onThreadRename={app.handleThreadRename}
              onThreadDelete={app.handleThreadDelete}
            />
          }
        >
          {inProject ? (
            <WorkspaceShell
              workspaceName={app.activeWorkspaceName}
              activePanel={app.workspacePanel}
              onPanelChange={app.handleWorkspacePanelChange}
              /*
               * 项目本地同步是工作区级状态，统一放在 Header 右侧：
               * 平时只是一个轻量内联状态，点击后才展开详情浮层。
               */
              actions={
                app.activeWorkspaceId ? (
                  <WorkspaceSyncStatus
                    workspaceId={app.activeWorkspaceId}
                    workspaceName={app.activeWorkspaceName}
                    workspacePath={app.activeWorkspace?.localPath}
                  />
                ) : null
              }
              /*
               * 交付文档是当前唯一已接入的面板；其余面板保留空态。
               * 无对话栏时不挂载聊天，交付文档面板直接占满剩余空间。
               */
              conversation={
                app.route.name === "chat" ? (
                  <ThreadChatPage
                    workspaceId={app.activeWorkspaceId}
                    workspaceName={app.activeWorkspaceName}
                    thread={app.activeThread}
                    creationError={app.creationError}
                    onNewThread={app.handleNewThread}
                    onThreadMessageStarted={app.handleThreadMessageStarted}
                    onThreadTitleChange={app.handleThreadTitleChange}
                    onBack={app.handleBackToWorkspaceList}
                    onTasksPanelChange={handleTasksPanelChange}
                    onGraphPanelChange={handleGraphPanelChange}
                  />
                ) : null
              }
              panel={() => (
                <WorkspacePanelContent
                  panelId={app.workspacePanel}
                  overview={() => (
                    <ProjectOverviewPanel
                      workspaceId={app.activeWorkspaceId ?? ""}
                      workspaceName={app.activeWorkspaceName}
                      workspacePath={app.activeWorkspace?.localPath}
                      threadCount={app.threads.length}
                      lastConversationAt={app.threads[0]?.updatedAt ?? null}
                      onPanelChange={app.handleWorkspacePanelChange}
                      onNewConversation={() =>
                        app.handleOpenWorkspace(app.activeWorkspaceId ?? "")
                      }
                    />
                  )}
                  tasks={tasksPanel ?? undefined}
                  graph={graphPanel ?? undefined}
                  graphWorkspaceId={app.activeWorkspaceId ?? undefined}
                  onOpenConversation={() =>
                    app.handleOpenWorkspace(app.activeWorkspaceId ?? "")
                  }
                  documents={() => (
                    <DocumentPlanningPage
                      embedded
                      hideGraph
                      workspaceId={app.activeWorkspaceId ?? ""}
                      workspaceName={app.activeWorkspaceName}
                      onBack={app.handleBackToWorkspaceList}
                      onOpenEvidenceThread={
                        app.handleOpenDocumentEvidenceThread
                      }
                    />
                  )}
                />
              )}
            />
          ) : (
            <WorkspacePage
              workspaces={app.workspaces}
              activeWorkspaceId={app.activeWorkspaceId}
              threads={app.threads}
              error={app.creationError}
              creatingWorkspace={app.isCreatingWorkspace}
              onOpenWorkspace={app.handleOpenWorkspace}
              onNewWorkspace={app.openProjectModal}
              onLocalSettings={() => app.openConfigModal("models")}
              onWorkspaceRename={app.handleWorkspaceRename}
              onWorkspaceMigrate={app.handleWorkspaceMigrate}
              onWorkspaceRemove={app.handleWorkspaceRemove}
            />
          )}
        </AppShell>

        <ProjectCreateModal
          mode={app.projectModalMode}
          open={app.projectModalOpen}
          form={app.projectForm}
          locationHint={app.projectLocationHint}
          creating={app.isCreatingWorkspace}
          onDirectorySelect={app.handleDirectorySelect}
          onCreate={app.handleNewWorkspace}
          onCancel={() => app.setProjectModalOpen(false)}
        />
        <TextValueModal
          open={Boolean(app.renameTarget)}
          title={
            app.renameTarget?.kind === "workspace" ? "项目重命名" : "对话重命名"
          }
          label={
            app.renameTarget?.kind === "workspace" ? "项目名称" : "对话标题"
          }
          value={app.renameValue}
          saving={app.savingRename}
          onChange={app.setRenameValue}
          onSave={app.handleSaveRename}
          onCancel={() => app.setRenameTarget(null)}
        />
        <ConfigModal
          open={app.configModalOpen}
          activeTab={app.configTab}
          showWorkspace={app.configWorkspaceVisible}
          workspaceRows={[
            ["名称", app.activeWorkspace?.name ?? "-"],
            ["本地路径", app.activeWorkspace?.localPath ?? "-"],
          ]}
          onTabChange={app.setConfigTab}
          onClose={() => app.setConfigModalOpen(false)}
        />
      </AntdApp>
    </ConfigProvider>
  );
}
