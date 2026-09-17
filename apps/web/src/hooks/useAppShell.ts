/**
 * 应用外壳状态 Hook
 *
 * 管理工作区、会话、顶层路由、弹窗和侧边栏状态，为 App 组件提供轻量的页面
 * 组合数据与回调。页面内部的数据加载与流式任务由各页面自行管理。
 *
 * Responsibilities:
 * - 同步浏览器路径与当前工作区/会话/文档页状态
 * - 加载本地工作区和会话列表
 * - 提供工作区、会话的创建、重命名、软删除和导航动作
 *
 * Notes:
 * - 不直接消费聊天 SSE，也不管理文档生成后台轮询。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Form } from "antd";
import type { ThreadInfo, WorkspaceInfo } from "../types";
import type { ConfigTab } from "../components/modals/ConfigModal";
import type { WorkspacePanelId } from "../components/shell/workspace-panels";
import {
  createChatRecord,
  createWorkspaceRecord,
  deleteChatRecord,
  deleteWorkspaceRecord,
  fetchChatRecords,
  fetchWorkspaces,
  updateChatRecord,
  updateWorkspaceRecord,
} from "../api/chat-api";
import {
  ACTIVE_WORKSPACE_KEY,
  DEFAULT_CHAT_TITLE,
  DEFAULT_WORKSPACE_NAME,
} from "../constants/app";
import {
  buildChatPath,
  buildDocumentsPath,
  parseAppRoute,
  pushPath,
  replacePath,
  type AppRoute,
} from "../router/app-route";
import { mapErrorToChinese } from "../utils/errors";

const DEFAULT_DRAFT_CHAT_TITLES = new Set([DEFAULT_CHAT_TITLE, "New Chat"]);

/**
 * 管理应用外壳的顶层状态、路由同步和跨页面动作。
 */
export function useAppShell() {
  const { modal } = App.useApp();
  const [projectForm] = Form.useForm<{ name: string; location?: string }>();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_WORKSPACE_KEY),
  );
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectModalMode, setProjectModalMode] = useState<"create" | "path">(
    "create",
  );
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [renameTarget, setRenameTarget] = useState<{
    kind: "workspace" | "thread";
    id: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configTab, setConfigTab] = useState<ConfigTab>("models");
  const [configWorkspaceVisible, setConfigWorkspaceVisible] = useState(false);
  const [projectLocationHint, setProjectLocationHint] = useState(false);
  const [workspaceDetailOpen, setWorkspaceDetailOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanelId>(() =>
    parseAppRoute().name === "documents" ? "documents" : "overview",
  );
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute());
  const previousWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);

  const restoreWorkspaces = useCallback((serverWorkspaces: WorkspaceInfo[]) => {
    setWorkspaces(serverWorkspaces);
    const storedWorkspaceId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const nextWorkspaceId =
      serverWorkspaces.find((workspace) => workspace.id === storedWorkspaceId)
        ?.id ??
      serverWorkspaces[0]?.id ??
      null;

    setActiveWorkspaceId(nextWorkspaceId);
    if (nextWorkspaceId) {
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, nextWorkspaceId);
    }
  }, []);

  useEffect(() => {
    if (window.location.pathname === "/") {
      replacePath("/workplace");
    }

    const handlePopState = () => {
      setRoute(parseAppRoute());
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (route.name === "workspace") {
      setWorkspaceDetailOpen(false);
      setActiveThreadId(null);
      return;
    }

    setWorkspaceDetailOpen(true);
    setActiveWorkspaceId(route.workspaceId);
    setActiveThreadId(route.name === "chat" ? route.threadId : null);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, route.workspaceId);
  }, [route]);

  useEffect(() => {
    // 切换工作区时回到项目概览；首屏与同一工作区内的会话、路由切换都保留当前面板。
    if (previousWorkspaceIdRef.current === activeWorkspaceId) return;
    previousWorkspaceIdRef.current = activeWorkspaceId;
    setWorkspacePanel("overview");
  }, [activeWorkspaceId]);

  useEffect(() => {
    // 直接访问 /documents/:workspaceId 时对齐交付文档面板。
    if (route.name === "documents") setWorkspacePanel("documents");
  }, [route.name]);

  useEffect(() => {
    let cancelled = false;

    fetchWorkspaces()
      .then((serverWorkspaces) => {
        if (cancelled) return;
        restoreWorkspaces(serverWorkspaces);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[workspace] Failed to load workspaces:", error);
        setCreationError(mapErrorToChinese(error));
      })
      .finally(() => {
        if (!cancelled) setWorkspacesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [restoreWorkspaces]);

  useEffect(() => {
    if (!workspacesLoaded || route.name === "workspace") return;
    if (workspaces.some((workspace) => workspace.id === route.workspaceId)) {
      return;
    }
    replacePath("/workplace");
    setRoute(parseAppRoute());
  }, [route, workspaces, workspacesLoaded]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setThreads([]);
      setActiveThreadId(null);
      return;
    }

    let cancelled = false;

    fetchChatRecords(activeWorkspaceId)
      .then((serverThreads) => {
        if (cancelled) return;
        setThreads(serverThreads);
        const routeThreadId =
          route.name === "chat" && route.workspaceId === activeWorkspaceId
            ? route.threadId
            : null;
        const routeThreadExists = serverThreads.some(
          (thread) => thread.id === routeThreadId,
        );
        if (routeThreadId && !routeThreadExists) {
          replacePath(buildChatPath(activeWorkspaceId));
          setRoute(parseAppRoute());
          setActiveThreadId(null);
        } else {
          setActiveThreadId(routeThreadId);
        }
        setCreationError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[chat] Failed to load chats:", error);
        setCreationError(mapErrorToChinese(error));
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, route]);

  const handleNewThread = useCallback((newThread: ThreadInfo) => {
    setCreationError(null);
    setWorkspaceDetailOpen(true);
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
    pushPath(buildChatPath(newThread.workspaceId, newThread.id));
  }, []);

  /**
   * 打开文档证据阻断专用会话；仅首次创建时附带自动启动标记。
   */
  const handleOpenDocumentEvidenceThread = useCallback(
    (thread: ThreadInfo, autoStart: boolean) => {
      setCreationError(null);
      setWorkspaceDetailOpen(true);
      setThreads((prev) => [
        thread,
        ...prev.filter((item) => item.id !== thread.id),
      ]);
      setActiveThreadId(thread.id);
      const path = buildChatPath(thread.workspaceId, thread.id);
      pushPath(autoStart ? `${path}?documentEvidence=1` : path);
    },
    [],
  );

  const handleThreadTitleChange = useCallback(
    (threadId: string, title: string) => {
      // SSE 标题更新只改对应会话，避免刷新整个列表打断当前聊天流。
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId ? { ...thread, title } : thread,
        ),
      );
    },
    [],
  );

  const handleThreadMessageStarted = useCallback((threadId: string) => {
    // 用户首条消息开始发送后，该会话不再视为空白新对话。
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId
          ? { ...thread, messageCount: Math.max(thread.messageCount ?? 0, 1) }
          : thread,
      ),
    );
  }, []);

  const handleSelectThread = useCallback(
    (id: string) => {
      const workspaceId = activeWorkspaceId;
      if (workspaceId) {
        pushPath(buildChatPath(workspaceId, id));
      }
      setWorkspaceDetailOpen(true);
      setActiveThreadId(id);
    },
    [activeWorkspaceId],
  );

  const handleOpenWorkspace = useCallback((id: string) => {
    pushPath(buildChatPath(id));
    setActiveWorkspaceId(id);
    setActiveThreadId(null);
    setWorkspaceDetailOpen(true);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  }, []);

  const handleOpenDocuments = useCallback(() => {
    if (!activeWorkspaceId) return;

    pushPath(buildDocumentsPath(activeWorkspaceId));
    setWorkspaceDetailOpen(true);
    setActiveThreadId(null);
    setWorkspacePanel("documents");
  }, [activeWorkspaceId]);

  const handleBackToWorkspaceList = useCallback(() => {
    pushPath("/workplace");
    setWorkspaceDetailOpen(false);
    setActiveThreadId(null);
  }, []);

  /** 侧边栏收起状态回调；保持引用稳定，避免外壳媒体查询反复重订阅。 */
  const handleSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
  }, []);

  /** 切换工作区面板；只影响展示状态，不改变路由或挂载结构。 */
  const handleWorkspacePanelChange = useCallback((panelId: WorkspacePanelId) => {
    setWorkspacePanel(panelId);
  }, []);

  const openConfigModal = useCallback((tab: ConfigTab) => {
    setConfigWorkspaceVisible(tab === "workspace");
    setConfigTab(tab);
    setConfigModalOpen(true);
  }, []);

  const openProjectModal = useCallback(() => {
    setProjectModalMode("create");
    setEditingWorkspaceId(null);
    setProjectLocationHint(false);
    projectForm.setFieldsValue({
      name: `${DEFAULT_WORKSPACE_NAME} ${workspaces.length + 1}`,
      location: "",
    });
    setProjectModalOpen(true);
  }, [projectForm, workspaces.length]);

  /** 打开现有工作区的本地路径修改弹窗。 */
  const handleWorkspaceMigrate = useCallback(
    (id: string) => {
      const workspace = workspaces.find((item) => item.id === id);
      if (!workspace) return;
      setProjectModalMode("path");
      setEditingWorkspaceId(id);
      setProjectLocationHint(false);
      projectForm.setFieldsValue({
        name: workspace.name,
        location: workspace.localPath ?? "",
      });
      setProjectModalOpen(true);
    },
    [projectForm, workspaces],
  );

  /** 将用户确认的 API 主机绝对目录同步到项目表单。 */
  const handleDirectorySelect = useCallback(
    (directoryPath: string) => {
      projectForm.setFieldValue("location", directoryPath);
      setProjectLocationHint(false);
    },
    [projectForm],
  );

  const handleNewWorkspace = useCallback(async () => {
    if (isCreatingWorkspace) return;

    let values: { name: string; location?: string };
    try {
      values = await projectForm.validateFields();
    } catch {
      return;
    }

    if (!values.location?.trim()) {
      setProjectLocationHint(true);
      return;
    }

    setIsCreatingWorkspace(true);

    try {
      if (projectModalMode === "path" && editingWorkspaceId) {
        const updatedWorkspace = await updateWorkspaceRecord(
          editingWorkspaceId,
          { localPath: values.location.trim() },
        );
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace,
          ),
        );
        setCreationError(null);
        setProjectModalOpen(false);
        projectForm.resetFields();
        if (updatedWorkspace.localStorageWarnings?.length) {
          modal.warning({ title: "路径已更新，部分本地文件未同步", content: updatedWorkspace.localStorageWarnings.join(" ") });
        }
        return;
      }

      const newWorkspace = await createWorkspaceRecord(
        values.name.trim(),
        values.location.trim(),
      );
      setWorkspaces((prev) => [newWorkspace, ...prev]);
      setActiveWorkspaceId(newWorkspace.id);
      setActiveThreadId(null);
      setWorkspaceDetailOpen(true);
      pushPath(buildChatPath(newWorkspace.id));
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, newWorkspace.id);
      setCreationError(null);
      setProjectModalOpen(false);
      projectForm.resetFields();
    } catch (error) {
      console.error("[workspace] Failed to save workspace:", error);
      const message = mapErrorToChinese(error);
      setCreationError(message);
      modal.error({ title: "项目未保存", content: message });
    } finally {
      setIsCreatingWorkspace(false);
    }
  }, [editingWorkspaceId, isCreatingWorkspace, projectForm, projectModalMode]);

  /** 打开工作区重命名弹窗。 */
  const handleWorkspaceRename = useCallback(
    (id: string) => {
      const workspace = workspaces.find((item) => item.id === id);
      if (!workspace) return;
      setRenameTarget({ kind: "workspace", id });
      setRenameValue(workspace.name);
    },
    [workspaces],
  );

  /** 打开会话重命名弹窗。 */
  const handleThreadRename = useCallback(
    (id: string) => {
      const thread = threads.find((item) => item.id === id);
      if (!thread) return;
      setRenameTarget({ kind: "thread", id });
      setRenameValue(thread.title);
    },
    [threads],
  );

  /** 保存当前重命名目标。 */
  const handleSaveRename = useCallback(async () => {
    const value = renameValue.trim();
    if (!renameTarget || !value || savingRename) return;
    setSavingRename(true);
    try {
      if (renameTarget.kind === "workspace") {
        const workspace = await updateWorkspaceRecord(renameTarget.id, {
          name: value,
        });
        setWorkspaces((prev) =>
          prev.map((item) => (item.id === workspace.id ? workspace : item)),
        );
      } else {
        const thread = await updateChatRecord(renameTarget.id, value);
        setThreads((prev) =>
          prev.map((item) => (item.id === thread.id ? thread : item)),
        );
      }
      setRenameTarget(null);
      setCreationError(null);
    } catch (error) {
      const message = mapErrorToChinese(error);
      setCreationError(message);
      modal.error({ title: "名称未保存", content: message });
    } finally {
      setSavingRename(false);
    }
  }, [renameTarget, renameValue, savingRename]);

  /** 确认后从项目列表软删除工作区。 */
  const handleWorkspaceRemove = useCallback(
    (id: string) => {
      const workspace = workspaces.find((item) => item.id === id);
      if (!workspace) return;
      modal.confirm({
        title: `从列表移除“${workspace.name}”？`,
        content: "只会隐藏项目记录，不会删除本地目录、文件、对话、图谱或文档。v0.1 暂无回收站入口。",
        okText: "从列表移除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await deleteWorkspaceRecord(id);
            setWorkspaces((prev) => prev.filter((item) => item.id !== id));
            if (activeWorkspaceId === id) {
              localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
              setActiveWorkspaceId(null);
              setActiveThreadId(null);
              setThreads([]);
              replacePath("/workplace");
              setRoute(parseAppRoute());
            }
            setCreationError(null);
          } catch (error) {
            const message = mapErrorToChinese(error);
            setCreationError(message);
            modal.error({ title: "项目未移除", content: message });
          }
        },
      });
    },
    [activeWorkspaceId, workspaces],
  );

  /** 确认后软删除会话，并在删除当前会话时跳转到下一条或空白页。 */
  const handleThreadDelete = useCallback(
    (id: string) => {
      const thread = threads.find((item) => item.id === id);
      if (!thread) return;
      modal.confirm({
        title: `删除对话“${thread.title}”？`,
        content: "对话将从历史列表隐藏；v0.1 暂不提供恢复入口。",
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await deleteChatRecord(id);
            const remaining = threads.filter((item) => item.id !== id);
            setThreads(remaining);
            if (activeThreadId === id && activeWorkspaceId) {
              const next = remaining[0];
              const nextPath = next
                ? buildChatPath(activeWorkspaceId, next.id)
                : buildChatPath(activeWorkspaceId);
              setActiveThreadId(next?.id ?? null);
              pushPath(nextPath);
            }
            setCreationError(null);
          } catch (error) {
            const message = mapErrorToChinese(error);
            setCreationError(message);
            modal.error({ title: "对话未删除", content: message });
          }
        },
      });
    },
    [activeThreadId, activeWorkspaceId, threads],
  );

  const handleNewChat = useCallback(async () => {
    if (isCreatingChat || !activeWorkspaceId) return;

    const reusableDraftThread = findReusableDraftThread(
      threads,
      activeThreadId,
    );
    if (reusableDraftThread) {
      setCreationError(null);
      setWorkspaceDetailOpen(true);
      setActiveThreadId(reusableDraftThread.id);
      pushPath(buildChatPath(activeWorkspaceId, reusableDraftThread.id));
      return;
    }

    setIsCreatingChat(true);

    try {
      const newThread = await createChatRecord(
        activeWorkspaceId,
        DEFAULT_CHAT_TITLE,
      );
      handleNewThread(newThread);
    } catch (error) {
      console.error("[chat] Failed to create chat:", error);
      setCreationError(mapErrorToChinese(error));
    } finally {
      setIsCreatingChat(false);
    }
  }, [
    activeThreadId,
    activeWorkspaceId,
    handleNewThread,
    isCreatingChat,
    threads,
  ]);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeThread =
    threads.find((thread) => thread.id === activeThreadId) ?? null;

  return {
    activeThread,
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceName: activeWorkspace?.name ?? DEFAULT_WORKSPACE_NAME,
    configModalOpen,
    configTab,
    configWorkspaceVisible,
    creationError,
    handleBackToWorkspaceList,
    handleDirectorySelect,
    handleNewChat,
    handleNewThread,
    handleThreadMessageStarted,
    handleThreadTitleChange,
    handleNewWorkspace,
    handleOpenDocuments,
    handleOpenDocumentEvidenceThread,
    handleOpenWorkspace,
    handleSelectThread,
    handleSaveRename,
    handleSidebarCollapsedChange,
    handleThreadDelete,
    handleThreadRename,
    handleWorkspaceMigrate,
    handleWorkspacePanelChange,
    handleWorkspaceRemove,
    handleWorkspaceRename,
    isCreatingChat,
    isCreatingWorkspace,
    openConfigModal,
    openProjectModal,
    projectForm,
    projectLocationHint,
    projectModalOpen,
    projectModalMode,
    renameTarget,
    renameValue,
    savingRename,
    setConfigModalOpen,
    setConfigTab,
    setProjectModalOpen,
    setRenameTarget,
    setRenameValue,
    setSidebarCollapsed,
    sidebarCollapsed,
    threads,
    workspacePanel,
    route,
    workspaceDetailOpen,
    workspaces,
  };
}

/**
 * 识别尚未发送任何消息的默认标题会话，避免连续点击“创建新对话”生成多个空记录。
 */
function findReusableDraftThread(
  threads: ThreadInfo[],
  activeThreadId: string | null,
): ThreadInfo | null {
  const activeDraft = threads.find(
    (thread) => thread.id === activeThreadId && isDraftThread(thread),
  );
  if (activeDraft) return activeDraft;

  return threads.find(isDraftThread) ?? null;
}

/**
 * 空白新对话以默认标题和零消息数为准；标题生成后或已有消息后都不再复用。
 */
function isDraftThread(thread: ThreadInfo): boolean {
  return (
    DEFAULT_DRAFT_CHAT_TITLES.has(thread.title.trim()) &&
    (thread.messageCount ?? 0) === 0
  );
}
