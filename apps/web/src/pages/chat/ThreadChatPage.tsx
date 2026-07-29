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

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatApp } from "../../components/ChatApp";
import { createChatRecord, fetchChatMessages } from "../../api/chat-api";
import {
  DEFAULT_CHAT_TITLE,
  NO_WORKSPACE_MESSAGE,
} from "../../constants/app";
import type {
  HumanInTheLoopResume,
  Message,
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
}: ThreadChatPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const threadIdRef = useRef<string | null>(thread?.id ?? null);
  const requestFormIdRef = useRef<string | undefined>(thread?.requestFormId);
  const messagesRef = useRef<Message[]>(messages);
  const threadId = thread?.id ?? null;
  const requestFormId = thread?.requestFormId;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
    [isLoading, onNewThread, onThreadMessageStarted, onThreadTitleChange],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <ChatApp
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      messages={messages}
      isLoading={isLoading}
      isMessagesLoading={isMessagesLoading}
      error={error}
      disabledReason={workspaceId ? null : NO_WORKSPACE_MESSAGE}
      onSend={sendMessage}
      onStop={stopGeneration}
      onClear={clearMessages}
      onBack={onBack}
    />
  );
}
