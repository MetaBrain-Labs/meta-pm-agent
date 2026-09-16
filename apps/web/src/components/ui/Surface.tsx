/**
 * 基础内容表面
 *
 * Responsibilities:
 * - 统一普通内容区域的背景、细边框和圆角，不默认添加阴影或内边距。
 *
 * Notes:
 * - 不接管列表、表单或业务数据；无需包装已有 Ant Design Card。
 */
import type { ComponentPropsWithoutRef } from "react";

/** 普通内容容器参数，保留原生属性与可选区域语义。 */
interface SurfaceProps extends ComponentPropsWithoutRef<"div"> {
  as?: "div" | "section";
  tone?: "default" | "muted";
  bordered?: boolean;
}

/** 渲染统一的轻量内容表面，布局和内边距由消费者决定。 */
export function Surface({
  as: Element = "div",
  tone = "default",
  bordered = true,
  className = "",
  ...props
}: SurfaceProps) {
  const classes = [
    "ds-surface",
    tone === "muted" ? "ds-surface-muted" : "",
    bordered ? "ds-surface-bordered" : "",
    className,
  ].filter(Boolean).join(" ");
  return <Element {...props} className={classes} />;
}
