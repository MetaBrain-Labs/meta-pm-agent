/**
 * 聊天消息刻度导航的滚动定位。
 *
 * Responsibilities:
 * - 从实际可见消息生成导航摘要并维护阅读位置。
 * - 在流式内容、卡片展开和容器尺寸变化后更新锚点。
 *
 * Notes:
 * - 只管理当前聊天栏的 DOM，不读取或保存聊天历史。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { findReadingMessageId, type MessagePosition } from "../utils/message-navigation";

/** 可见消息的导航元数据。 */
export interface MessageNavigationEntry {
  id: string;
  role: string;
  preview: string;
}

/** 绑定消息栏并返回刻度数据、阅读位置和定位操作。 */
export function useMessageNavigation(
  containerRef: RefObject<HTMLDivElement | null>,
  layoutKey: string,
  onBeforeNavigate: () => void,
) {
  const [entries, setEntries] = useState<MessageNavigationEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const jumpFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | null = null;
    let positions: MessagePosition[] = [];
    const observed = new Set<HTMLElement>();

    /** 根据缓存的锚点位置更新阅读刻度。 */
    const updateActive = () => {
      setActiveId(findReadingMessageId(
        positions, container.scrollTop, container.clientHeight, container.scrollHeight,
      ));
    };
    /** 合并同一帧的流式更新和尺寸变化，避免重复读取布局。 */
    const scheduleMeasure = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const containerTop = container.getBoundingClientRect().top;
        const anchors = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-id]"));
        const nextEntries: MessageNavigationEntry[] = [];
        positions = [];
        for (const anchor of anchors) {
          const rect = anchor.getBoundingClientRect();
          const preview = anchor.innerText.replace(/\s+/g, " ").trim().slice(0, 180);
          const id = anchor.dataset.chatMessageId;
          if (!id || !preview || rect.height === 0) continue;
          nextEntries.push({ id, role: anchor.dataset.chatMessageRole ?? "agent", preview });
          positions.push({ id, top: container.scrollTop + rect.top - containerTop });
          if (!observed.has(anchor)) {
            observed.add(anchor);
            resizeObserver.observe(anchor);
          }
        }
        for (const anchor of observed) {
          if (!container.contains(anchor)) {
            resizeObserver.unobserve(anchor);
            observed.delete(anchor);
          }
        }
        setEntries((previous) => previous.length === nextEntries.length && previous.every(
          (entry, index) => entry.id === nextEntries[index]!.id &&
            entry.role === nextEntries[index]!.role && entry.preview === nextEntries[index]!.preview,
        ) ? previous : nextEntries);
        updateActive();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    resizeObserver.observe(container);
    mutationObserver.observe(container, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });
    container.addEventListener("scroll", updateActive, { passive: true });
    scheduleMeasure();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener("scroll", updateActive);
      if (frame !== null) cancelAnimationFrame(frame);
      if (jumpFrameRef.current !== null) cancelAnimationFrame(jumpFrameRef.current);
    };
  }, [containerRef, layoutKey]);

  /** 先退出自动贴底，再定位到当前消息栏中的真实消息锚点。 */
  const scrollToMessage = useCallback((id: string) => {
    const container = containerRef.current;
    if (!container) return;
    onBeforeNavigate();
    if (jumpFrameRef.current !== null) cancelAnimationFrame(jumpFrameRef.current);
    jumpFrameRef.current = requestAnimationFrame(() => {
      jumpFrameRef.current = null;
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-id]"))
        .find((anchor) => anchor.dataset.chatMessageId === id);
      if (!target || containerRef.current !== container) return;
      const top = container.scrollTop + target.getBoundingClientRect().top -
        container.getBoundingClientRect().top - 12;
      // 即时定位避免平滑滚动途中的滚动事件重新启用自动贴底。
      container.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    });
  }, [containerRef, onBeforeNavigate]);

  return { entries, activeId, scrollToMessage };
}
