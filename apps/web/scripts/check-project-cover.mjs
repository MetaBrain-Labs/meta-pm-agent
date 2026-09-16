/**
 * 项目封面配色回归检查
 *
 * 固定「封面必须是近白低彩度」这条视觉约束，避免后续被改回参考图里的高饱和
 * 色块，同时校验同一项目 ID 始终得到同一配色。
 *
 * Responsibilities:
 * - 校验封面色板的彩度与明度落在低彩度浅色区间
 * - 校验图标色在近白底上有足够对比
 * - 校验颜色选择对项目 ID 稳定且分布均匀
 *
 * Notes:
 * - 只覆盖颜色计算，不渲染 DOM、不访问网络。
 * - 运行方式：node apps/web/scripts/check-project-cover.mjs
 */

import assert from "node:assert/strict";

/** 与 design-tokens.ts 的 cover 色板保持一致。 */
const COVER_PALETTE = [
  { tint: "#eef0f4", ink: "#4f5665" },
  { tint: "#edeef7", ink: "#4e5370" },
  { tint: "#f0edf5", ink: "#5f5473" },
  { tint: "#f3edf2", ink: "#715367" },
  { tint: "#f6efec", ink: "#74584b" },
  { tint: "#f4f2eb", ink: "#66623f" },
  { tint: "#eaf2ed", ink: "#436452" },
  { tint: "#e9f2f3", ink: "#44646b" },
];

/** 与 project-cover.ts 的哈希保持一致。 */
function hashProjectId(projectId) {
  let hash = 0;
  for (let index = 0; index < projectId.length; index += 1) {
    hash = (hash * 31 + projectId.charCodeAt(index)) % 1_000_003;
  }
  return hash;
}

function pickCover(projectId) {
  return COVER_PALETTE[hashProjectId(projectId) % COVER_PALETTE.length];
}

function toRgb(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/**
 * 通道极差（max − min）。
 *
 * 近白色不能用 HSL 饱和度判断「彩度」：明度接近 100% 时分母趋近 0，几个通道
 * 相差 8 就会算出 40% 以上的饱和度，但视觉上仍是近白。通道极差才是稳定指标。
 */
function chroma(hex) {
  const [r, g, b] = toRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function lightness(hex) {
  const [r, g, b] = toRgb(hex);
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255) * 100;
}

// 封面底色：近白浅色，通道极差不超过 10/255，渲染后是可辨识的底色而非色块。
for (const entry of COVER_PALETTE) {
  const spread = chroma(entry.tint);
  assert.ok(
    spread <= 10,
    `${entry.tint} 通道极差 ${spread}/255 过高，会形成可见色块`,
  );
  assert.ok(
    lightness(entry.tint) >= 92,
    `${entry.tint} 明度 ${lightness(entry.tint).toFixed(1)}% 偏低，不再是浅色 tint`,
  );
}
console.log(
  `✓ 封面色板 ${COVER_PALETTE.length} 色全部满足 通道极差 ≤ 10/255 且 明度 ≥ 92%`,
);

// 图标色：深色中性，保证在近白底上有足够对比。
// 深色的通道极差允许比底色大（深灰本身带轻微色调），但仍处于低彩度区间。
for (const entry of COVER_PALETTE) {
  const spread = chroma(entry.ink);
  const light = lightness(entry.ink);
  assert.ok(spread <= 44, `${entry.ink} 图标色通道极差 ${spread} 过高，接近纯色`);
  assert.ok(
    light >= 28 && light <= 50,
    `${entry.ink} 图标色明度 ${light.toFixed(1)}% 需落在 28%–50%`,
  );
}
console.log("✓ 封面图标色全部为深色低彩度，近白底上有足够对比");

// 底色与图标色的明度差必须足够，避免低对比。
for (const entry of COVER_PALETTE) {
  const contrast = lightness(entry.tint) - lightness(entry.ink);
  assert.ok(contrast >= 45, `${entry.tint}/${entry.ink} 明度差仅 ${contrast.toFixed(1)}%`);
}
console.log("✓ 每对 底色/图标色 明度差 ≥ 45%，图标可辨识");

// 同一项目 ID 必须稳定得到同一配色。
for (const projectId of ["ws-1", "本地工作区 3", "f47ac10b-58cc", "x"]) {
  assert.deepEqual(pickCover(projectId), pickCover(projectId));
}
console.log("✓ 同一项目 ID 反复计算得到同一封面");

// 八个不同 ID 应覆盖到多个色板下标，避免全部撞色。
const indexes = new Set(
  Array.from({ length: 8 }, (_, index) => hashProjectId(`project-${index}`) % COVER_PALETTE.length),
);
assert.ok(indexes.size >= 3, `8 个项目只用到 ${indexes.size} 种封面，区分度不足`);
console.log(`✓ 8 个样例项目覆盖 ${indexes.size} 种封面配色`);

console.log("\n项目封面断言全部通过。");
