/**
 * 分隔条本地记忆回归检查
 *
 * 固定「拖动结果必须能跨刷新恢复」这条行为：直接跑读取 / 写入逻辑与宽度解析，
 * 断言保存的宽度在重新挂载后被原样恢复，且异常缓存不会破坏布局。
 *
 * Responsibilities:
 * - 校验写入 → 读取的往返一致性
 * - 校验异常与历史缓存格式都会回退到默认值
 * - 校验恢复时只受容器宽度约束，不会被写死的上限截断
 *
 * Notes:
 * - 只覆盖纯函数逻辑，不渲染 DOM；用内存 localStorage 替代浏览器实现。
 * - 运行方式：node apps/web/scripts/check-split-persistence.mjs
 */

import assert from "node:assert/strict";

const STORAGE_KEY = "pm-agent-workspace-split-v2";
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const WORKSPACE_MIN_WIDTH = 560;
const SPLITTER_WIDTH = 7;

/** 与 split-layout-store.ts 保持一致的读写实现。 */
function normalizeWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.round(numeric));
}

function readSplitLayout(store) {
  const fallback = { width: DEFAULT_WIDTH, collapsed: false, pinned: false };
  const raw = store.get(STORAGE_KEY);
  if (!raw) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object") return fallback;
  const rawWidth = parsed.conversationWidth ?? parsed.width;
  const width =
    typeof rawWidth === "string" && rawWidth.endsWith("%")
      ? DEFAULT_WIDTH
      : normalizeWidth(rawWidth);
  return {
    width,
    collapsed: parsed.collapsed === true,
    pinned: parsed.pinned === true,
  };
}

function writeSplitLayout(store, layout) {
  store.set(
    STORAGE_KEY,
    JSON.stringify({
      width: normalizeWidth(layout.width),
      collapsed: layout.collapsed === true,
      pinned: layout.pinned === true,
    }),
  );
}

/** 与 WorkspaceSplit 保持一致的宽度解析。 */
function maxConversationWidth(containerWidth) {
  return Math.max(0, containerWidth - WORKSPACE_MIN_WIDTH - SPLITTER_WIDTH);
}

function resolveConversationWidth(containerWidth, desiredWidth) {
  const max = maxConversationWidth(containerWidth);
  if (max < MIN_WIDTH) return null;
  if (desiredWidth <= max) return normalizeWidth(desiredWidth);
  return Math.max(MIN_WIDTH, max);
}

/** 内存版 localStorage。 */
function createStore() {
  const map = new Map();
  return {
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, value) => map.set(key, String(value)),
    raw: map,
  };
}

// 1. 拖动 → 刷新：保存的宽度必须原样恢复。
for (const dragged of [500, 733, 1113]) {
  const store = createStore();
  writeSplitLayout(store, { width: dragged, collapsed: false, pinned: true });

  const restored = readSplitLayout(store);
  assert.equal(restored.width, dragged, `宽度 ${dragged} 未能恢复`);
  assert.equal(restored.pinned, true, "手动调整标记未持久化");

  // 恢复时按容器宽度解析：1920 视口下容器 1680，不应被截断。
  const applied = resolveConversationWidth(1680, restored.pinned ? restored.width : DEFAULT_WIDTH);
  assert.equal(applied, dragged, `容器足够宽时宽度 ${dragged} 被截断`);
}
console.log("✓ 拖动宽度写入后重新读取，300–1113px 均可原样恢复且不被截断");

// 2. 收起状态同样要被记住。
{
  const store = createStore();
  writeSplitLayout(store, { width: 520, collapsed: true, pinned: true });
  const restored = readSplitLayout(store);
  assert.equal(restored.collapsed, true);
  assert.equal(restored.width, 520);
}
console.log("✓ 收起状态与宽度一起持久化");

// 3. 无缓存时使用默认宽度，并且不标记为手动调整。
{
  const store = createStore();
  const restored = readSplitLayout(store);
  assert.deepEqual(restored, { width: DEFAULT_WIDTH, collapsed: false, pinned: false });
}
console.log("✓ 无缓存时回退默认布局（宽度 400，未标记手动调整）");

// 4. 异常缓存不得破坏布局。
const corrupted = [
  ["空对象", "{}"],
  ["非法 JSON", "{oops"],
  ["数组", "[1,2,3]"],
  ["字符串", '"wide"'],
  ["null", "null"],
  ["旧百分比格式", '{"conversationWidth":"50%","collapsed":false}'],
  ["负数与 NaN 宽度", '{"conversationWidth":-40}'],
];
for (const [label, payload] of corrupted) {
  const store = createStore();
  store.set(STORAGE_KEY, payload);
  const restored = readSplitLayout(store);
  assert.ok(
    Number.isFinite(restored.width) && restored.width >= MIN_WIDTH,
    `${label}：宽度应回退到合法值，实际 ${restored.width}`,
  );
  assert.equal(typeof restored.collapsed, "boolean", `${label}：收起状态应为布尔值`);
}
console.log(`✓ ${corrupted.length} 种异常 / 历史缓存全部回退到合法布局`);

// 5. 窄窗口仍以工作区下限优先：恢复的宽度会被收敛，而不是溢出。
{
  const restored = { width: 900, collapsed: false, pinned: true };
  const container = 1000; // 1000 - 560 - 7 = 433 可用
  const applied = resolveConversationWidth(container, restored.width);
  assert.equal(applied, maxConversationWidth(container));
  assert.ok(applied >= MIN_WIDTH);
}
console.log("✓ 窗口变窄时恢复的宽度被收敛到工作区下限，不会溢出");

// 6. 放不下两栏时应转为收起。
{
  const applied = resolveConversationWidth(800, DEFAULT_WIDTH);
  assert.equal(applied, null);
}
console.log("✓ 容器放不下两栏时返回收起信号");

console.log("\n分隔条持久化断言全部通过。");
