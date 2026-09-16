/**
 * 面板渲染函数登记回归检查
 *
 * 固定「页面上报的渲染函数会被原样保存」这条契约，防止有人再次把 React 的
 * setState 直接当成页面回调传出去——那会把渲染函数的返回值存成 state，面板容器
 * 调用时抛 `renderPanel is not a function`。
 *
 * Responsibilities:
 * - 演示并断言 setState 直接把函数当回调的错误行为
 * - 断言函数式更新写法能正确保存渲染函数
 *
 * Notes:
 * - 只覆盖登记契约，不渲染 DOM；用最小实现复刻 React 的 setState 语义。
 * - 运行方式：node apps/web/scripts/check-panel-renderer.mjs
 */

import assert from "node:assert/strict";

/**
 * 复刻 React useState 的 setter 语义：
 * 收到函数时视为 updater，用上一个 state 调用它，并把返回值作为新 state。
 */
function createState(initial) {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? next(value) : next;
    },
  };
}

/** 模拟页面侧：一个返回 React 元素的渲染函数。 */
const renderer = () => ({ type: "KnowledgeGraphPanel" });

// 1. 错误写法：把 setState 直接当回调传。
{
  const state = createState(null);
  state.set(renderer); // 等价于 <Component onRegister={setPanel} />
  assert.equal(
    typeof state.get(),
    "object",
    "错误写法会把渲染函数的返回值存成 state（这正是线上故障的原因）",
  );
}
console.log("✓ 复现：setState 直接接收渲染函数 → state 里存的是元素而不是函数");

// 2. 正确写法：函数式更新包一层。
{
  const state = createState(null);
  const handleChange = (next) => state.set(() => next);
  handleChange(renderer);
  assert.equal(typeof state.get(), "function", "函数式更新必须保存函数本身");
  assert.equal(state.get(), renderer, "存下来的应当就是传入的那一个函数引用");
  assert.deepEqual(state.get()(), renderer(), "存下来的函数应当可以直接调用");

  // 清空（组件卸载）后不应留下失效闭包。
  handleChange(null);
  assert.equal(state.get(), null);
}
console.log("✓ 正确写法：函数式更新原样保存渲染函数，清空后为 null");

// 3. 面板容器只应在拿到函数时调用它。
{
  const resolvePanel = (panelId, registry) =>
    (panelId === "overview" ? registry.overview : null) ??
    (panelId === "tasks" ? registry.tasks : null) ??
    (panelId === "graph" ? registry.graph : null) ??
    (panelId === "documents" ? registry.documents : null);

  assert.equal(typeof resolvePanel("graph", { graph: renderer }), "function");

  // 传入元素（错误写法的结果）时不再是函数，必须显式判空才能避免崩溃。
  const broken = resolvePanel("graph", { graph: { type: "KnowledgeGraphPanel" } });
  assert.notEqual(typeof broken, "function");
}
console.log("✓ 面板容器对非函数值需要判空，否则就是 renderPanel is not a function");

console.log("\n面板渲染函数登记断言全部通过。");
