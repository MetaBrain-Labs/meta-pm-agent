/**
 * 混合内容字体分层
 *
 * Agent 输出的自然语言里常带结构性前缀，例如
 * `Gap: missing_information[1] | Assumption: 等保具体级别未确认 | Impact: 技术选型……`。
 * 这类文本整体是自然语言，但前缀本身是结构标记，属于 UI 信息。
 *
 * 本模块把字符串按前缀切分，交给调用方分别用界面字体与内容字体渲染，
 * 避免为了前缀把整段文字变成 UI 字体，或反过来让文楷承担结构标记。
 *
 * Responsibilities:
 * - 识别常见结构前缀（中英文冒号均可）并切分为片段
 * - 输出带 role 的片段序列，交由渲染层决定字体
 *
 * Notes:
 * - 纯文本解析，不渲染、不请求；字体类名由调用方决定。
 * - 只识别明确列举的前缀，不做语义猜测，避免误切自然语言里的冒号。
 */

/** 片段角色：label 用界面字体，text 用内容字体。 */
export interface TypedSegment {
  role: "label" | "text";
  value: string;
}

/**
 * 需要单独用界面字体表达的结构前缀。
 *
 * 这些词是 Agent 输出里的字段名，不是句子的一部分；保持短名单可以避免把
 * 自然语言里正常的"注意："之类误判成字段。
 */
const MARKERS = [
  "Gap",
  "Assumption",
  "Assumptions",
  "Impact",
  "Evidence",
  "Risk",
  "Risks",
  "Decision",
  "Constraint",
  "OpenQuestion",
  "Open Question",
  "Rationale",
  "Note",
  "假设",
  "影响",
  "证据",
  "风险",
  "决策",
  "约束",
  "理由",
  "说明",
];

/** 匹配 `Marker:` 或 `Marker：`；要求词后紧跟冒号，避免命中普通句子。 */
const MARKER_PATTERN = new RegExp(
  `(${MARKERS.map((marker) => marker.replace(/ /g, "\\s")).join("|")})\\s*[:：]`,
  "g",
);

/**
 * 按结构前缀把文本切成 label / text 片段。
 *
 * 前缀之间可能用 `|` 分隔，本函数同时把该分隔符归入前一个 label 片段之后，
 * 使输出保持「label → 内容 → label → 内容」的可读顺序。
 */
export function splitTypedSegments(text: string): TypedSegment[] {
  const segments: TypedSegment[] = [];
  const matches = [...text.matchAll(MARKER_PATTERN)];

  if (matches.length === 0) {
    return text ? [{ role: "text", value: text }] : [];
  }

  // 第一个前缀之前的普通文字按内容字体处理。
  const head = text.slice(0, matches[0]!.index);
  if (head.trim()) segments.push({ role: "text", value: head });

  matches.forEach((match, index) => {
    const start = match.index!;
    const end = matches[index + 1]?.index ?? text.length;
    const chunk = text.slice(start, end);
    const label = match[0].trim();
    /*
     * 分隔符在真实数据里出现在前缀之后或内容之后（`Gap: x | Assumption: y`），
     * 因此前后都要清理，否则会留下孤立的 `|` 贴在正文边缘。
     */
    const body = chunk
      .slice(match[0].length)
      .replace(/^\s*[|｜]\s*/, "")
      .replace(/\s*[|｜]\s*$/, "")
      .trim();

    segments.push({ role: "label", value: label });
    if (body) segments.push({ role: "text", value: body });
  });

  return segments;
}

/** 该文本是否含可分层的前缀；用于决定是否需要走分层渲染。 */
export function hasTypedMarkers(text: string): boolean {
  MARKER_PATTERN.lastIndex = 0;
  return MARKER_PATTERN.test(text);
}
