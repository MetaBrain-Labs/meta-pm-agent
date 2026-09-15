/**
 * 聊天栏右边缘的消息刻度导航。
 *
 * Responsibilities:
 * - 展示当前阅读刻度与消息摘要预览。
 * - 支持点击和键盘导航，长消息列表在刻度区内独立滚动。
 *
 * Notes:
 * - 不直接操作聊天栏滚动或持久化消息，定位由调用方提供。
 */

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Tooltip } from "antd";
import type { MessageNavigationEntry } from "../hooks/useMessageNavigation";

/** 消息刻度区的展示数据和定位回调。 */
interface Props {
  entries: MessageNavigationEntry[];
  activeId: string | null;
  onNavigate: (id: string) => void;
}

/** 展示可聚焦的刻度，并将当前刻度保持在自身滚动区域中。 */
export function ChatMessageNavigation({ entries, activeId, onNavigate }: Props) {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.dataset.messageId === activeId);
    if (!active) return;
    const relativeTop = active.getBoundingClientRect().top - nav.getBoundingClientRect().top;
    if (relativeTop < 0) nav.scrollTop += relativeTop;
    else if (relativeTop + active.offsetHeight > nav.clientHeight) {
      nav.scrollTop += relativeTop + active.offsetHeight - nav.clientHeight;
    }
  }, [activeId, entries.length]);

  /** 使用方向键和首尾键移动刻度焦点，按回车或空格执行原生按钮定位。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 :
      event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    navRef.current?.querySelectorAll<HTMLButtonElement>("button")[
      Math.max(0, Math.min(entries.length - 1, next))
    ]?.focus();
  };
  if (entries.length === 0) return null;
  return (
    <nav ref={navRef} aria-label="聊天消息导航" className="chat-message-navigation scrollbar-none">
      {entries.map((entry, index) => {
        const role = entry.role === "user" ? "你" : "助手";
        const active = entry.id === activeId;
        return (
          <Tooltip key={entry.id} placement="left" trigger={["hover", "focus"]} title={
            <div className="max-w-[260px]">
              <div className="mb-1 font-sans text-xs">{role} · 第 {index + 1} 条消息</div>
              <div className="font-reading-compact whitespace-pre-wrap">{entry.preview}</div>
            </div>
          }>
            <button type="button" data-message-id={entry.id}
              aria-label={`跳转到第 ${index + 1} 条消息：${role}，${entry.preview}`}
              aria-current={active ? "location" : undefined}
              onClick={() => onNavigate(entry.id)} onKeyDown={(event) => handleKeyDown(event, index)}
              className="group flex h-5 w-full shrink-0 cursor-pointer items-center justify-end rounded border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
            >
              <span className={`h-0.5 rounded transition-all group-hover:w-5 group-hover:bg-[var(--primary)] ${
                active ? "w-5 bg-[var(--ink)]" : entry.role === "user" ? "w-3 bg-[var(--ink-faint)]" : "w-2 bg-[var(--line)]"
              }`} />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
