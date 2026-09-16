/**
 * 工作区两栏分隔容器
 *
 * 承载「对话栏 + 工作区面板」并负责宽度分配：对话栏为固定基准宽度的可调窄栏，
 * 工作区面板始终 flex: 1 1 auto 且 min-width: 0，因此永远占满剩余空间。
 *
 * Responsibilities:
 * - 提供可拖动、可键盘操作的分隔条，并在本地记住用户设置
 * - 空间不足时自动收起对话栏，避免把工作区压缩到不可用
 * - 收起与展开只改变展示状态，不卸载对话栏内容
 *
 * Notes:
 * - 只管理宽度这类 UI 偏好，不读取路由、不发起请求；聊天历史不写入本地存储。
 * - 不使用固定 position 或 calc(100vw - Npx) 之类的视口推算。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { SPLIT_LAYOUT_STORAGE_KEY } from "../../constants/app";

/**
 * 对话栏宽度尺度。
 *
 * 这些是设计参考值，不是硬上限：向右拖动的唯一约束是工作区面板的可用下限，
 * 也就是拖动上限随容器宽度变化（resolveConversationWidth 计算），不再写死。
 */
export const CONVERSATION_DEFAULT_WIDTH = 400;
/** 手动调整时的软下限；空间不足时可以进一步收窄到硬下限。 */
export const CONVERSATION_MIN_WIDTH = 360;
/** 硬下限：低于该宽度对话栏不再可用，此时改为收起。 */
export const CONVERSATION_HARD_MIN_WIDTH = 300;
/** 拖到该宽度以内直接收起，避免先挤成一个不可用的窄栏。 */
const COLLAPSE_THRESHOLD_WIDTH = 340;
/** 工作区面板可用下限；低于该宽度时优先收起对话栏。 */
export const WORKSPACE_MIN_WIDTH = 560;
/** 分隔条命中区域宽度，需与 .workspace-splitter 的 flex-basis 保持一致。 */
export const SPLITTER_WIDTH = 7;
/** 键盘调整步长与窗口缩放后的最小重算间隔。 */
const KEYBOARD_STEP = 16;
const RESIZE_DEBOUNCE_MS = 80;

/** 某一容器宽度下，对话栏允许的最大宽度。 */
export function maxConversationWidth(containerWidth: number): number {
  return Math.max(0, containerWidth - WORKSPACE_MIN_WIDTH - SPLITTER_WIDTH);
}

/**
 * 根据容器可用宽度计算对话栏宽度；工作区始终优先保证 WORKSPACE_MIN_WIDTH。
 * 返回 null 表示两侧都放不下，应改为收起对话栏。
 */
export function resolveConversationWidth(
  containerWidth: number,
  desiredWidth: number,
): number | null {
  const max = maxConversationWidth(containerWidth);
  if (max < CONVERSATION_HARD_MIN_WIDTH) return null;
  if (desiredWidth <= max) {
    return clampConversationWidth(desiredWidth);
  }
  // 放不下期望宽度时收到工作区下限，而不是借用固定上限。
  return Math.max(CONVERSATION_HARD_MIN_WIDTH, max);
}

/** 本地缓存的对话栏布局偏好。 */
interface StoredSplitLayout {
  width: number;
  collapsed: boolean;
  /** 用户是否手动调整过宽度；未调整时宽度跟随可用空间。 */
  pinned: boolean;
}

/** 对话栏控制接口，供外壳头部按钮收起或展开对话栏。 */
interface ConversationSplitControl {
  collapsed: boolean;
  toggle: () => void;
}

const ConversationSplitContext = createContext<ConversationSplitControl | null>(
  null,
);

/** 读取对话栏布局控制；不在分隔容器内时返回 null。 */
export function useConversationSplit(): ConversationSplitControl | null {
  return useContext(ConversationSplitContext);
}

/**
 * 把任意输入收敛到对话栏合法宽度。
 *
 * 只做下限保护：上限由容器宽度决定（见 maxConversationWidth），
 * 这里不能写死上限，否则向右拖动会被无声截断。缓存里超过当前上限的
 * 历史值会在读取后由 resolveConversationWidth 收敛。
 */
function clampConversationWidth(width: number): number {
  if (!Number.isFinite(width)) return CONVERSATION_DEFAULT_WIDTH;
  return Math.max(CONVERSATION_HARD_MIN_WIDTH, Math.round(width));
}

/**
 * 读取本地缓存的布局；旧版本或异常数据一律回退到默认值。
 * 缺少 pinned 字段的历史数据按「未手动调整」处理，保持跟随可用空间。
 */
function readStoredLayout(): StoredSplitLayout {
  const fallback: StoredSplitLayout = {
    width: CONVERSATION_DEFAULT_WIDTH,
    collapsed: false,
    pinned: false,
  };
  try {
    const raw = localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const candidate = parsed as {
      conversationWidth?: unknown;
      collapsed?: unknown;
      pinned?: unknown;
    };
    return {
      width: clampConversationWidth(Number(candidate.conversationWidth)),
      collapsed: candidate.collapsed === true,
      pinned: candidate.pinned === true,
    };
  } catch {
    return fallback;
  }
}

/** 写入本地缓存；存储异常时保持当前会话内的布局不变。 */
function writeStoredLayout(layout: StoredSplitLayout): void {
  try {
    localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // 忽略存储异常，不影响当前布局。
  }
}

interface Props {
  /** 对话栏内容；为空时不渲染对话栏，面板直接占满剩余空间。 */
  conversation: ReactNode | null;
  /** 工作区面板内容。 */
  panel: ReactNode;
  /** 对话栏折叠状态变化回调，供外壳同步按钮状态。 */
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function WorkspaceSplit({
  conversation,
  panel,
  onCollapsedChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stored] = useState<StoredSplitLayout>(readStoredLayout);
  const [width, setWidth] = useState(stored.width);
  const [collapsed, setCollapsed] = useState(stored.collapsed);
  const [dragging, setDragging] = useState(false);
  /** 拖动已越过收起阈值，松手后收起；用于给出视觉提示。 */
  const [collapsePending, setCollapsePending] = useState(false);
  /** 容器当前宽度，仅用于渲染可访问的最大值提示。 */
  const [containerWidth, setContainerWidth] = useState(0);
  /** 用户是否手动调整过宽度；未调整时宽度始终跟随可用空间。 */
  const [widthPinned, setWidthPinned] = useState(stored.pinned);

  const hasConversation = conversation !== null;
  // ResizeObserver 回调不参与渲染，读取最新状态需要 ref。
  const widthPinnedRef = useRef(widthPinned);
  widthPinnedRef.current = widthPinned;
  const widthRef = useRef(width);
  widthRef.current = width;
  /** 面板可用宽度 = 容器宽度 - 对话栏宽度 - 分隔条。 */
  const fitsWorkspace = useCallback(
    (nextWidth: number) =>
      nextWidth <= maxConversationWidth(containerRef.current?.clientWidth ?? 0),
    [],
  );

  // 拒绝任何会让工作区低于可用下限的宽度，保证面板始终可工作。
  const applyWidth = useCallback(
    (nextWidth: number) => {
      const clamped = clampConversationWidth(nextWidth);
      if (!fitsWorkspace(clamped)) return;
      setWidth(clamped);
      setWidthPinned(true);
    },
    [fitsWorkspace],
  );

  const setCollapsedState = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      onCollapsedChange?.(next);
    },
    [onCollapsedChange],
  );

  // 视口变化后重新校验：放不下时收起对话栏，否则在可用空间内收敛宽度。
  useLayoutEffect(() => {
    if (!hasConversation) return;
    const container = containerRef.current;
    if (!container) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = () => {
      // 容器宽度只用于展示上限，抖动 1px 内不触发重渲染。
      setContainerWidth((current) =>
        Math.abs(current - container.clientWidth) < 1
          ? current
          : container.clientWidth,
      );
      // 用户调过宽度就沿用当前值；否则回到默认值，窗口变宽时自动恢复。
      const desired = widthPinnedRef.current
        ? widthRef.current
        : CONVERSATION_DEFAULT_WIDTH;
      const next = resolveConversationWidth(
        container.clientWidth,
        desired,
      );
      if (next === null) {
        setCollapsed(true);
        return;
      }
      setWidth(next);
    };

    const observer = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        sync();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);
    sync();

    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [hasConversation]);

  // 对话栏不存在时强制展开，避免上次的收起状态影响独立文档页。
  useEffect(() => {
    if (!hasConversation && collapsed) setCollapsed(false);
  }, [collapsed, hasConversation]);

  const persistedCollapsed = hasConversation ? collapsed : false;

  // 展开时立即按当前可用空间校正宽度；收起期间容器变宽也不会留下过窄的对话栏。
  useLayoutEffect(() => {
    if (!hasConversation || collapsed) return;
    const container = containerRef.current;
    if (!container) return;
    const desired = widthPinnedRef.current
      ? widthRef.current
      : CONVERSATION_DEFAULT_WIDTH;
    const next = resolveConversationWidth(container.clientWidth, desired);
    if (next !== null) setWidth(next);
  }, [collapsed, hasConversation]);

  useEffect(() => {
    if (!hasConversation) return;
    writeStoredLayout({ width, collapsed, pinned: widthPinned });
  }, [collapsed, hasConversation, width, widthPinned]);

  /**
   * 拖动分隔条。
   *
   * 两个容易踩的点：
   * 1. 指针被 handle 捕获后事件只派发给 handle，监听 window 收不到 move/up。
   * 2. 不能在拖动中真正收起对话栏：收起会卸载 handle，手势当场中断。
   *    因此越过阈值时只记下意图并给出视觉提示，松手时才提交收起。
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !hasConversation) return;
    const container = containerRef.current;
    const handle = event.currentTarget;
    if (!container) return;

    const startX = event.clientX;
    const startWidth = widthRef.current;
    const pendingCollapseRef = { current: false };
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    document.body.dataset.resizing = "col";

    const handleMove = (moveEvent: PointerEvent) => {
      // 上限随容器宽度实时计算：右侧唯一约束是工作区面板的下限。
      const maxByContainer = maxConversationWidth(container.clientWidth);
      const next = startWidth + (moveEvent.clientX - startX);
      if (next <= COLLAPSE_THRESHOLD_WIDTH) {
        // 只标记意图：真实收起要等松手，避免手势被卸载打断。
        if (!pendingCollapseRef.current) {
          pendingCollapseRef.current = true;
          setCollapsePending(true);
        }
        return;
      }
      if (pendingCollapseRef.current) {
        pendingCollapseRef.current = false;
        setCollapsePending(false);
      }
      setWidth(Math.min(next, maxByContainer));
      setWidthPinned(true);
    };
    const handleUp = () => {
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      handle.removeEventListener("pointercancel", handleUp);
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      delete document.body.dataset.resizing;
      setDragging(false);
      setCollapsePending(false);
      if (pendingCollapseRef.current) setCollapsedState(true);
    };

    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
    handle.addEventListener("pointercancel", handleUp);
  };

  /** 拖动期间由指针直接决定状态，组件卸载时清理全局标记。 */
  useEffect(
    () => () => {
      delete document.body.dataset.resizing;
    },
    [],
  );

  /** 键盘调整：方向键微调，Home / End 切换收起与最大宽度。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hasConversation) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setCollapsed(false);
      applyWidth(width - KEYBOARD_STEP);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setCollapsed(false);
      applyWidth(width + KEYBOARD_STEP);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setCollapsedState(true);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setCollapsedState(false);
      applyWidth(maxConversationWidth(containerRef.current?.clientWidth ?? 0));
    }
  };

  /** 对话栏入口：没有对话栏时不暴露收起/展开动作。 */
  const splitControl: ConversationSplitControl | null = hasConversation
    ? {
        collapsed,
        toggle: () => setCollapsedState(!collapsed),
      }
    : null;

  return (
    <ConversationSplitContext.Provider value={splitControl}>
      <div
        ref={containerRef}
        className="workspace-shell"
        data-has-conversation={hasConversation ? "true" : "false"}
        data-conversation-collapsed={persistedCollapsed ? "true" : "false"}
      >
        {/*
         * 收起时保留对话栏挂载，只隐藏展示：草稿、滚动位置、待回答问题
         * 与运行中的消息订阅都不会因为收起而丢失。
         */}
        {hasConversation && (
          <section
            className="workspace-conversation"
            aria-label="对话"
            aria-hidden={persistedCollapsed || undefined}
            style={{ flexBasis: `${width}px` }}
          >
            {conversation}
          </section>
        )}
        {hasConversation && !persistedCollapsed && (
          <div
            className="workspace-splitter"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="调整对话栏宽度"
            aria-valuemin={CONVERSATION_MIN_WIDTH}
            aria-valuemax={maxConversationWidth(containerWidth)}
            aria-valuenow={width}
            data-dragging={dragging ? "true" : "false"}
            data-collapse-pending={collapsePending ? "true" : "false"}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
            onDoubleClick={() => setCollapsedState(true)}
          >
            <span className="workspace-splitter-grip" aria-hidden="true" />
            {/* 拖动时显示实时宽度，让上限可见而不是「拖不动」。 */}
            {dragging && (
              <span className="workspace-splitter-value">{width}</span>
            )}
          </div>
        )}
        <div className="workspace-panel-slot">{panel}</div>
      </div>
    </ConversationSplitContext.Provider>
  );
}
