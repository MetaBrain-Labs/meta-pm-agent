/**
 * 加载可见性时序
 *
 * 短请求不应闪烁 Loader。本 Hook 统一处理两件事：
 * - 延迟显示：请求快于 `delay` 时完全不显示；
 * - 最短可见：一旦显示，至少保留 `minVisible`，避免出现即消失。
 *
 * Responsibilities:
 * - 由 `loading` 布尔量推导"是否应该显示 Loader"
 * - 在组件卸载时清理定时器
 *
 * Notes:
 * - 只处理可见性时序，不发起请求、不改变业务状态。
 * - 阈值来自 `--ds-loading-*` 设计令牌，不在业务组件里写死毫秒数。
 */

import { useEffect, useRef, useState } from "react";
import { DESIGN_TOKENS } from "../theme/design-tokens";

const { delay, minVisible } = DESIGN_TOKENS.loading;

/**
 * 把加载布尔量转换为"是否显示加载反馈"。
 *
 * 首次进入即为 true 时也走延迟：首屏快速命中缓存的情况同样不该闪。
 */
export function useDelayedLoading(loading: boolean): boolean {
  const [visible, setVisible] = useState(false);
  /** 本次显示的开始时间；用于计算最短可见时长。 */
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      if (visible) return;
      const timer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(timer);
    }

    // 尚未显示：取消待显示的延迟。
    if (!visible) {
      shownAtRef.current = null;
      return;
    }

    // 已显示：补足最短可见时长再隐藏。
    const shownAt = shownAtRef.current ?? Date.now();
    const remaining = Math.max(0, minVisible - (Date.now() - shownAt));
    const timer = setTimeout(() => {
      shownAtRef.current = null;
      setVisible(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [loading, visible]);

  return visible;
}

/** 供断言与文档使用的阈值快照。 */
export const LOADING_TIMING = { delay, minVisible } as const;
