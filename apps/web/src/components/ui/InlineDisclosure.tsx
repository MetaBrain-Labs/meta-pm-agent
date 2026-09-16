/**
 * 对话内联折叠原语
 *
 * 为对话区的二级/三级信息提供统一、克制的折叠外观：细边框、中性底色、状态色
 * 只出现在图标上。执行时间线与各类结构化卡片共用这一套原语，避免同类信息出现
 * 两套视觉。
 *
 * Responsibilities:
 * - 提供「一行摘要 + 可展开内容」的内联折叠块
 * - 提供统一的图标状态样式与行内元信息排版
 *
 * Notes:
 * - 只负责展示，不读取业务数据、不管理业务状态。
 * - 展开状态由调用方持有，组件保持受控或简单非受控两种用法皆可。
 */

import { useState, type ReactNode } from "react";
import { CaretRightOutlined } from "@ant-design/icons";

/** 内联折叠块：默认收起，展开后内容自行滚动。 */
export function InlineDisclosure({
  title,
  icon,
  hint,
  children,
  defaultOpen = false,
  className = "",
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** 标题右侧的补充信息，例如条数。 */
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`conv-fold ${className}`.trim()}>
      <button
        type="button"
        className="conv-fold-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CaretRightOutlined
          className="exec-caret"
          data-open={open ? "true" : "false"}
          aria-hidden="true"
        />
        {icon && <span className="conv-fold-icon">{icon}</span>}
        <span className="conv-fold-title">{title}</span>
        {hint != null && <span className="conv-fold-hint">{hint}</span>}
      </button>
      {open && <div className="conv-fold-body">{children}</div>}
    </div>
  );
}

/**
 * 非折叠的内联块：用于已经在时间线里的内容，只提供一致的标题与正文排版。
 */
export function InlineBlock({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="conv-block">
      <header className="conv-block-head">
        <h4>{title}</h4>
        {hint != null && <span>{hint}</span>}
      </header>
      <div className="conv-block-body">{children}</div>
    </section>
  );
}
