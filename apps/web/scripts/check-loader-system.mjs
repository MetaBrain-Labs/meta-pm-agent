/**
 * 加载体系回归检查
 *
 * 固定「按 Loading Scope 选择动画」这条规则，并防止两类问题回潮：
 * - 业务状态被通用 Loader 取代（进度、HITL、同步状态等必须继续显示）；
 * - 同一 scope 内两套 Loader 同时出现。
 *
 * Responsibilities:
 * - 校验两套资产的真实路径与静态首帧
 * - 校验 GlobalLoader 的 scope → 资产映射
 * - 校验延迟 / 最短可见阈值来自统一令牌
 * - 校验业务状态未被 Loader 覆盖
 *
 * Notes:
 * - 静态断言源文件，不渲染 DOM、不访问网络。
 * - 运行方式：node apps/web/scripts/check-loader-system.mjs
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const read = (relative) => readFileSync(resolve(webRoot, relative), "utf8");
const exists = (relative) => existsSync(resolve(webRoot, relative));

const loader = read("src/components/ui/GlobalLoader.tsx");
const styles = read("src/styles.css");
const tokens = read("src/theme/design-tokens.ts");
const delayHook = read("src/hooks/useDelayedLoading.ts");

// 1. 两套资产存在，且动画文件保留 SMIL。
{
  const assets = [
    "public/loaders/workspace-loader.svg",
    "public/loaders/workspace-loader-static.svg",
    "public/loaders/section-loader.svg",
    "public/loaders/section-loader-static.svg",
  ];
  for (const asset of assets) {
    assert.ok(exists(asset), `缺少加载资产：${asset}`);
  }

  const workspace = read("public/loaders/workspace-loader.svg");
  const section = read("public/loaders/section-loader.svg");
  assert.ok(
    /<animate\b/.test(workspace) && /<animateTransform\b/.test(workspace),
    "工作区加载资产必须保留原始 SMIL 动画",
  );
  assert.ok(
    /<animate\b/.test(section),
    "局部加载资产必须保留原始 path morph 动画",
  );
  // 原始比例：横向 vs 正方形，不得互相替换。
  assert.ok(
    /viewBox="0 0 280 200"/.test(workspace),
    "工作区加载资产是横向比例，不得改成正方形",
  );
  assert.ok(
    /viewBox="0 0 1080 1080"/.test(section),
    "局部加载资产是正方形",
  );

  // 静态首帧：同一几何，去掉动画。
  for (const staticAsset of [
    "public/loaders/workspace-loader-static.svg",
    "public/loaders/section-loader-static.svg",
  ]) {
    const content = read(staticAsset);
    assert.ok(
      !/<animate\b|<animateTransform\b/.test(content),
      `${staticAsset} 必须是静态首帧（不含动画元素）`,
    );
    assert.ok(/<path\b/.test(content), `${staticAsset} 必须保留原始图形`);
  }
}
console.log("✓ 两套资产存在，动画保留 SMIL，静态首帧已派生");

// 2. 资产体积合理：不做 Base64 内联、不转 GIF。
{
  for (const asset of [
    "public/loaders/workspace-loader.svg",
    "public/loaders/section-loader.svg",
  ]) {
    const size = statSync(resolve(webRoot, asset)).size;
    assert.ok(size > 0 && size < 2_000_000, `${asset} 体积异常：${size}`);
  }
  assert.ok(
    !/data:image\/svg\+xml;base64/.test(loader),
    "不得把 SVG 转成 Base64 内联",
  );
  assert.ok(!/\.gif/.test(loader), "不得使用 GIF");
}
console.log("✓ 资产以文件外链使用，未 Base64、未转 GIF");

// 3. scope → 资产映射：业务代码不知道具体文件名。
{
  assert.ok(
    /workspace:\s*\{[\s\S]*?animated:\s*"\/loaders\/workspace-loader\.svg"[\s\S]*?static:\s*"\/loaders\/workspace-loader-static\.svg"/.test(
      loader,
    ),
    "workspace scope 必须映射到品牌级资产",
  );
  assert.ok(
    /section:\s*\{[\s\S]*?animated:\s*"\/loaders\/section-loader\.svg"[\s\S]*?static:\s*"\/loaders\/section-loader-static\.svg"/.test(
      loader,
    ),
    "section scope 必须映射到局部资产",
  );
  assert.ok(
    /export type LoaderScope = "workspace" \| "section" \| "inline"/.test(loader),
    "必须提供 workspace / section / inline 三个层级",
  );
  assert.ok(
    /scope="workspace"[\s\S]*?label=/.test(loader) ||
      /scope === "workspace"/.test(loader) ||
      /ASSETS\[scope\]/.test(loader),
    "资产必须由 scope 决定，而不是调用方直接指定文件",
  );
}
console.log("✓ 业务侧只表达 scope，资产映射集中在 GlobalLoader");

// 4. 用 <img> 外链，保证 SMIL 不被构建链改写。
{
  assert.ok(
    /<img[\s\S]*?src=\{source\}/.test(loader),
    "必须用 <img> 外链加载资产，避免 SVG 转换破坏 SMIL",
  );
  assert.ok(
    !/dangerouslySetInnerHTML/.test(loader),
    "不得内联 SVG 标记",
  );
}
console.log("✓ 以 <img> 外链加载，SMIL 不会被构建链改写");

// 5. 延迟与最短可见阈值来自统一令牌。
{
  assert.ok(
    /loading:\s*\{\s*delay:\s*\d+,\s*minVisible:\s*\d+\s*\}/.test(tokens),
    "必须在设计令牌里集中定义 loading.delay / minVisible",
  );
  assert.ok(
    /DESIGN_TOKENS\.loading/.test(delayHook),
    "延迟 Hook 必须读取统一令牌，不得各页面写死毫秒数",
  );
  assert.ok(
    /LOADING_TIMING/.test(delayHook),
    "应导出阈值快照供断言与文档使用",
  );
}
console.log("✓ 延迟 / 最短可见阈值集中在设计令牌");

// 6. Reduced Motion：使用静态首帧，不另做资产。
{
  assert.ok(
    /usePrefersReducedMotion/.test(loader),
    "GlobalLoader 必须感知 reduced motion",
  );
  assert.ok(
    /reducedMotion \? asset\.static : asset\.animated/.test(loader),
    "reduced motion 时必须切换到同一资产的静态首帧",
  );
  const hook = read("src/hooks/usePrefersReducedMotion.ts");
  assert.ok(
    /prefers-reduced-motion: reduce/.test(hook),
    "必须订阅 prefers-reduced-motion",
  );
}
console.log("✓ Reduced Motion 使用同一资产的静态首帧");

// 7. Layout Shift：wrapper 固定尺寸。
{
  for (const rule of [".loader-art", ".loader-dots i", ".loader-workspace .loader-art"]) {
    const idx = styles.indexOf(`\n${rule}`);
    assert.ok(idx >= 0, `必须存在 ${rule} 规则`);
  }
  assert.ok(
    /\.loader-art\s*\{[^}]*object-fit:\s*contain/.test(styles),
    "资产必须等比缩放，不拉伸",
  );
  assert.ok(
    /\.loader-section \.loader-art\s*\{[^}]*height:\s*auto/.test(styles),
    "局部加载的 wrapper 必须固定比例，动画不影响盒模型",
  );
}
console.log("✓ Loader wrapper 固定尺寸，动画不影响布局");

// 8. 加载文案使用界面字体，不使用内容字体。
{
  const idx = styles.indexOf("\n.loader-label");
  assert.ok(idx >= 0, "必须存在 .loader-label 规则");
  const body = styles.slice(styles.indexOf("{", idx), styles.indexOf("}", idx));
  assert.ok(
    /font-family:\s*var\(--ui\)/.test(body),
    "加载文案属于 UI 信息，必须使用界面字体",
  );
  assert.ok(
    !/var\(--reading\)/.test(body),
    "加载文案不得使用内容字体",
  );
}
console.log("✓ 加载文案使用界面字体");

// 9. 业务状态不得被通用 Loader 取代。
{
  // 评分进度必须继续显示 n/3 轮，而不是只显示一个 Loader。
  const doc = read("src/pages/documents/DocumentPlanningPage.tsx");
  assert.ok(
    /<Tag>\{attempts\.length\}\/3 轮<\/Tag>/.test(doc),
    "评分轮次是业务进度，必须继续显示",
  );
  // HITL 表单不得被 Loader 取代。
  const chat = read("src/components/ChatApp.tsx");
  assert.ok(
    /pendingForm \?/.test(chat) && /QuestionFormView/.test(chat),
    "HITL 待答表单必须继续渲染表单，不能显示 Loading",
  );
  // Agent 执行状态由时间线表达。
  const timeline = read("src/components/ConversationExecution.tsx");
  assert.ok(
    /ExecutionRunGroup|ExecutionStepRow/.test(timeline),
    "Agent 执行必须由时间线表达",
  );
  assert.ok(
    !/GlobalLoader/.test(timeline),
    "执行时间线不得引入通用 Loader 取代业务状态",
  );
  // 同步状态本身仍是状态文字。
  const sync = read("src/components/shell/WorkspaceSyncStatus.tsx");
  assert.ok(
    /已同步|sync-summary|buildSyncSummary/.test(sync) ||
      /buildSyncSummary/.test(read("src/utils/workspace-sync-status.ts")),
    "同步状态必须仍由状态文案表达",
  );
}
console.log("✓ 业务状态（进度 / HITL / 执行 / 同步）未被通用 Loader 取代");

// 10. 同一 scope 不出现两套 Loader。
{
  // 工作区级加载门只在 workspaceId 变化时接管，面板内部不重复显示。
  const gate = read("src/components/shell/WorkspaceLoadingGate.tsx");
  assert.ok(
    /readyId !== workspaceId/.test(gate),
    "加载门只在切换期间接管内容",
  );
  assert.ok(
    /scope="workspace"/.test(gate),
    "加载门使用工作区级动画",
  );
  // 图谱面板与画布是两个前后阶段，不得同时在 DOM 中出现两套。
  const panel = read("src/components/shell/KnowledgeGraphPanel.tsx");
  const view = read("src/components/KnowledgeGraphView.tsx");
  assert.ok(
    /scope="workspace"/.test(panel) && /scope="workspace"/.test(view),
    "图谱面板与画布各自承担一个阶段的加载",
  );
  assert.ok(
    /!hasGraph && \(loading \|\| !attempted\)/.test(panel),
    "面板加载只在尚无内容时出现，有内容时不再显示",
  );
}
console.log("✓ 同一 scope 只有一套 Loader");

// 11. 骨架不得用「列表已非空」当作加载完成判据。
{
  /*
   * 「最近更新」的会话事件来自 props，列表一开始就非空，
   * 因此 `timeline.length === 0` 永远为假——按它判断会永远不显示骨架。
   * 必须按事件来源分别记录是否已结束取数。
   */
  const overview = read("src/components/shell/ProjectOverviewPanel.tsx");
  assert.ok(
    /settled/.test(overview),
    "概览必须按事件来源记录取数是否结束",
  );
  assert.ok(
    /!settled\.graph/.test(overview) && /!settled\.document/.test(overview),
    "尚未返回的事件源必须显示占位行",
  );
  assert.ok(
    /is-placeholder/.test(overview),
    "占位行需要独立标识，才能隐藏时间线圆点与连接线",
  );
  assert.ok(
    !/loading && timeline\.length === 0/.test(overview),
    "不得再用列表长度判断时间线是否加载完成",
  );
}
console.log("✓ 骨架按事件来源判定，不依赖列表长度");

console.log("\n加载体系断言全部通过。");
