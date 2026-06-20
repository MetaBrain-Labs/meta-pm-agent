import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Form } from "antd";
import type { AccountInfo, ThreadInfo, WorkspaceInfo } from "../types";
import {
  createChatRecord,
  createWorkspaceRecord,
  fetchAccount,
  fetchChatRecords,
  fetchWorkspaces,
} from "../api/chat-api";
import {
  ACTIVE_WORKSPACE_KEY,
  DEFAULT_CHAT_TITLE,
  DEFAULT_WORKSPACE_NAME,
} from "../constants/app";
import {
  buildChatPath,
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
  const [projectForm] = Form.useForm<{ name: string; location?: string }>();
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_WORKSPACE_KEY),
  );
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configTab, setConfigTab] = useState<"account" | "workspace">(
    "account",
  );
  const [configWorkspaceVisible, setConfigWorkspaceVisible] = useState(false);
  const [projectLocationHint, setProjectLocationHint] = useState(false);
  const [workspaceDetailOpen, setWorkspaceDetailOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute());

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
    setActiveThreadId(route.threadId);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, route.workspaceId);
  }, [route]);

  useEffect(() => {
    let cancelled = false;

    fetchAccount()
      .then((serverAccount) => {
        if (cancelled) return;
        setAccount(serverAccount);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[account] Failed to load account:", error);
      });

    fetchWorkspaces()
      .then((serverWorkspaces) => {
        if (cancelled) return;
        restoreWorkspaces(serverWorkspaces);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[workspace] Failed to load workspaces:", error);
        setCreationError(mapErrorToChinese(error));
      });

    return () => {
      cancelled = true;
    };
  }, [restoreWorkspaces]);

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
        setActiveThreadId(routeThreadId);
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

  const handleBackToWorkspaceList = useCallback(() => {
    pushPath("/workplace");
    setWorkspaceDetailOpen(false);
    setActiveThreadId(null);
  }, []);

  const openConfigModal = useCallback((tab: "account" | "workspace") => {
    setConfigWorkspaceVisible(tab === "workspace");
    setConfigTab(tab);
    setConfigModalOpen(true);
  }, []);

  const openProjectModal = useCallback(() => {
    setProjectLocationHint(false);
    projectForm.setFieldsValue({
      name: `${DEFAULT_WORKSPACE_NAME} ${workspaces.length + 1}`,
      location: "",
    });
    setProjectModalOpen(true);
  }, [projectForm, workspaces.length]);

  const handleBrowseDirectory = useCallback(async () => {
    type DirectoryPickerWindow = Window & {
      showDirectoryPicker?: () => Promise<{ name: string }>;
    };
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;

    if (picker) {
      try {
        const handle = await picker.call(window);
        const maybePath = (handle as { path?: string }).path;
        projectForm.setFieldValue("location", maybePath || handle.name);
        setProjectLocationHint(false);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    directoryInputRef.current?.click();
  }, [projectForm]);

  const handleDirectoryInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      const relativePath = file?.webkitRelativePath;
      const nativePath = (file as (File & { path?: string }) | undefined)?.path;
      const directoryName = relativePath?.split("/")[0] || file?.name || "";
      const selectedPath = nativePath || directoryName;

      if (selectedPath) {
        projectForm.setFieldValue("location", selectedPath);
        setProjectLocationHint(false);
      }

      event.currentTarget.value = "";
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
      console.error("[workspace] Failed to create workspace:", error);
      setCreationError(mapErrorToChinese(error));
    } finally {
      setIsCreatingWorkspace(false);
    }
  }, [isCreatingWorkspace, projectForm]);

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
    account,
    activeThread,
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceName: activeWorkspace?.name ?? DEFAULT_WORKSPACE_NAME,
    configModalOpen,
    configTab,
    configWorkspaceVisible,
    creationError,
    directoryInputRef,
    handleBackToWorkspaceList,
    handleBrowseDirectory,
    handleDirectoryInputChange,
    handleNewChat,
    handleNewThread,
    handleThreadMessageStarted,
    handleThreadTitleChange,
    handleNewWorkspace,
    handleOpenWorkspace,
    handleSelectThread,
    isCreatingChat,
    isCreatingWorkspace,
    openConfigModal,
    openProjectModal,
    projectForm,
    projectLocationHint,
    projectModalOpen,
    setConfigModalOpen,
    setConfigTab,
    setProjectModalOpen,
    setSidebarCollapsed,
    sidebarCollapsed,
    threads,
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
