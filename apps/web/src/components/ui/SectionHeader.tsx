/**
 * 内容分区标题
 *
 * Responsibilities:
 * - 统一分区标题、辅助说明及可选操作区的排版与间距。
 *
 * Notes:
 * - 标题保持语义层级，操作区只透传展示内容。
 */
import type { ReactNode } from "react";

/** 内容分区标题的展示参数。 */
interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}

/** 渲染标题与说明，不管理页面操作状态。 */
export function SectionHeader({
  title,
  description,
  actions,
  level = 2,
  className = "",
}: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <header className={`ds-section-header ${className}`}>
      <div className="ds-section-header-copy">
        <Heading className="ds-section-title">{title}</Heading>
        {description != null && <p className="ds-section-description">{description}</p>}
      </div>
      {actions != null && <div className="ds-section-actions">{actions}</div>}
    </header>
  );
}
