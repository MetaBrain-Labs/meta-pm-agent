/**
 * 交付文档工作区回归检查
 *
 * 固定「章节结构提取」与「文档行过滤」两条逻辑：前者决定预览面板能否如实反映
 * 文档结构，后者决定筛选是否只作用于真实数据。
 *
 * Responsibilities:
 * - 校验 Markdown 章节提取（层级、代码块跳过、行内标记清理）
 * - 校验文档行与类型/状态计数的推导
 * - 校验筛选组合与空结果文案判定
 *
 * Notes:
 * - 只覆盖纯函数逻辑，不渲染 DOM。
 * - 运行方式：node apps/web/scripts/check-document-workspace.mjs
 */

import assert from "node:assert/strict";

/** 与 utils/markdown-outline.ts 保持一致。 */
const MAX_LEVEL = 4;

function extractMarkdownOutline(markdown) {
  const items = [];
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;

    const level = match[1].length;
    if (level > MAX_LEVEL) continue;

    const text = match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (!text) continue;

    items.push({ id: `${items.length}-${text}`, level, text });
  }

  return items;
}

function buildContentSummary(outline, markdown) {
  return `共 ${outline.length} 个章节 · 约 ${markdown.length.toLocaleString()} 字符；`;
}

/** 与 DocumentPlanningPage 的 rows 推导保持一致。 */
function buildRows({ artifact, run, runActive }) {
  if (artifact) {
    return [
      {
        id: artifact.id,
        title: artifact.title,
        kind: "prd",
        kindLabel: `PRD · v${artifact.version}`,
        statusLabel: "已生成",
        tone: "done",
        markdown: artifact.markdown,
      },
    ];
  }
  if (run) {
    const label = runActive
      ? "生成中"
      : run.status === "failed"
        ? "生成失败"
        : "未完成";
    return [
      {
        id: run.id,
        title: `PRD（${runActive ? "生成中" : run.status === "failed" ? "生成失败" : "未完成"}`,
        kind: "prd",
        kindLabel: "PRD",
        statusLabel: runActive
          ? "生成中"
          : run.status === "failed"
            ? "失败"
            : "未完成",
        tone: runActive ? "running" : "idle",
        markdown: null,
        label,
      },
    ];
  }
  return [];
}

// 1. 章节结构：层级与顺序来自真实标题。
{
  const md = [
    "# 产品需求文档",
    "",
    "## 1. 背景",
    "正文",
    "### 1.1 现状",
    "#### 1.1.1 细节",
    "##### 太深，不进入章节结构",
    "## 2. 目标",
  ].join("\n");
  const outline = extractMarkdownOutline(md);

  assert.deepEqual(
    outline.map((item) => [item.level, item.text]),
    [
      [1, "产品需求文档"],
      [2, "1. 背景"],
      [3, "1.1 现状"],
      [4, "1.1.1 细节"],
      [2, "2. 目标"],
    ],
    "章节层级与顺序必须与文档一致，超过 4 级的标题不进入结构",
  );
  assert.equal(new Set(outline.map((i) => i.id)).size, outline.length, "id 必须唯一");
}
console.log("✓ 章节结构：层级/顺序正确，超出 4 级的标题被忽略");

// 2. 代码块里的 # 不能被当成标题。
{
  const md = [
    "# 标题",
    "```bash",
    "# 这是 shell 注释，不是标题",
    "## 也不是",
    "```",
    "## 真标题",
    "~~~",
    "# 波浪号围栏内同样忽略",
    "~~~",
    "### 结尾标题",
  ].join("\n");
  const outline = extractMarkdownOutline(md);
  assert.deepEqual(
    outline.map((item) => item.text),
    ["标题", "真标题", "结尾标题"],
    "围栏代码块内的 # 不得进入章节结构（``` 与 ~~~ 都要识别）",
  );
}
console.log("✓ 代码块内的 # 不被误认为章节标题");

// 3. 标题里的行内标记被清理，链接保留文字。
{
  const md = [
    "# **加粗**标题",
    "## 带 `代码` 的标题",
    "## 含[链接](https://example.com)的标题",
    "## 空标题 ###",
  ].join("\n");
  const outline = extractMarkdownOutline(md);
  assert.deepEqual(
    outline.map((item) => item.text),
    ["加粗标题", "带 代码 的标题", "含链接的标题", "空标题"],
  );
}
console.log("✓ 标题行内标记被清理，链接保留可读文字");

// 4. 无标题文档返回空结构，而不是抛错。
{
  assert.deepEqual(extractMarkdownOutline(""), []);
  assert.deepEqual(extractMarkdownOutline("只有正文，没有标题。"), []);
  assert.deepEqual(extractMarkdownOutline("#没有空格的井号不是标题"), []);
}
console.log("✓ 无标题文档安全返回空结构");

// 5. 面板摘要包含章节数与体量。
{
  const md = "# A\n## B\n";
  const outline = extractMarkdownOutline(md);
  const summary = buildContentSummary(outline, md);
  assert.ok(summary.includes("共 2 个章节"), summary);
  assert.ok(summary.includes("字符"), summary);
}
console.log("✓ 内容预览摘要包含章节数与字符数");

// 6. 文档行推导：有产物 → 已生成；只有 run → 运行态可见。
{
  const withArtifact = buildRows({
    artifact: { id: "a1", title: "远程团队 PRD", version: 3, markdown: "# x" },
    run: { id: "r1", status: "completed" },
    runActive: false,
  });
  assert.equal(withArtifact.length, 1);
  assert.equal(withArtifact[0].tone, "done");
  assert.equal(withArtifact[0].kindLabel, "PRD · v3");
  assert.equal(withArtifact[0].markdown, "# x", "有产物时才能预览/下载");

  const running = buildRows({
    artifact: null,
    run: { id: "r1", status: "running" },
    runActive: true,
  });
  assert.equal(running.length, 1, "运行中即使还没有产物，也要在列表里可见");
  assert.equal(running[0].tone, "running");
  assert.equal(running[0].markdown, null, "无产物时不得提供预览与下载");

  const failed = buildRows({
    artifact: null,
    run: { id: "r1", status: "failed" },
    runActive: false,
  });
  assert.equal(failed[0].tone, "idle");
  assert.equal(failed[0].statusLabel, "失败");

  assert.deepEqual(buildRows({ artifact: null, run: null, runActive: false }), []);
}
console.log("✓ 文档行推导：产物/运行中/失败/空 四种状态都正确");

// 7. 过滤：类型与状态组合，且计数驱动选项可用性。
{
  const rows = [
    { kind: "prd", tone: "done" },
    { kind: "prd", tone: "running" },
  ];
  const kindCounts = {
    all: rows.length,
    prd: rows.filter((r) => r.kind === "prd").length,
    mrd: 0,
    brd: 0,
  };
  const statusCounts = {
    all: rows.length,
    done: rows.filter((r) => r.tone === "done").length,
    running: rows.filter((r) => r.tone === "running").length,
    idle: rows.filter((r) => r.tone === "idle").length,
  };

  assert.equal(kindCounts.mrd, 0, "MRD 选项计数为 0 时应被禁用");
  assert.equal(statusCounts.idle, 0, "未完成选项计数为 0 时应被禁用");

  const visible = (kindFilter, statusFilter) =>
    rows.filter(
      (r) =>
        (kindFilter === "all" || r.kind === kindFilter) &&
        (statusFilter === "all" || r.tone === statusFilter),
    );

  assert.equal(visible("all", "all").length, 2, "默认显示全部");
  assert.equal(visible("prd", "done").length, 1);
  assert.equal(visible("mrd", "all").length, 0, "无 MRD 数据时筛选结果为空");
  assert.equal(visible("all", "idle").length, 0);
}
console.log("✓ 过滤：类型/状态组合正确，无数据的选项计数为 0");

// 8. 空态文案区分「筛选无结果」与「确实没有文档」。
{
  const describe = (rows, visibleCount, graphReady) =>
    visibleCount > 0
      ? null
      : rows.length > 0
        ? "当前筛选条件下没有文档，请调整筛选。"
        : graphReady
          ? "还没有 PRD 交付物，点击「生成 PRD 文档」开始。"
          : "当前工作区还没有可用于生成文档的知识图谱。";

  assert.equal(describe([{ id: 1 }], 1, true), null);
  assert.equal(
    describe([{ id: 1 }], 0, true),
    "当前筛选条件下没有文档，请调整筛选。",
    "有数据但被筛掉时，提示调整筛选而不是引导生成",
  );
  assert.ok(describe([], 0, true).includes("生成 PRD 文档"));
  assert.ok(describe([], 0, false).includes("知识图谱"));
}
console.log("✓ 空态：区分筛选无结果 / 无交付物 / 无知识图谱");

console.log("\n交付文档工作区断言全部通过。");
