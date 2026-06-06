import { useState, useEffect, useCallback } from "react";
import type { ThreadInfo } from "../types";

interface Props {
  currentThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  collapsed: boolean;
  onToggle: () => void;
  refreshKey: number;
}

export function Sidebar({ currentThreadId, onSelectThread, onNewThread, collapsed, onToggle, refreshKey }: Props) {
  const [threads, setThreads] = useState<ThreadInfo[]>([]);

  const fetchThreads = useCallback(async () => {
    try {
      const resp = await fetch("/api/threads");
      if (!resp.ok) return;
      const data = await resp.json();
      setThreads(data.threads ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads, refreshKey]);

  return (
    <>
      {!collapsed && <div className="sidebar-overlay" onClick={onToggle} />}
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <div className="sidebar-head">
          <button className="sidebar-new-btn" onClick={onNewThread} title="新建对话">
            + 新对话
          </button>
          <button className="sidebar-toggle" onClick={onToggle} title="收起侧边栏">
            {collapsed ? "☰" : "✕"}
          </button>
        </div>
        <div className="sidebar-list">
          {threads.map((t) => (
            <button
              key={t.id}
              className={`sidebar-item${t.id === currentThreadId ? " active" : ""}`}
              onClick={() => onSelectThread(t.id)}
            >
              <span className="sidebar-item-title">{t.title}</span>
              <span className="sidebar-item-date">
                {new Date(t.createdAt).toLocaleDateString()}
              </span>
            </button>
          ))}
          {threads.length === 0 && (
            <div className="sidebar-empty">暂无历史对话</div>
          )}
        </div>
      </aside>
    </>
  );
}
