/**
 * 双字体系统回归检查
 *
 * 固定「UI 字体与内容字体分工」这条约束，并防止重新引入文楷伪粗体：
 * 文楷只有 Regular，任何 ≥500 的字重都必须回到思源黑体表达。
 *
 * Responsibilities:
 * - 校验 font token 的角色划分与回退链
 * - 校验 @font-face 只声明真实存在的字重
 * - 校验 Ant Design 全局字体仍是 UI 字体
 * - 校验内容区域的强调与代码不会被切到文楷
 *
 * Notes:
 * - 直接读取源文件做静态断言，不需要浏览器。
 * - 运行方式：node apps/web/scripts/check-font-system.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const read = (relative) => readFileSync(resolve(webRoot, relative), "utf8");

const styles = read("src/styles.css");
const tokens = read("src/theme/design-tokens.ts");
const appTheme = read("src/theme/app-theme.ts");

/**
 * 取某个选择器的规则体；返回 null 表示规则不存在。
 *
 * 同一选择器可能在文件里出现多次（基础规则 + 媒体查询覆盖），因此支持用
 * `match` 指定第几次出现。选择器可能与其他选择器共用规则（`.a,\n.b {`），
 * 所以从匹配处向下找 `{`。
 */
function ruleBody(selector, match = 1) {
  let start = -1;
  for (let found = 0; found < match; found += 1) {
    start = styles.indexOf(`\n${selector}`, start + 1);
    if (start < 0) return null;
  }
  const open = styles.indexOf("{", start);
  const close = styles.indexOf("}", open);
  return styles.slice(open, close);
}

// 1. 字体文件真实存在，且路径与 @font-face 一致。
{
  for (const file of [
    "public/fonts/LXGWWenKaiLite-Regular.ttf",
    "public/fonts/SourceHanSansCN-Regular.otf",
    "public/fonts/SourceHanSansCN-Bold.otf",
  ]) {
    assert.ok(existsSync(resolve(webRoot, file)), `字体文件缺失：${file}`);
  }
  assert.ok(
    styles.includes('src: url("/fonts/LXGWWenKaiLite-Regular.ttf") format("truetype")'),
    "文楷 @font-face 必须指向真实文件",
  );
}
console.log("✓ 字体文件存在，@font-face 指向真实路径");

// 2. 文楷只声明 400，不得声明字重区间冒充多档。
{
  const block = /@font-face\s*\{[^}]*LXGW WenKai Lite[^}]*\}/.exec(styles);
  assert.ok(block, "必须存在文楷 @font-face");
  assert.ok(
    /font-weight:\s*400;/.test(block[0]),
    "文楷 @font-face 只能声明 font-weight: 400",
  );
  assert.ok(
    !/font-weight:\s*\d+\s+\d+/.test(block[0]),
    "不得声明 font-weight 区间（100 900 之类），那是把 Regular 冒充多个字重",
  );
}
console.log("✓ 文楷 @font-face 只声明真实字重 400");

// 3. 两种 token 角色分明，且文楷回退链里保留思源黑体。
{
  assert.ok(/--ds-font-ui:\s*"Source Han Sans CN"/.test(styles), "UI 字体以思源黑体开头");
  const content = /--ds-font-content:\s*([^;]+);/.exec(styles);
  assert.ok(content, "必须定义内容字体 token");
  assert.ok(content[1].includes('"LXGW WenKai Lite"'), "内容字体以文楷开头");
  assert.ok(
    content[1].includes('"Source Han Sans CN"'),
    "文楷回退链必须保留思源黑体，避免缺字时字体跳变",
  );

  assert.ok(/ui:\s*'"Source Han Sans CN"/.test(tokens), "design-tokens 必须导出 ui 字体");
  const tokenContent = /content:\s*\n?\s*'([^']+)'/.exec(tokens);
  assert.ok(tokenContent, "design-tokens 必须导出 content 字体");
  assert.ok(tokenContent[1].startsWith('"LXGW WenKai Lite"'));
  assert.ok(tokenContent[1].includes('"Source Han Sans CN"'));
}
console.log("✓ UI / 内容字体 token 分工正确，回退链保留思源黑体");

// 4. 旧别名指向正确的角色。
{
  assert.ok(/--reading:\s*var\(--ds-font-content\)/.test(styles), "--reading 必须指向内容字体");
  assert.ok(/--body:\s*var\(--ui\)/.test(styles), "--body 必须指向 UI 字体");
  assert.ok(/--ui:\s*var\(--ds-font-ui\)/.test(styles), "--ui 必须指向 UI 字体 token");
}
console.log("✓ --reading 指向内容字体，--body / --ui 指向 UI 字体");

// 5. Ant Design 全局字体仍是 UI 字体，不得改成文楷。
{
  assert.ok(
    /fontFamily:\s*t\.sans/.test(appTheme),
    "Ant Design fontFamily 必须保持 UI 字体，否则控件会被切到文楷",
  );
  assert.ok(
    !/fontFamily:\s*t\.content/.test(appTheme),
    "不得把 Ant Design fontFamily 指向内容字体",
  );
  assert.ok(
    !tokens.includes("fontFamily: t.content"),
    "主题映射里不得出现内容字体",
  );
}
console.log("✓ Ant Design 控件字体保持思源黑体");

// 6. 禁止文楷合成粗体：内容区域必须关闭 font-synthesis。
{
  for (const cls of [".font-reading", ".font-reading-compact", ".markdown-content"]) {
    const body = ruleBody(`${cls} {`);
    assert.ok(body, `必须存在 ${cls} 规则`);
    assert.ok(
      /font-synthesis:\s*none/.test(body),
      `${cls} 必须声明 font-synthesis: none`,
    );
  }
}
console.log("✓ 内容区域关闭 font-synthesis，杜绝文楷伪粗体");

// 7. 内容区域的强调切回 UI 字体与真实字重。
{
  assert.ok(
    /:where\(\.font-reading, \.font-reading-compact, \.markdown-content\)\s*:is\(\s*\n?\s*strong,\s*\n?\s*b\s*,?\s*\n?\s*\)/.test(
      styles,
    ),
    "strong / b 必须切回 UI 字体",
  );
  assert.ok(
    /font-weight:\s*var\(--ds-font-weight-strong\)/.test(styles),
    "强调必须使用真实字重 token，而不是让浏览器合成",
  );
  assert.ok(
    /font-family:\s*var\(--ui\) !important/.test(styles),
    "内容里的强调必须显式切回 UI 字体",
  );
}
console.log("✓ 内容里的 strong / b 切回 UI 字体 + 真实字重");

// 8. Markdown：标题与表格用 UI 字体，代码用等宽。
{
  assert.ok(
    /\.markdown-content :is\(h1, h2, h3, h4, h5, h6, table\)\s*\{\s*\n?\s*font-family:\s*var\(--ui\)/.test(
      styles,
    ),
    "Markdown 标题与表格必须使用 UI 字体",
  );
  assert.ok(
    /:where\(\.font-reading, \.font-reading-compact, \.markdown-content\)\s*:is\(\s*\n?\s*pre,\s*\n?\s*code,\s*\n?\s*kbd\s*,?\s*\n?\s*\)/.test(
      styles,
    ),
    "代码元素必须保持等宽字体",
  );
}
console.log("✓ Markdown 标题 / 表格用 UI 字体，代码保持等宽");

// 9. 内容字体行高比 UI 宽（文楷字形略松）。
{
  const body = ruleBody(".font-reading {");
  assert.ok(body, "必须存在 .font-reading 规则");
  const lh = /line-height:\s*([\d.]+)/.exec(body);
  assert.ok(lh, ".font-reading 必须显式声明行高");
  assert.ok(
    Number(lh[1]) >= 1.7,
    `内容正文字行高应 ≥1.7，当前 ${lh[1]}`,
  );
}
console.log("✓ 内容字体行高已按文楷字形放宽");

// 9b. .font-reading 边界收紧：不再用祖先选择器覆盖全部后代。
{
  assert.ok(
    !/\.font-reading\s+\.ant-typography\s*[,{]/.test(styles),
    "不得再用 `.font-reading .ant-typography` 覆盖全部后代——那会把未来放进容器的标题也变成文楷",
  );
  assert.ok(
    !/\.font-reading-compact\s+\.ant-typography\s*[,{]/.test(styles),
    "紧凑内容类同样不得用过宽的后代选择器",
  );

  // 容器本身仍然提供内容字体（直接以类名标注的一段正文）。
  for (const cls of [".font-reading", ".font-reading-compact"]) {
    const body = ruleBody(`${cls} {`);
    assert.ok(
      /font-family:\s*var\(--reading\) !important/.test(body ?? ""),
      `${cls} 容器本身必须提供内容字体`,
    );
  }

  // 内容容器内的标题与 UI 标签必须显式切回界面字体。
  const uiDescendants =
    /:where\(\.font-reading, \.font-reading-compact, \.markdown-content\)\s*:is\(\s*\n?\s*h1,\s*\n?\s*h2,/;
  assert.ok(
    uiDescendants.test(styles),
    "内容容器内的 h1–h6 必须显式声明界面字体，而不是靠继承",
  );
}
console.log("✓ .font-reading 边界收紧：容器提供内容字体，标题/标签显式回到界面字体");

// 9c. Ant Design Select 选项保持界面字体。
{
  const option = ruleBody(
    ".question-form-options .ant-select-item-option-content,",
  );
  assert.ok(option, "必须存在问题表单的 Select 选项规则");
  assert.ok(
    /font-family:\s*var\(--ui\) !important/.test(option),
    "Select 选项属于 UI Control，必须使用界面字体",
  );
  assert.ok(
    !/font-family:\s*var\(--reading\)/.test(option),
    "Select 选项不得使用内容字体",
  );
}
console.log("✓ Select / Dropdown 选项保持界面字体");

// 9d. 禁止 synthetic italic：字体合成兜底 + em/i 直立。
{
  /*
   * 文件里有多个 body 规则，这里按内容定位「字体合成兜底」那一条，
   * 不依赖规则顺序。
   */
  const synthesisBlock = /body\s*\{([^}]*font-synthesis[^}]*)\}/.exec(styles);
  assert.ok(synthesisBlock, "必须存在声明 font-synthesis 的 body 规则");
  assert.ok(
    /font-synthesis:\s*none/.test(synthesisBlock[1]) ||
      /font-synthesis-style:\s*none/.test(synthesisBlock[1]),
    "body 必须禁用字体合成（含 synthetic style）",
  );

  const emphasis =
    /:where\(\.font-reading, \.font-reading-compact, \.markdown-content\)\s*:is\(em, i\)\s*\{([^}]*)\}/.exec(
      styles,
    );
  assert.ok(emphasis, "必须为内容区域的 em / i 定义规则");
  assert.ok(
    /font-style:\s*normal/.test(emphasis[1]),
    "em / i 必须保持直立，不得生成假斜体",
  );
  assert.ok(
    /font-synthesis-style:\s*none/.test(emphasis[1]),
    "em / i 必须显式禁用样式合成",
  );
  assert.ok(
    /font-family:\s*var\(--reading\)/.test(emphasis[1]),
    "em / i 保持内容字体 Regular，不切换到另一套字体",
  );
}
console.log("✓ 内容字体不产生 synthetic italic（em / i 直立 + 合成已禁用）");

// 10. 语义角色映射：UI 结构元素不得使用内容字体，自然语言正文必须使用内容字体。
{
  /** 该选择器是否声明了内容字体。 */
  const usesContent = (selector) =>
    /font-family:\s*var\(--reading\)/.test(ruleBody(selector) ?? "");

  // 必须是内容字体（自然语言 / 阅读）
  const contentRequired = [
    ".hitl-form-description",
    ".hitl-form-help",
    ".hitl-answer dd",
    ".task-block-text",
    ".exec-block p",
    ".overview-note",
    ".conversation-welcome p",
    ".workspace-page-empty span",
    ".overview-identity p",
    ".kg-float-hint",
    ".typed-body",
  ];
  for (const selector of contentRequired) {
    assert.ok(usesContent(selector), `${selector} 属于自然语言内容，应使用内容字体`);
  }

  // 必须是界面字体（结构 / 标签 / 元信息）：这些规则不应声明内容字体
  const uiRequired = [
    ".task-block-pre",
    ".kg-detail-row dd",
    ".exec-tool-name",
    ".storage-status",
    ".profile-summary-meta",
    ".sync-detail-more dd",
  ];
  for (const selector of uiRequired) {
    assert.ok(
      !usesContent(selector),
      `${selector} 属于技术信息 / 元信息，不得使用内容字体`,
    );
  }

  // 页面与 Section 标题保持界面字体
  for (const selector of [".overview-identity h2", ".conversation-welcome h1"]) {
    assert.ok(!usesContent(selector), `${selector} 是页面标题，必须使用界面字体`);
  }
  // 结构标签保持界面字体
  for (const selector of [".exec-block h4", ".hitl-form-label", ".hitl-answer dt"]) {
    assert.ok(!usesContent(selector), `${selector} 是结构标签，必须使用界面字体`);
  }
}
console.log("✓ 语义角色映射：内容字体与界面字体各归其位");

// 11. 混合内容分层：结构前缀用界面字体，正文用内容字体。
{
  assert.ok(/\.typed-label\s*\{[^}]*font-family:\s*var\(--ui\)/.test(styles),
    "分层前缀必须使用界面字体");
  assert.ok(/\.typed-body\s*\{[^}]*font-family:\s*var\(--reading\)/.test(styles),
    "分层正文必须使用内容字体");
  assert.ok(
    !/\.typed-label\s*\{[^}]*font-weight:\s*(600|700|bold)/.test(styles),
    "分层前缀不得加粗：它在内容区是标记而不是强调",
  );
}
console.log("✓ 混合内容前缀 / 正文分层正确，前缀不加粗");

// 12. 内容字体规则不得出现 ≥500 的字重声明。
{
  /**
   * 内容字体自身（而非其中的 strong/b）不允许声明中等以上字重，
   * 否则文楷没有对应字形，浏览器会合成伪粗体。
   */
  const contentRules = [
    ".font-reading, .font-reading .ant-typography",
    ".font-reading-compact, .font-reading-compact .ant-typography",
    ".markdown-content",
    ".typed-body",
    ".task-block-text",
    ".hitl-form-description",
    ".hitl-form-help",
    ".hitl-answer dd",
    ".overview-note",
    ".exec-block p",
  ];
  for (const selector of contentRules) {
    const body = ruleBody(selector);
    const weight = /font-weight:\s*(600|700|bold|\d{3})/.exec(body ?? "");
    assert.ok(
      !weight || Number(weight[1]) < 500,
      `${selector} 不得声明 ≥500 字重（会触发文楷合成粗体）：${weight?.[0]}`,
    );
  }
}
console.log("✓ 内容字体规则无 ≥500 字重，不会触发合成粗体");

// 13. 内容正文行高比 UI 舒展，但不改动 Ant Design 全局行高。
{
  const body = ruleBody(".font-reading {");
  const lh = /line-height:\s*([\d.]+)/.exec(body ?? "");
  assert.ok(lh, "必须找到 .font-reading 行高声明");
  assert.ok(Number(lh[1]) >= 1.7, `内容正文行高应 ≥1.7，当前 ${lh[1]}`);

  const compact = ruleBody(".font-reading-compact {");
  const compactLh = /line-height:\s*([\d.]+)/.exec(compact ?? "");
  assert.ok(compactLh, "必须找到 .font-reading-compact 行高声明");
  assert.ok(
    Number(compactLh[1]) >= 1.65,
    `紧凑内容行高应 ≥1.65，当前 ${compactLh[1]}`,
  );

  assert.ok(
    /lineHeight:\s*t\.lineHeight/.test(appTheme),
    "Ant Design 全局 lineHeight 不得因内容字体被改动",
  );
}
console.log("✓ 内容行高更舒展，Ant Design 全局行高未改动");

console.log("\n双字体系统断言全部通过。");
