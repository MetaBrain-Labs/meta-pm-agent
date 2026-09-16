/**
 * 工作区同步状态推导回归检查
 *
 * 固定「Header 同步状态只表达真实信息」这条约束：状态由产物行推导，异常优先于
 * 正常，且不引入契约里不存在的字段（例如同步时间戳）。
 *
 * Responsibilities:
 * - 校验五种磁盘状态到展示状态的映射
 * - 校验异常 / 待同步 / 已同步的优先级
 * - 校验运行中任务时的文案与禁用原因
 *
 * Notes:
 * - 只覆盖纯函数推导，不渲染 DOM、不访问网络。
 * - 运行方式：node apps/web/scripts/check-workspace-sync.mjs
 */

import assert from "node:assert/strict";

/** 与 utils/workspace-sync-status.ts 的 ENTRY_LABELS 保持一致。 */
const ENTRY_LABELS = {
  empty: "尚未生成",
  synced: "已同步",
  missing: "待同步",
  conflict: "内容冲突",
  unavailable: "不可用",
};

function describeEntryStatus(status) {
  if (!status) return "未知";
  return ENTRY_LABELS[status] ?? status;
}

/** 与 buildSyncSummary 保持一致。 */
function buildSyncSummary({ status, error, syncing, disabled }) {
  if (error) {
    return {
      tone: "failed",
      label: "同步失败",
      blockers: [error],
      known: true,
    };
  }
  if (!status) {
    return {
      tone: syncing ? "running" : "pending",
      label: syncing ? "同步中" : "读取中",
      blockers: [],
      known: false,
    };
  }
  const entries = [status.context, status.prd];
  const failed = entries.filter(
    (e) => e.status === "conflict" || e.status === "unavailable",
  );
  const pending = entries.filter(
    (e) => e.status === "missing" || e.status === "empty",
  );
  const blockers = [
    ...new Set([
      ...failed.map((e) => e.message).filter(Boolean),
      ...status.warnings,
    ]),
  ];
  if (failed.length > 0) {
    return { tone: "failed", label: "同步失败", blockers, known: true };
  }
  if (pending.length > 0) {
    return {
      tone: "pending",
      label: syncing ? "同步中" : "待同步",
      description: disabled
        ? "本地副本需要同步，当前任务结束后可以重新同步。"
        : "本地副本需要同步，重新同步只补齐缺失文件。",
      blockers,
      known: true,
    };
  }
  return {
    tone: syncing ? "running" : "synced",
    label: syncing ? "同步中" : "已同步",
    blockers,
    known: true,
  };
}

const entry = (status, extra = {}) => ({ path: null, status, ...extra });

// 1. 两行都同步 → 已同步。
{
  const s = buildSyncSummary({
    status: { context: entry("synced"), prd: entry("synced"), warnings: [] },
    error: null,
    syncing: false,
    disabled: false,
  });
  assert.equal(s.tone, "synced");
  assert.equal(s.label, "已同步");
  assert.equal(s.known, true);
  assert.deepEqual(s.blockers, []);
}
console.log("✓ 两行已同步 → 已同步（正常状态保持最弱）");

// 2. 任一行缺失 / 未生成 → 待同步。
{
  for (const status of ["missing", "empty"]) {
    const s = buildSyncSummary({
      status: { context: entry(status), prd: entry("synced"), warnings: [] },
      error: null,
      syncing: false,
      disabled: false,
    });
    assert.equal(s.tone, "pending", `${status} 应判为待同步`);
    assert.equal(s.label, "待同步");
  }
}
console.log("✓ 存在未同步产物 → 待同步");

// 3. 冲突 / 不可用 → 同步失败，且优先于待同步。
{
  const s = buildSyncSummary({
    status: {
      context: entry("conflict", { message: "本地内容与已保存数据不同" }),
      prd: entry("missing"),
      warnings: ["磁盘不可写"],
    },
    error: null,
    syncing: false,
    disabled: false,
  });
  assert.equal(s.tone, "failed", "失败态必须优先于待同步");
  assert.ok(s.blockers.includes("本地内容与已保存数据不同"));
  assert.ok(s.blockers.includes("磁盘不可写"), "契约 warnings 也要进入阻碍列表");

  const unavailable = buildSyncSummary({
    status: { context: entry("unavailable"), prd: entry("synced"), warnings: [] },
    error: null,
    syncing: false,
    disabled: false,
  });
  assert.equal(unavailable.tone, "failed");
}
console.log("✓ 冲突 / 不可用 → 同步失败，优先于待同步");

// 4. 读取失败 → 同步失败，并保留原因。
{
  const s = buildSyncSummary({
    status: null,
    error: "本地同步状态暂不可用。",
    syncing: false,
    disabled: false,
  });
  assert.equal(s.tone, "failed");
  assert.deepEqual(s.blockers, ["本地同步状态暂不可用。"]);
}
console.log("✓ 读取失败 → 同步失败并保留原因");

// 5. 未拿到状态时不谎报"已同步"。
{
  const s = buildSyncSummary({
    status: null,
    error: null,
    syncing: false,
    disabled: false,
  });
  assert.equal(s.known, false, "尚未拿到真实状态时必须标记为未知");
  assert.notEqual(s.label, "已同步");
}
console.log("✓ 状态未知时不谎报已同步");

// 6. 运行中任务：文案说明原因，且同步按钮禁用依据不变。
{
  const s = buildSyncSummary({
    status: { context: entry("missing"), prd: entry("missing"), warnings: [] },
    error: null,
    syncing: false,
    disabled: true,
  });
  assert.ok(
    s.description.includes("当前任务结束后可以重新同步"),
    "运行中任务必须解释为什么现在不能同步",
  );

  const enabled = buildSyncSummary({
    status: { context: entry("missing"), prd: entry("missing"), warnings: [] },
    error: null,
    syncing: false,
    disabled: false,
  });
  assert.ok(!enabled.description.includes("当前任务结束后"));
}
console.log("✓ 运行中任务给出可同步时机，不改变同步约束");

// 7. 契约里没有同步时间戳，因此状态推导不能凭空产生时间字段。
{
  const s = buildSyncSummary({
    status: { context: entry("synced"), prd: entry("synced"), warnings: [] },
    error: null,
    syncing: false,
    disabled: false,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(s, "lastSyncedAt"),
    false,
    "契约无时间戳字段，不得伪造「最后同步时间」",
  );
}
console.log("✓ 不伪造契约中不存在的同步时间");

// 8. 产物状态文案覆盖契约里的全部枚举值。
{
  const contractStates = ["empty", "synced", "missing", "conflict", "unavailable"];
  for (const state of contractStates) {
    const label = describeEntryStatus(state);
    assert.ok(label && label !== state, `${state} 必须有中文文案`);
  }
  assert.equal(describeEntryStatus(null), "未知");
}
console.log("✓ 产物状态文案覆盖契约全部枚举值");

console.log("\n工作区同步状态断言全部通过。");
