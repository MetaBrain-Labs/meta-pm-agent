/**
 * 混合内容字体分层回归检查
 *
 * 固定「结构前缀用界面字体、自然语言正文用内容字体」这条分层规则，
 * 并防止解析器误伤普通自然语言里的冒号。
 *
 * Responsibilities:
 * - 校验结构前缀的切分结果
 * - 校验普通句子不被误切
 * - 校验中文冒号与前缀
 *
 * Notes:
 * - 与 utils/typed-text.ts 的规则保持一致；纯函数断言，不渲染。
 * - 运行方式：node apps/web/scripts/check-typed-text.mjs
 */

import assert from "node:assert/strict";

/** 与 utils/typed-text.ts 的 MARKERS 保持一致。 */
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

const MARKER_PATTERN = new RegExp(
  `(${MARKERS.map((marker) => marker.replace(/ /g, "\\s")).join("|")})\\s*[:：]`,
  "g",
);

/** 与 splitTypedSegments 保持一致。 */
function splitTypedSegments(text) {
  const segments = [];
  const matches = [...text.matchAll(MARKER_PATTERN)];

  if (matches.length === 0) {
    return text ? [{ role: "text", value: text }] : [];
  }

  const head = text.slice(0, matches[0].index);
  if (head.trim()) segments.push({ role: "text", value: head });

  matches.forEach((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? text.length;
    const chunk = text.slice(start, end);
    const label = match[0].trim();
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

// 1. 典型的 Gap / Assumption / Impact 三段式。
{
  const segments = splitTypedSegments(
    "Gap: missing_information[1] | Assumption: 等保具体级别未确认 | Impact: 技术选型需在确认后确定",
  );
  assert.deepEqual(
    segments.map((s) => s.role),
    ["label", "text", "label", "text", "label", "text"],
    "三个前缀必须各自分层，正文归内容字体",
  );
  assert.deepEqual(
    segments.filter((s) => s.role === "label").map((s) => s.value),
    ["Gap:", "Assumption:", "Impact:"],
    "前缀保留冒号，作为结构标记呈现",
  );
  assert.equal(
    segments.filter((s) => s.role === "text")[1].value,
    "等保具体级别未确认",
    "分隔符 | 不得残留在正文里",
  );
}
console.log("✓ Gap / Assumption / Impact 三段式正确分层");

// 2. 普通自然语言不被误切。
{
  const plain = "这是一段普通的自然语言说明，没有任何结构前缀。";
  const segments = splitTypedSegments(plain);
  assert.deepEqual(segments, [{ role: "text", value: plain }]);
}
console.log("✓ 无前缀文本保持单一内容段落");

// 3. 句中冒号不属于结构前缀。
{
  const sentence = "这里需要注意：交付范围仍待确认。";
  const segments = splitTypedSegments(sentence);
  assert.equal(segments.length, 1, "「需要注意：」不是列举的前缀，不得切分");
  assert.equal(segments[0].role, "text");
}
console.log("✓ 句中普通冒号不被误判为结构前缀");

// 4. 中文前缀与中文冒号。
{
  const segments = splitTypedSegments("风险：交付周期紧张 影响：需要缩减范围");
  assert.deepEqual(
    segments.map((s) => s.role),
    ["label", "text", "label", "text"],
  );
  assert.deepEqual(
    segments.filter((s) => s.role === "label").map((s) => s.value),
    ["风险：", "影响："],
  );
}
console.log("✓ 中文前缀与中文冒号可识别");

// 5. 前缀开头的文本也能分层（没有前置正文）。
{
  const segments = splitTypedSegments("Assumption: 用户规模按 10-50 人估算");
  assert.equal(segments[0].role, "label");
  assert.equal(segments[0].value, "Assumption:");
  assert.equal(segments[1].role, "text");
  assert.equal(segments[1].value, "用户规模按 10-50 人估算");
}
console.log("✓ 前缀开头的文本正确分层");

// 6. 空文本安全返回空数组。
{
  assert.deepEqual(splitTypedSegments(""), []);
}
console.log("✓ 空文本安全返回");

console.log("\n混合内容字体分层断言全部通过。");
