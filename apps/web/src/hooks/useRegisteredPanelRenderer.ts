/**
 * 面板渲染函数注册
 *
 * 应用外壳持有工作区面板容器，但面板数据分散在页面里（会话消息、工作区图谱）。
 * 页面通过注册回调把渲染函数交给外壳，这里集中处理这套登记契约。
 *
 * Responsibilities:
 * - 把页面上报的渲染函数保存为外壳状态
 * - 处理卸载时的清空
 *
 * Notes:
 * - 关键陷阱：React 的 setState 收到函数会当作 updater 立即执行，并把上一个
 *   state 当参数传入。因此不能把 setState 直接当成回调传出去，否则存下来的会
 *   是「渲染函数的返回值」而不是函数本身，面板容器调用时就会抛
 *   `renderPanel is not a function`。这里用函数式更新把函数原样存进去。
 */

import { useCallback, useState, type ReactNode } from "react";

/** 面板渲染函数；返回面板内容。 */
export type PanelRenderer = () => ReactNode;

/** 页面上报渲染函数的回调。 */
export type PanelRendererChange = (renderer: PanelRenderer | null) => void;

/**
 * 保存并暴露一个面板渲染函数。
 *
 * 返回 `[renderer, setRenderer]`；`setRenderer` 可以安全地直接传给页面回调。
 */
export function useRegisteredPanelRenderer(): [
  PanelRenderer | null,
  PanelRendererChange,
] {
  const [renderer, setRenderer] = useState<PanelRenderer | null>(null);

  // 用函数式更新包一层，避免把渲染函数当成 updater 执行。
  const handleChange = useCallback<PanelRendererChange>((next) => {
    setRenderer(() => next);
  }, []);

  return [renderer, handleChange];
}
