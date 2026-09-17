/**
 * 统一加载反馈组件
 *
 * 业务代码只表达「加载层级」，不需要知道具体用哪张 SVG：
 *
 * - `scope="workspace"`：品牌级加载。整个工作区 / 页面 / 大型区域正在准备，
 *   用户此时无法继续使用该区域。
 * - `scope="section"`：局部加载。列表已存在、Inspector 正在读取、Modal 数据
 *   尚未返回等。原内容保持可交互。
 * - `scope="inline"`：极小区域（按钮 / 搜索框尾部）。使用轻量指示器，
 *   不套用 SVG 资产。
 *
 * Responsibilities:
 * - 按 scope 选择加载动画、尺寸与布局
 * - 按 `delay` / `minVisible` 统一控制闪烁
 * - 在 `prefers-reduced-motion` 下切换为静态首帧
 *
 * Notes:
 * - 只负责展示；是否加载由调用方传入的 `loading` 决定。
 * - 不用于真实业务状态（Agent 运行、评分、同步状态等），那些必须显示业务数据。
 */

import type { ReactNode } from "react";
import { useDelayedLoading } from "../../hooks/useDelayedLoading";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

/** 加载层级。 */
export type LoaderScope = "workspace" | "section" | "inline";

/** 局部加载尺寸；inline 不支持尺寸档位。 */
export type LoaderSize = "sm" | "md" | "lg";

interface Props {
  /** 加载层级；决定使用哪套动画。 */
  scope: LoaderScope;
  /** 局部加载尺寸；workspace 档位固定为中大型展示。 */
  size?: LoaderSize;
  /** 是否正在加载。 */
  loading: boolean;
  /** 文案；必须说明正在做什么，不要写"加载中…"。 */
  label?: ReactNode;
  /** 额外类名，用于占位高度等布局需求。 */
  className?: string;
}

/** 两套资产的唯一来源；业务组件不直接引用文件名。 */
const ASSETS = {
  workspace: {
    animated: "/loaders/workspace-loader.svg",
    static: "/loaders/workspace-loader-static.svg",
    alt: "",
  },
  section: {
    animated: "/loaders/section-loader.svg",
    static: "/loaders/section-loader-static.svg",
    alt: "",
  },
} as const;

/** 局部加载的像素尺寸；低于 sm 的辨识度不足，因此最小档为 20。 */
const SECTION_SIZES: Record<LoaderSize, number> = { sm: 20, md: 28, lg: 40 };

export function GlobalLoader({
  scope,
  size = "md",
  loading,
  label,
  className = "",
}: Props) {
  const visible = useDelayedLoading(loading);
  const reducedMotion = usePrefersReducedMotion();
  if (!visible) return null;

  const classes = ["loader", `loader-${scope}`, className]
    .filter(Boolean)
    .join(" ");

  /*
   * 极小区域不套用 SVG 资产：在这个尺寸下 Blob 只剩看不清的色块，
   * 因此保留轻量指示器。
   */
  if (scope === "inline") {
    return (
      <span className={classes} role="status" aria-live="polite">
        <span className="loader-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {label ? <span className="loader-label">{label}</span> : null}
      </span>
    );
  }

  const asset = ASSETS[scope];
  const source = reducedMotion ? asset.static : asset.animated;
  const pixelSize = scope === "section" ? SECTION_SIZES[size] : undefined;

  return (
    <div className={classes} role="status" aria-live="polite">
      {/*
        用 <img> 而不是内联 SVG：资产含 SMIL 动画，内联会被构建链的 SVG
        转换改写。img 外链保留原文件、也让资产保持单一真实来源。
        Wrapper 固定尺寸，动画的 path morph 不影响外部盒模型。
      */}
      <img
        className="loader-art"
        src={source}
        alt={asset.alt}
        aria-hidden="true"
        draggable={false}
        style={pixelSize ? { width: pixelSize, height: pixelSize } : undefined}
      />
      {label ? <span className="loader-label">{label}</span> : null}
    </div>
  );
}
