/**
 * 混合内容文本
 *
 * 把自然语言里的结构前缀（Assumption / Impact / Gap 等）与正文分开渲染：
 * 前缀使用界面字体（思源黑体）表达结构，正文使用内容字体（霞鹜文楷 Lite）阅读。
 *
 * Responsibilities:
 * - 渲染一段可能带结构前缀的文本
 * - 无前缀时退化为普通内容段落，避免多包一层无意义结构
 *
 * Notes:
 * - 只做字体分层，不改变文本内容与顺序。
 * - 前缀不使用加粗，避免在内容区产生不必要的强调层级。
 */

import { splitTypedSegments } from "../../utils/typed-text";

interface Props {
  text: string;
  /** 未分层时的容器类名；默认按内容字体处理。 */
  className?: string;
}

export function TypedText({ text, className = "font-reading-compact" }: Props) {
  const segments = splitTypedSegments(text);

  // 没有结构前缀时保持单一内容段落，不额外包 span。
  if (segments.length === 0) return null;
  if (segments.length === 1 && segments[0]!.role === "text") {
    return <p className={className}>{segments[0]!.value}</p>;
  }

  return (
    <p className={className}>
      {segments.map((segment, index) =>
        segment.role === "label" ? (
          <span key={index} className="typed-label">
            {segment.value}
          </span>
        ) : (
          <span key={index} className="typed-body">
            {segment.value}
          </span>
        ),
      )}
    </p>
  );
}
