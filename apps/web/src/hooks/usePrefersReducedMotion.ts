/**
 * 系统减少动态效果偏好
 *
 * 两个 Loader 自带 SMIL 动画。用户声明 `prefers-reduced-motion: reduce` 时，
 * 统一改用同一 SVG 的静态首帧，而不是另做一套资产。
 *
 * Responsibilities:
 * - 订阅并返回 `prefers-reduced-motion` 的当前值
 *
 * Notes:
 * - 只读取媒体查询，不写全局样式；暂停动画由使用方决定。
 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const sync = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}
