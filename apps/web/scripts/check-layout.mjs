/**
 * 工作区栏宽分配回归检查
 *
 * 用可执行的断言固定「侧栏 + 对话栏 + 工作区面板」的宽度分配规则，避免后续
 * 调整再次出现工作区被压缩到几百像素、或对话栏被写死上限拖不动的问题。
 *
 * Responsibilities:
 * - 校验 1280 / 1440 / 1920 视口下的栏宽分配
 * - 校验向右拖动只受工作区下限约束，不存在固定上限
 * - 校验工作区始终获得不低于下限的宽度
 *
 * Notes:
 * - 只覆盖尺寸计算，不渲染 DOM、不访问网络。
 * - 运行方式：node apps/web/scripts/check-layout.mjs
 */

import assert from "node:assert/strict";

const SIDEBAR_WIDTH = 240;
const CONVERSATION_DEFAULT_WIDTH = 400;
const CONVERSATION_HARD_MIN_WIDTH = 300;
const WORKSPACE_MIN_WIDTH = 560;
const SPLITTER_WIDTH = 7;

/** 与 WorkspaceSplit.maxConversationWidth 保持一致。 */
function maxConversationWidth(containerWidth) {
  return Math.max(0, containerWidth - WORKSPACE_MIN_WIDTH - SPLITTER_WIDTH);
}

/** 与 WorkspaceSplit.resolveConversationWidth 保持一致。 */
function resolveConversationWidth(containerWidth, desiredWidth) {
  const max = maxConversationWidth(containerWidth);
  if (max < CONVERSATION_HARD_MIN_WIDTH) return null;
  if (desiredWidth <= max) return Math.max(CONVERSATION_HARD_MIN_WIDTH, desiredWidth);
  return Math.max(CONVERSATION_HARD_MIN_WIDTH, max);
}

/** 计算某一视口宽度下的三栏尺寸；conversation 为 null 表示对话栏收起。 */
function layoutAt(
  viewportWidth,
  { collapsed = false, desiredWidth = CONVERSATION_DEFAULT_WIDTH } = {},
) {
  const containerWidth = viewportWidth - SIDEBAR_WIDTH;
  const conversation = collapsed
    ? null
    : resolveConversationWidth(containerWidth, desiredWidth);
  const workspace =
    conversation === null
      ? containerWidth
      : containerWidth - conversation - SPLITTER_WIDTH;
  return { containerWidth, conversation, workspace };
}

const cases = [
  { viewport: 1920, conversation: 400, workspace: 1273 },
  { viewport: 1440, conversation: 400, workspace: 793 },
  { viewport: 1280, conversation: 400, workspace: 633 },
];

for (const testCase of cases) {
  const layout = layoutAt(testCase.viewport);
  assert.equal(
    layout.conversation,
    testCase.conversation,
    `${testCase.viewport}px：对话栏宽度应保持默认值`,
  );
  assert.equal(
    layout.workspace,
    testCase.workspace,
    `${testCase.viewport}px：工作区应占满剩余空间`,
  );
  assert.ok(
    layout.workspace >= WORKSPACE_MIN_WIDTH,
    `${testCase.viewport}px：工作区不得低于可用下限`,
  );
  console.log(
    `✓ ${testCase.viewport}px → 侧栏 ${SIDEBAR_WIDTH} / 对话栏 ${layout.conversation} / 工作区 ${layout.workspace}`,
  );
}

// 向右拖动：不存在固定上限，宽度随拖动增长，直到工作区触到下限。
const dragSteps = [500, 700, 900];
for (const desired of dragSteps) {
  const layout = layoutAt(1920, { desiredWidth: desired });
  assert.equal(
    layout.conversation,
    desired,
    `1920px 拖到 ${desired}px 时不应被上限截断`,
  );
  assert.equal(layout.workspace, 1920 - SIDEBAR_WIDTH - desired - SPLITTER_WIDTH);
}
console.log(
  `✓ 1920px 向右拖动 → 对话栏可到 ${dragSteps.join(" / ")}，工作区同步收缩且不低于下限`,
);

// 触到工作区下限后停止：此时对话栏拿到容器内的最大值。
const atLimit = layoutAt(1920, { desiredWidth: 5000 });
assert.equal(atLimit.conversation, maxConversationWidth(1680));
assert.equal(atLimit.workspace, WORKSPACE_MIN_WIDTH);
console.log(
  `✓ 1920px 拖到底 → 对话栏上限 ${atLimit.conversation}（= 容器 − 工作区下限），工作区 ${atLimit.workspace}`,
);

// 上限随视口变化，不是固定值。
const limitAt1440 = maxConversationWidth(1440 - SIDEBAR_WIDTH);
const limitAt1280 = maxConversationWidth(1280 - SIDEBAR_WIDTH);
assert.ok(
  limitAt1440 > limitAt1280,
  "对话栏上限必须随容器宽度变化，而不是固定常量",
);
console.log(
  `✓ 上限随视口变化 → 1440px 时 ${limitAt1440}，1280px 时 ${limitAt1280}`,
);

// 窄窗口：先把对话栏收窄，绝不为对话栏牺牲工作区。
const narrowed = layoutAt(1140);
assert.equal(narrowed.workspace, WORKSPACE_MIN_WIDTH);
assert.ok(narrowed.conversation < CONVERSATION_DEFAULT_WIDTH);
console.log(
  `✓ 1140px → 对话栏收窄到 ${narrowed.conversation}，工作区保持 ${narrowed.workspace}`,
);

// 更窄：收窄到硬下限，再窄就收起对话栏。
const hardMin = layoutAt(1107);
assert.equal(hardMin.conversation, CONVERSATION_HARD_MIN_WIDTH);
assert.equal(hardMin.workspace, WORKSPACE_MIN_WIDTH);
console.log(
  `✓ 1107px → 对话栏到硬下限 ${hardMin.conversation}，工作区仍为 ${hardMin.workspace}`,
);

const collapsed = layoutAt(1000);
assert.equal(collapsed.conversation, null);
assert.equal(collapsed.workspace, 760);
console.log(`✓ 1000px → 对话栏收起，工作区 ${collapsed.workspace}`);

// 收起状态下工作区直接等于内容区宽度。
const collapsedAt1440 = layoutAt(1440, { collapsed: true });
assert.equal(collapsedAt1440.workspace, 1200);
console.log(`✓ 1440px（对话栏已收起）→ 工作区 ${collapsedAt1440.workspace}`);

// 无对话栏路由（交付文档）与收起状态一致。
assert.equal(
  collapsedAt1440.workspace,
  collapsedAt1440.containerWidth,
  "无对话栏时工作区必须等于内容区宽度",
);
console.log("✓ 无对话栏路由 → 工作区占满内容区");

console.log("\n布局断言全部通过。");
