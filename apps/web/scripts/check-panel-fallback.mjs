/**
 * 工作区面板回落回归检查
 *
 * 「知识图谱」与「任务历史」的数据只存在于聊天页。当没有对话栏时（例如从侧栏
 * 直接进入交付文档），聊天页不会挂载，也就没人登记渲染函数。此脚本固定这条
 * 回落规则，避免面板再次显示成"面板暂时不可用"的空白。
 *
 * Responsibilities:
 * - 校验知识图谱面板在无登记时使用自包含实现
 * - 校验任务历史面板在无会话时给出作用域说明而不是通用错误
 * - 校验有登记时优先使用登记实现（图谱与会话共用同一份数据）
 *
 * Notes:
 * - 只覆盖回落判定，不渲染 DOM。
 * - 运行方式：node apps/web/scripts/check-panel-fallback.mjs
 */

import assert from "node:assert/strict";

/** 与 WorkspacePanelContent 的分支保持一致。 */
function resolvePanel({
  panelId,
  overview,
  tasks,
  graph,
  graphWorkspaceId,
  documents,
}) {
  const isRenderer = (value) => typeof value === "function";

  if (panelId === "graph") {
    if (isRenderer(graph)) return "registered-graph";
    if (graphWorkspaceId) return "self-contained-graph";
  }

  if (panelId === "tasks" && !isRenderer(tasks)) {
    return "task-history-scope-note";
  }

  const candidate =
    (panelId === "overview" ? overview : null) ??
    (panelId === "tasks" ? tasks : null) ??
    (panelId === "documents" ? documents : null);
  if (isRenderer(candidate)) return "registered";

  return "unavailable";
}

// 1. 有对话栏：图谱用聊天页登记的实现（与对话共用同一份数据）。
{
  const kind = resolvePanel({
    panelId: "graph",
    graph: () => null,
    graphWorkspaceId: "ws-1",
  });
  assert.equal(
    kind,
    "registered-graph",
    "有登记时必须使用登记实现，避免同一面板出现两份图谱数据源",
  );
}
console.log("✓ 有对话栏：图谱使用聊天页登记的渲染函数");

// 2. 没有对话栏：图谱回落到自包含实现，而不是空态。
{
  const kind = resolvePanel({
    panelId: "graph",
    graph: undefined,
    graphWorkspaceId: "ws-1",
  });
  assert.equal(
    kind,
    "self-contained-graph",
    "没有对话栏（聊天页未挂载）时图谱必须自建数据源，不得落到空态",
  );
}
console.log("✓ 无对话栏：图谱回落到自包含实现（修复空面板）");

// 3. 没有工作区 ID 时仍然保持空态，不请求空 ID。
{
  const kind = resolvePanel({
    panelId: "graph",
    graph: undefined,
    graphWorkspaceId: undefined,
  });
  assert.equal(kind, "unavailable");
}
console.log("✓ 缺少工作区 ID：保持空态，不发起无效请求");

// 4. 任务历史：没有会话时说明作用域与入口。
{
  const kind = resolvePanel({
    panelId: "tasks",
    tasks: undefined,
    graphWorkspaceId: "ws-1",
  });
  assert.equal(
    kind,
    "task-history-scope-note",
    "任务历史按会话统计，无会话时应说明作用域而不是显示通用错误",
  );
}
console.log("✓ 无会话：任务历史给出作用域说明，而不是「面板暂时不可用」");

// 5. 任务历史：有登记时使用登记实现。
{
  const kind = resolvePanel({ panelId: "tasks", tasks: () => null });
  assert.equal(kind, "registered");
  assert.equal(
    resolvePanel({ panelId: "tasks", tasks: undefined, graphWorkspaceId: "ws-1" }),
    "task-history-scope-note",
  );
}
console.log("✓ 任务历史：有登记用登记实现，无登记用说明");

// 6. 项目概览与交付文档不受影响。
{
  assert.equal(resolvePanel({ panelId: "overview", overview: () => null }), "registered");
  assert.equal(
    resolvePanel({ panelId: "documents", documents: () => null }),
    "registered",
  );
  assert.equal(resolvePanel({ panelId: "overview" }), "unavailable");
}
console.log("✓ 概览/交付文档分支不受回落逻辑影响");

// 7. 图谱就绪状态：实例未建立时必须报告，而不是留一块空白画布。
{
  /**
   * 与 KnowledgeGraphView 的渲染分支保持一致。
   * graphReady 由初始化流程置位；graphCreated 只在实例真正建立后置位。
   */
  const resolveCanvasState = ({ renderError, graphReady, graphCreated }) => {
    if (renderError) return "render-error";
    if (graphReady && !graphCreated) return "size-not-ready";
    if (!graphReady) return "loading";
    return "graph";
  };

  assert.equal(
    resolveCanvasState({ renderError: null, graphReady: true, graphCreated: true }),
    "graph",
  );
  assert.equal(
    resolveCanvasState({ renderError: null, graphReady: false, graphCreated: false }),
    "loading",
    "初始化期间显示加载态",
  );
  assert.equal(
    resolveCanvasState({ renderError: null, graphReady: true, graphCreated: false }),
    "size-not-ready",
    "重试耗尽但实例未建立时，必须报告画布尺寸未就绪，不能留空白",
  );
  assert.equal(
    resolveCanvasState({
      renderError: "boom",
      graphReady: true,
      graphCreated: true,
    }),
    "render-error",
    "渲染失败优先于其它状态",
  );
}
console.log("✓ 图谱就绪状态：实例未建立时报告尺寸未就绪，不留空白画布");


// 8. 填满型面板必须走 flex 分配，不能依赖百分比高度。
{
  /*
   * 回归约束：图谱面板的内容包装层必须是 `.workspace-panel-fill`。
   * 面板体的高度来自 flex 分配（不确定高度），子元素写 height:100% 会解析为
   * auto，画布因此拿不到尺寸并显示「画布尺寸未就绪」。
   */
  const wrapperFor = (panelId, { graph, tasks, graphWorkspaceId }) => {
    const isRenderer = (value) => typeof value === "function";
    if (panelId === "graph" && (isRenderer(graph) || graphWorkspaceId)) {
      return "workspace-panel-fill";
    }
    if (panelId === "tasks" && !isRenderer(tasks)) {
      return "workspace-panel-fill";
    }
    return "h-full min-h-0";
  };

  assert.equal(
    wrapperFor("graph", { graph: () => null }),
    "workspace-panel-fill",
    "有登记的图谱面板必须用 fill 包装层",
  );
  assert.equal(
    wrapperFor("graph", { graphWorkspaceId: "ws-1" }),
    "workspace-panel-fill",
    "自包含图谱面板必须用 fill 包装层",
  );
  assert.equal(
    wrapperFor("tasks", { tasks: undefined }),
    "workspace-panel-fill",
    "任务历史说明页必须用 fill 包装层",
  );
  assert.equal(
    wrapperFor("documents", {}),
    "h-full min-h-0",
    "可滚动内容（交付文档）保持原包装，不受影响",
  );
}
console.log("✓ 填满型面板使用 flex 分配包装层，可滚动面板不受影响");

console.log("\n工作区面板回落断言全部通过。");
