import { useState, useCallback, useRef, useEffect } from "react";
import { Layout, ConfigProvider, Modal, Form, Input, Button } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ChatApp } from "./components/ChatApp";
import { Sidebar } from "./components/Sidebar";
import type {
  ThreadInfo,
  Message,
  StreamEvent,
  WorkspaceInfo,
} from "./types";
import { applyStreamEvent } from "./utils/apply-stream-event";

const ACTIVE_WORKSPACE_KEY = "pm-agent-active-workspace";
const DEFAULT_CHAT_TITLE = "\u65b0\u5bf9\u8bdd";
const DEFAULT_WORKSPACE_NAME = "\u672c\u5730\u5de5\u4f5c\u533a";
const NO_WORKSPACE_MESSAGE =
  "\u8bf7\u5148\u65b0\u5efa\u6216\u9009\u62e9\u5de5\u4f5c\u533a";

function loadMessages(threadId: string): Message[] {
  try {
    const raw = localStorage.getItem(`pm-msgs-${threadId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages(threadId: string, messages: Message[]) {
  localStorage.setItem(`pm-msgs-${threadId}`, JSON.stringify(messages));
}

async function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
  const response = await fetch("/api/workspaces");

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    workspaces: WorkspaceInfo[];
  };

  return data.workspaces;
}

async function createWorkspaceRecord(name: string): Promise<WorkspaceInfo> {
  const response = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    workspace: WorkspaceInfo;
  };

  return data.workspace;
}

async function createChatRecord(
  workspaceId: string,
  title: string,
): Promise<ThreadInfo> {
  const response = await fetch("/api/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, title }),
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    chat: ThreadInfo;
    requestForm: {
      id: string;
    };
  };

  return {
    ...data.chat,
    requestFormId: data.requestForm.id,
  };
}

async function fetchChatRecords(
  workspaceId: string,
): Promise<ThreadInfo[]> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(`/api/chats?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  const data = (await response.json()) as {
    chats: ThreadInfo[];
  };

  return data.chats;
}

export default function App() {
  const [projectForm] = Form.useForm<{ name: string; location?: string }>();
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
  const [projectLocationHint, setProjectLocationHint] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchWorkspaces()
      .then((serverWorkspaces) => {
        if (cancelled) return;

        setWorkspaces(serverWorkspaces);
        const storedWorkspaceId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
        const nextWorkspaceId =
          serverWorkspaces.find(
            (workspace) => workspace.id === storedWorkspaceId,
          )?.id ??
          serverWorkspaces[0]?.id ??
          null;

        setActiveWorkspaceId(nextWorkspaceId);
        if (nextWorkspaceId) {
          localStorage.setItem(ACTIVE_WORKSPACE_KEY, nextWorkspaceId);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[workspace] Failed to load workspaces:", error);
        setCreationError(mapErrorToChinese(error as Error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        setActiveThreadId(null);
        setCreationError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[chat] Failed to load chats:", error);
        setCreationError(mapErrorToChinese(error as Error));
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const handleNewThread = useCallback((newThread: ThreadInfo) => {
    setCreationError(null);
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
  }, []);

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

  const handleSelectWorkspace = useCallback((id: string) => {
    setActiveWorkspaceId(id);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  }, []);

  const openProjectModal = useCallback(() => {
    setProjectLocationHint(false);
    projectForm.setFieldsValue({
      name: `${DEFAULT_WORKSPACE_NAME} ${workspaces.length + 1}`,
      location: "",
    });
    setProjectModalOpen(true);
  }, [projectForm, workspaces.length]);

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
      const newWorkspace = await createWorkspaceRecord(values.name.trim());
      setWorkspaces((prev) => [newWorkspace, ...prev]);
      setActiveWorkspaceId(newWorkspace.id);
      setActiveThreadId(null);
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, newWorkspace.id);
      setCreationError(null);
      setProjectModalOpen(false);
      projectForm.resetFields();
    } catch (error) {
      console.error("[workspace] Failed to create workspace:", error);
      setCreationError(mapErrorToChinese(error as Error));
    } finally {
      setIsCreatingWorkspace(false);
    }
  }, [isCreatingWorkspace, projectForm]);

  const handleNewChat = useCallback(async () => {
    if (isCreatingChat || !activeWorkspaceId) return;
    setIsCreatingChat(true);

    try {
      const newThread = await createChatRecord(
        activeWorkspaceId,
        DEFAULT_CHAT_TITLE,
      );
      handleNewThread(newThread);
      saveMessages(newThread.id, []);
    } catch (error) {
      console.error("[chat] Failed to create chat:", error);
      setCreationError(mapErrorToChinese(error as Error));
    } finally {
      setIsCreatingChat(false);
    }
  }, [activeWorkspaceId, handleNewThread, isCreatingChat]);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#115eab",
          colorSuccess: "#059669",
          colorWarning: "#d97706",
          colorError: "#dc2626",
          borderRadius: 8,
          colorBgContainer: "#ffffff",
          colorBgLayout: "#f4f7fb",
          colorBgElevated: "#ffffff",
          colorText: "#111827",
          colorTextSecondary: "#4b5563",
          colorTextTertiary: "#6b7280",
          colorBorder: "#d9e1ec",
          colorBorderSecondary: "#e8edf5",
          fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
          fontSize: 14,
          controlHeight: 38,
          lineHeight: 1.55,
        },
        components: {
          Button: {
            fontWeight: 600,
            primaryShadow: "0 10px 22px -12px rgba(37, 99, 235, 0.75)",
          },
          Input: {
            activeBorderColor: "#115eab",
            hoverBorderColor: "#9bb5da",
          },
          Layout: {
            bodyBg: "#f4f7fb",
            siderBg: "#ffffff",
          },
        },
      }}
      locale={zhCN}
    >
      <Layout className="h-screen app-shell" style={{ gap: 0 }}>
        {activeThreadId ? (
          <>
            <Sidebar
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              threads={threads}
              activeId={activeThreadId}
              collapsed={sidebarCollapsed}
              creating={isCreatingChat}
              creatingWorkspace={isCreatingWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              onNewWorkspace={openProjectModal}
              onSelect={handleSelectThread}
              onNew={handleNewChat}
              onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
            <Layout style={{ background: "transparent" }}>
              <ThreadChatView
                workspaceId={activeWorkspaceId}
                thread={
                  threads.find((thread) => thread.id === activeThreadId) ?? null
                }
                creationError={creationError}
                onNewThread={handleNewThread}
              />
            </Layout>
          </>
        ) : (
          <WorkspaceDashboard
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            threads={threads}
            error={creationError}
            creating={isCreatingChat}
            creatingWorkspace={isCreatingWorkspace}
            onSelectWorkspace={handleSelectWorkspace}
            onNewWorkspace={openProjectModal}
            onOpenProject={() => {
              if (threads[0]) {
                handleSelectThread(threads[0].id);
                return;
              }
              void handleNewChat();
            }}
          />
        )}
      </Layout>
      <Modal
        centered
        width={610}
        open={projectModalOpen}
        title={null}
        footer={null}
        closable={false}
        className="project-create-modal"
        onCancel={() => setProjectModalOpen(false)}
      >
        <div className="project-modal-head">
          <h2>新建本地项目</h2>
          <p>在指定文件夹下创建一个新的项目</p>
        </div>
        <Form form={projectForm} layout="vertical" className="project-form">
          <div className="project-form-panel">
            <Form.Item
              label="项目名称"
              name="name"
              rules={[{ required: true, message: "请输入项目名称" }]}
            >
              <Input autoFocus />
            </Form.Item>
            <div className="project-form-divider" />
            <Form.Item label="项目地址" name="location" className="mb-0">
              <Input
                placeholder="选择后的位置"
                addonAfter={
                  <Button
                    type="link"
                    onClick={() => setProjectLocationHint(true)}
                  >
                    浏览
                  </Button>
                }
              />
            </Form.Item>
            <div className="project-location-note">
              指定项目在本地的存放位置：
              <button type="button" onClick={() => setProjectLocationHint(true)}>
                选择后的位置
              </button>
            </div>
          </div>
          {projectLocationHint && (
            <div className="project-form-error">请输入报错信息位置</div>
          )}
          <div className="project-modal-actions">
            <Button onClick={() => setProjectModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={isCreatingWorkspace}
              onClick={() => void handleNewWorkspace()}
            >
              创建
            </Button>
          </div>
        </Form>
      </Modal>
    </ConfigProvider>
  );
}

function WorkspaceDashboard({
  workspaces,
  activeWorkspaceId,
  threads,
  error,
  creating,
  creatingWorkspace,
  onSelectWorkspace,
  onNewWorkspace,
  onOpenProject,
}: {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
  threads: ThreadInfo[];
  error: string | null;
  creating: boolean;
  creatingWorkspace: boolean;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onOpenProject: () => void;
}) {
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
                onClick={() => onSelectWorkspace(workspace.id)}
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
                <i aria-hidden="true">⋮</i>
              </button>
            ))
          ) : (
            <div className="workspace-empty-projects">
              <strong>暂无项目</strong>
              <small>新建或打开一个项目后会显示在这里</small>
            </div>
          )}
        </div>
        <div className="workspace-account">
          <span />
          <b>账号</b>
          <i aria-hidden="true">⌄</i>
        </div>
      </aside>

      <main className="workspace-main">
        <div className="window-controls" aria-hidden="true">
          <span>−</span>
          <span>×</span>
        </div>
        <section className="workspace-brand">
          <div className="workspace-logo" />
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

function ThreadChatView({
  workspaceId,
  thread,
  creationError,
  onNewThread,
}: {
  workspaceId: string | null;
  thread: ThreadInfo | null;
  creationError: string | null;
  onNewThread: (thread: ThreadInfo) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const threadIdRef = useRef<string | null>(thread?.id ?? null);
  const requestFormIdRef = useRef<string | undefined>(thread?.requestFormId);
  const messagesRef = useRef<Message[]>(messages);
  const creatingRef = useRef(false);

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
    if (creatingRef.current) {
      creatingRef.current = false;
      threadIdRef.current = thread?.id ?? null;
      requestFormIdRef.current = thread?.requestFormId;
      return;
    }
    threadIdRef.current = thread?.id ?? null;
    requestFormIdRef.current = thread?.requestFormId;
    if (thread?.id) {
      setMessages(loadMessages(thread.id));
    } else {
      setMessages([]);
    }
    setError(null);
  }, [thread]);

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const currentWorkspaceId = workspaceIdRef.current;
      if (!currentWorkspaceId) {
        setError(NO_WORKSPACE_MESSAGE);
        return;
      }

      let tid = threadIdRef.current;
      if (!tid) {
        try {
          const newThread = await createChatRecord(
            currentWorkspaceId,
            text.slice(0, 30) || DEFAULT_CHAT_TITLE,
          );
          tid = newThread.id;
          creatingRef.current = true;
          threadIdRef.current = tid;
          requestFormIdRef.current = newThread.requestFormId;
          onNewThread(newThread);
        } catch (err: unknown) {
          setError(mapErrorToChinese(err));
          return;
        }
      }

      setError(null);
      setIsLoading(true);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      const agentMsgId = crypto.randomUUID();
      const agentMsg: Message = {
        id: agentMsgId,
        role: "agent",
        content: "",
        timestamp: Date.now(),
      };

      setMessages((prev) => {
        const next = [...prev, userMsg, agentMsg];
        const currentTid = threadIdRef.current;
        if (currentTid) saveMessages(currentTid, next);
        return next;
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const priorMessages = tid
          ? loadMessages(tid).filter(
              (message) =>
                message.id !== userMsg.id && message.id !== agentMsgId,
            )
          : [];
        const requestMessages = [...priorMessages, userMsg].map((message) => ({
          id: message.id,
          role:
            message.role === "agent"
              ? ("assistant" as const)
              : ("user" as const),
          content: message.content || message.userInput?.content || "",
          timestamp: new Date(message.timestamp).toISOString(),
          sessionId: "local",
          ...(message.thinking
            ? { reasoningContent: message.thinking }
            : {}),
        }));

        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: tid,
            requestFormId: requestFormIdRef.current,
            messages: requestMessages,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errorMsg = `Server error: ${resp.status}`;
          setError(mapErrorToChinese(new Error(errorMsg)));
          return;
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          setError(mapErrorToChinese(new Error("No response body")));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const event = JSON.parse(payload) as StreamEvent;
              setMessages((prev) => {
                const next = prev.map((message) => {
                  if (message.id !== agentMsgId) return message;
                  return applyStreamEvent(message, event);
                });
                const currentTid = threadIdRef.current;
                if (currentTid) saveMessages(currentTid, next);
                return next;
              });
            } catch {
              // Ignore malformed stream chunks and keep reading the stream.
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const friendly = mapErrorToChinese(err);
        setError(friendly);
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [isLoading, onNewThread],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    const tid = threadIdRef.current;
    if (tid) saveMessages(tid, []);
  }, []);

  return (
    <ChatApp
      messages={messages}
      isLoading={isLoading}
      error={error}
      disabledReason={workspaceId ? null : NO_WORKSPACE_MESSAGE}
      onSend={sendMessage}
      onStop={stopGeneration}
      onClear={clearMessages}
    />
  );
}

function mapErrorToChinese(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "\u7f51\u7edc\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5";
  }
  if (message.includes("AbortError")) return "";

  const statusMatch = message.match(/Server error: (\d+)/);
  if (statusMatch) {
    const code = parseInt(statusMatch[1]!, 10);
    if (code === 400) {
      return "\u8bf7\u6c42\u53c2\u6570\u4e0d\u5b8c\u6574\uff0c\u8bf7\u5148\u9009\u62e9\u5de5\u4f5c\u533a";
    }
    if (code === 429) {
      return "\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5";
    }
    if (code >= 500) {
      return "\u670d\u52a1\u5668\u7e41\u5fd9\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5";
    }
    if (code === 401 || code === 403) {
      return "\u9274\u6743\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 API Key \u914d\u7f6e";
    }
  }

  if (message.includes("No response body")) {
    return "\u670d\u52a1\u5668\u672a\u8fd4\u56de\u6709\u6548\u54cd\u5e94";
  }

  return "\u8fde\u63a5\u4e2d\u65ad\uff0c\u8bf7\u70b9\u51fb\u91cd\u8bd5";
}
