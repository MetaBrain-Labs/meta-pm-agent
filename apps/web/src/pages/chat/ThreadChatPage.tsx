/**
 * 线程聊天页面容器
 *
 * 负责会话消息恢复、新会话创建、发送用户消息以及把当前页面订阅到
 * chat-run-store 中对应 thread 的运行快照。实际 SSE 消费由运行注册表持有，
 * 因此切换对话不会中断原对话的 Agent 输出。
 *
 * Responsibilities:
 * - 管理当前 thread 的历史消息加载、加载态和错误态
 * - 创建聊天记录并提交用户消息到运行注册表
 * - 处理停止生成、清空展示和返回动作
 *
 * Notes:
 * - 本组件不直接持有 SSE reader 或 AbortController，避免页面切换影响运行中任务。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChatApp } from "../../components/ChatApp";
import { TaskHistoryPanel } from "../../components/shell/TaskHistoryPanel";
import { KnowledgeGraphPanel } from "../../components/shell/KnowledgeGraphPanel";
import { useKnowledgeGraph } from "../../hooks/useKnowledgeGraph";
import {
  createChatRecord,
  fetchChatMessages,
  fetchChatModelProfile,
  fetchModelProfiles,
  selectChatModelProfile,
} from "../../api/chat-api";
import {
  DEFAULT_CHAT_TITLE,
  NO_WORKSPACE_MESSAGE,
} from "../../constants/app";
import type {
  HumanInTheLoopResume,
  Message,
  ModelUsageProfile,
  ThreadInfo,
  WorkflowRetryRequest,
} from "../../types";
import { mapErrorToChinese } from "../../utils/errors";
import {
  getActiveChatRunSnapshot,
  startChatRun,
  stopChatRun,
  subscribeChatRun,
} from "./chat-run-store";

interface ThreadChatPageProps {
  workspaceId: string | null;
  workspaceName: string;
  thread: ThreadInfo | null;
  creationError: string | null;
  onNewThread: (thread: ThreadInfo) => void;
  onThreadMessageStarted: (threadId: string) => void;
  onThreadTitleChange: (threadId: string, title: string) => void;
  onBack: () => void;
  /** 把任务历史渲染函数登记到应用外壳的面板容器。 */
  onTasksPanelChange?: (renderer: (() => ReactNode) | null) => void;
  /** 把知识图谱渲染函数登记到应用外壳的面板容器。 */
  onGraphPanelChange?: (renderer: (() => ReactNode) | null) => void;
}

/**
 * 聊天页面，负责当前 thread 的页面级状态编排。
 */
export function ThreadChatPage({
  workspaceId,
  workspaceName,
  thread,
  creationError,
  onNewThread,
  onThreadMessageStarted,
  onThreadTitleChange,
  onBack,
  onTasksPanelChange,
  onGraphPanelChange,
}: ThreadChatPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelProfiles, setModelProfiles] = useState<ModelUsageProfile[]>([]);
  const [selectedModelProfileId, setSelectedModelProfileId] =
    useState("system-default");
  /**
   * 图谱属于工作区：对话弹窗与「知识图谱」Tab 共用同一份数据。
   *
   * loadOnMount 打开「进入工作区即读取」：图谱面板是图谱的主入口，打开它就应该
   * 看到数据，而不是显示空态让用户自己点刷新。
   */
  const {
    data: kgData,
    loading: kgLoading,
    error: kgError,
    refresh: refreshKnowledgeGraph,
    attempted: kgAttempted,
  } = useKnowledgeGraph(workspaceId, messages, { loadOnMount: true });
  const selectedModelProfileIdRef = useRef("system-default");
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const threadIdRef = useRef<string | null>(thread?.id ?? null);
  const requestFormIdRef = useRef<string | undefined>(thread?.requestFormId);
  const messagesRef = useRef<Message[]>(messages);
  const evidenceAutoStartedThreadRef = useRef<string | null>(null);
  const threadId = thread?.id ?? null;
  const requestFormId = thread?.requestFormId;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    selectedModelProfileIdRef.current = selectedModelProfileId;
  }, [selectedModelProfileId]);

  useEffect(() => {
    if (creationError) {
      setError(creationError);
    }
  }, [creationError]);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
    setError(null);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const reload = async () => {
      try {
        const profiles = await fetchModelProfiles();
        if (cancelled) return;
        setModelProfiles(profiles);
        const currentThreadId = threadIdRef.current;
        if (currentThreadId) {
          const selected = await fetchChatModelProfile(currentThreadId);
          if (!cancelled) setSelectedModelProfileId(selected.id);
        } else if (
          !profiles.some(
            (profile) => profile.id === selectedModelProfileIdRef.current,
          )
        ) {
          setSelectedModelProfileId(profiles[0]?.id ?? "system-default");
        }
      } catch {
        if (!cancelled) {
          setError("模型使用列表加载失败，请确认已执行建表 SQL");
        }
      }
    };
    const handleProfilesChanged = () => void reload();
    void reload();
    window.addEventListener("model-profiles-changed", handleProfilesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(
        "model-profiles-changed",
        handleProfilesChanged,
      );
    };
  }, []);

  useEffect(() => {
    if (!threadId) {
      setSelectedModelProfileId("system-default");
      return;
    }
    let cancelled = false;
    fetchChatModelProfile(threadId)
      .then((profile) => {
        if (!cancelled) setSelectedModelProfileId(profile.id);
      })
      .catch(() => {
        if (!cancelled) setError("当前会话模型列表加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    threadIdRef.current = threadId;
    requestFormIdRef.current = requestFormId;
  }, [requestFormId, threadId]);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const unsubscribe = subscribeChatRun(threadId, (snapshot) => {
      if (cancelled) return;
      if (!snapshot.isLoading) {
        setIsLoading(false);
        setError(snapshot.error);
        return;
      }
      setMessages(snapshot.messages);
      setIsLoading(snapshot.isLoading);
      setError(snapshot.error);
    });
    const activeSnapshot = getActiveChatRunSnapshot(threadId);

    if (activeSnapshot) {
      setMessages(activeSnapshot.messages);
      setIsLoading(activeSnapshot.isLoading);
      setError(activeSnapshot.error);
      setIsMessagesLoading(false);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    setMessages([]);
    setIsMessagesLoading(true);

    fetchChatMessages(threadId)
      .then((serverMessages) => {
        if (cancelled) return;
        // 历史消息以数据库为准；运行中消息由注册表快照覆盖。
        const runningSnapshot = getActiveChatRunSnapshot(threadId);
        setMessages(runningSnapshot?.messages ?? serverMessages);
        setIsLoading(Boolean(runningSnapshot?.isLoading));
        setError(runningSnapshot?.error ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[chat] Failed to load messages:", error);
      })
      .finally(() => {
        if (!cancelled) setIsMessagesLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [threadId]);

  const stopGeneration = useCallback(() => {
    const currentThreadId = threadIdRef.current;
    if (currentThreadId) {
      stopChatRun(currentThreadId);
    }
    setIsLoading(false);
  }, []);

  /** 在空白会话仅预选，已有会话则立即持久化；失败时回滚 UI。 */
  const changeModelProfile = useCallback(
    async (profileId: string) => {
      if (isLoading || profileId === selectedModelProfileId) return;
      const previousId = selectedModelProfileId;
      setSelectedModelProfileId(profileId);
      const currentThreadId = threadIdRef.current;
      if (!currentThreadId) return;
      try {
        const selected = await selectChatModelProfile(currentThreadId, profileId);
        setSelectedModelProfileId(selected.id);
      } catch {
        setSelectedModelProfileId(previousId);
        setError("模型列表切换失败；运行中只能在 HITL 或完成后切换");
      }
    },
    [isLoading, selectedModelProfileId],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        webSearchEnabled?: boolean;
        hitlResume?: HumanInTheLoopResume;
        workflowRetry?: WorkflowRetryRequest;
      },
    ) => {
      if ((!text.trim() && !options?.workflowRetry) || isLoading) return;

      const currentWorkspaceId = workspaceIdRef.current;
      if (!currentWorkspaceId) {
        setError(NO_WORKSPACE_MESSAGE);
        return;
      }

      let threadId = threadIdRef.current;
      const hasExistingThread = Boolean(threadId);
      if (!threadId) {
        try {
          const newThread = await createChatRecord(
            currentWorkspaceId,
            DEFAULT_CHAT_TITLE,
          );
          threadId = newThread.id;
          threadIdRef.current = threadId;
          requestFormIdRef.current = newThread.requestFormId;
          // 空白新会话先持久化预选列表，成功后才允许启动 SSE。
          await selectChatModelProfile(threadId, selectedModelProfileId);
          onNewThread(newThread);
        } catch (error: unknown) {
          setError(mapErrorToChinese(error));
          return;
        }
      }

      onThreadMessageStarted(threadId);
      setError(null);

      await startChatRun({
        threadId,
        requestFormId: requestFormIdRef.current,
        priorMessages: hasExistingThread ? messagesRef.current : [],
        userText: text,
        webSearchEnabled: options?.webSearchEnabled,
        hitlResume: options?.hitlResume,
        workflowRetry: options?.workflowRetry,
        onThreadTitleChange,
      });
    },
    [
      isLoading,
      onNewThread,
      onThreadMessageStarted,
      onThreadTitleChange,
      selectedModelProfileId,
    ],
  );

  useEffect(() => {
    if (
      !threadId ||
      isMessagesLoading ||
      isLoading ||
      messages.length > 0 ||
      evidenceAutoStartedThreadRef.current === threadId
    ) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("documentEvidence") !== "1") return;
    evidenceAutoStartedThreadRef.current = threadId;
    params.delete("documentEvidence");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
    void sendMessage("开始解决当前 PRD 的证据阻断。", {
      webSearchEnabled: false,
    });
  }, [isLoading, isMessagesLoading, messages.length, sendMessage, threadId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  /**
   * 面板渲染函数需要同时满足两件事：
   * 1. 函数引用稳定 —— 否则外壳每次 setState 都会让面板重新挂载，丢掉筛选与选中；
   * 2. 每次执行都读到最新数据 —— 否则面板永远停在首次渲染时的空数据上。
   *
   * useCallback 直接闭包捕获做不到第 2 点（依赖数组必须留空才有第 1 点）。
   * 因此用 ref 保存最新值，渲染函数只读 ref。
   */
  const tasksPanelRef = useRef({ messages, isLoading, hasThread: Boolean(threadId) });
  tasksPanelRef.current = { messages, isLoading, hasThread: Boolean(threadId) };

  const graphPanelRef = useRef({
    workspaceId,
    data: kgData,
    loading: kgLoading,
    attempted: kgAttempted,
    error: kgError,
    refresh: refreshKnowledgeGraph,
  });
  graphPanelRef.current = {
    workspaceId,
    data: kgData,
    loading: kgLoading,
    attempted: kgAttempted,
    error: kgError,
    refresh: refreshKnowledgeGraph,
  };

  /** 任务历史面板内容；引用稳定，数据实时。 */
  const renderTasksPanel = useCallback(() => {
    const current = tasksPanelRef.current;
    return (
      <TaskHistoryPanel
        messages={current.messages}
        streaming={current.isLoading}
        hasThread={current.hasThread}
      />
    );
  }, []);

  /** 知识图谱面板内容；引用稳定，数据实时。 */
  const renderGraphPanel = useCallback(() => {
    const current = graphPanelRef.current;
    return (
      <KnowledgeGraphPanel
        workspaceId={current.workspaceId ?? ""}
        data={current.data}
        loading={current.loading}
        attempted={current.attempted}
        error={current.error}
        onRefresh={() => void current.refresh()}
      />
    );
  }, []);

  return (
    <ChatApp
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      threadTitle={thread?.title ?? null}
      messages={messages}
      isLoading={isLoading}
      isMessagesLoading={isMessagesLoading}
      error={error}
      disabledReason={workspaceId ? null : NO_WORKSPACE_MESSAGE}
      modelProfiles={modelProfiles}
      selectedModelProfileId={selectedModelProfileId}
      onModelProfileChange={(profileId) => void changeModelProfile(profileId)}
      onSend={sendMessage}
      onStop={stopGeneration}
      onClear={clearMessages}
      onBack={onBack}
      tasksPanel={renderTasksPanel}
      onTasksPanelChange={onTasksPanelChange}
      graphPanel={renderGraphPanel}
      onGraphPanelChange={onGraphPanelChange}
      kgState={{
        data: kgData,
        loading: kgLoading,
        error: kgError,
        refresh: refreshKnowledgeGraph,
        attempted: kgAttempted,
      }}
      kgRefresh={refreshKnowledgeGraph}
    />
  );
}
