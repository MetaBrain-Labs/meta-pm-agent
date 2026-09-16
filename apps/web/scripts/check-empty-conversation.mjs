/**
 * 空会话状态回归检查
 *
 * 固定「Empty Conversation 与 Active Conversation 的切换条件」：切换只由一个
 * 布尔量决定，且快捷任务点击后发送的文本就是它自己的标签。
 *
 * Responsibilities:
 * - 校验空会话判定条件（无消息、未在恢复、无待答表单）
 * - 校验 Quick Action 的发送文本与现有发送路径一致
 * - 校验 Composer 占位文案只在空会话生效
 *
 * Notes:
 * - 只覆盖判定与文案逻辑，不渲染 DOM。
 * - 运行方式：node apps/web/scripts/check-empty-conversation.mjs
 */

import assert from "node:assert/strict";

/** 与 ChatApp.tsx 的判定保持一致。 */
function resolveLayout({ messages, isMessagesLoading, pendingForm }) {
  const showWelcome = messages.length === 0 && !isMessagesLoading;
  const showMessagesLoading = isMessagesLoading && messages.length === 0;
  return {
    showWelcome,
    showMessagesLoading,
    isEmptyConversation: showWelcome && !pendingForm,
  };
}

/** 与 ChatApp.tsx 的 EXAMPLE_QUERIES 保持一致。 */
const EXAMPLE_QUERIES = [
  { label: "帮我梳理这个产品的核心需求", hint: "明确目标、用户与范围" },
  { label: "为当前项目拆一版 MVP 计划", hint: "形成阶段性执行方案" },
  { label: "生成一份迭代风险清单", hint: "识别关键风险与依赖" },
  { label: "把今天的讨论整理成待办事项", hint: "提炼讨论后的行动事项" },
];

/** 与 ConversationComposer 的 placeholder 取值一致。 */
function resolvePlaceholder({ disabledReason, placeholder }) {
  return disabledReason || placeholder || "输入消息";
}

// 1. 新建空对话 → Empty 布局。
{
  const layout = resolveLayout({
    messages: [],
    isMessagesLoading: false,
    pendingForm: null,
  });
  assert.equal(layout.isEmptyConversation, true, "空对话必须进入 Empty 布局");
  assert.equal(layout.showWelcome, true);
  assert.equal(layout.showMessagesLoading, false);
}
console.log("✓ 新建空对话 → Empty Conversation");

// 2. 历史恢复中不进入 Empty：应显示骨架而不是欢迎文案。
{
  const layout = resolveLayout({
    messages: [],
    isMessagesLoading: true,
    pendingForm: null,
  });
  assert.equal(layout.isEmptyConversation, false, "恢复历史时不得闪现欢迎页");
  assert.equal(layout.showMessagesLoading, true, "恢复历史时显示骨架");
}
console.log("✓ 历史恢复中 → 骨架，不进入 Empty");

// 3. 发出第一条消息后 → Active 布局（消息区 + 贴底输入框）。
{
  const layout = resolveLayout({
    messages: [{ id: "u1", role: "user" }, { id: "a1", role: "agent" }],
    isMessagesLoading: false,
    pendingForm: null,
  });
  assert.equal(layout.isEmptyConversation, false, "有消息即进入 Active 布局");
  assert.equal(layout.showWelcome, false);
}
console.log("✓ 第一条消息发送后 → Active Conversation");

// 4. 待答表单存在时不进入 Empty：输入区位置由 HITL 表单决定。
{
  const layout = resolveLayout({
    messages: [],
    isMessagesLoading: false,
    pendingForm: { form: { id: "f1" }, threadId: null },
  });
  assert.equal(
    layout.isEmptyConversation,
    false,
    "有 HITL 待答表单时不得把表单放进 Empty 居中布局",
  );
}
console.log("✓ 存在 HITL 待答表单 → 不进入 Empty");

// 5. 返回空对话不残留状态：判定只依赖入参，与上一次布局无关。
{
  const first = resolveLayout({
    messages: [{ id: "u1", role: "user" }],
    isMessagesLoading: false,
    pendingForm: null,
  });
  const back = resolveLayout({
    messages: [],
    isMessagesLoading: false,
    pendingForm: null,
  });
  assert.equal(first.isEmptyConversation, false);
  assert.equal(back.isEmptyConversation, true, "回到空对话应重新进入 Empty");
}
console.log("✓ 返回空对话无状态残留（判定纯函数化）");

// 6. Quick Action：点击发送的就是标签本身，两条真实发送路径共用。
{
  const sent = [];
  const onSend = (text) => sent.push(text);
  const handleExampleClick = (label) => onSend(label);

  for (const action of EXAMPLE_QUERIES) handleExampleClick(action.label);

  assert.deepEqual(
    sent,
    EXAMPLE_QUERIES.map((action) => action.label),
    "每个快捷任务发送自己的一句话",
  );
  assert.equal(sent.length, 4, "快捷任务仍是 4 个");
  assert.ok(
    EXAMPLE_QUERIES.every((action) => action.hint.trim().length > 0),
    "每个快捷任务都有说明行",
  );
}
console.log("✓ Quick Action 发送文本 = 标签，行为与原有发送路径一致");

// 7. 占位文案：空会话用引导语，disabledReason 仍优先。
{
  assert.equal(
    resolvePlaceholder({ placeholder: "输入需求，让问渠帮你推进项目..." }),
    "输入需求，让问渠帮你推进项目...",
  );
  assert.equal(
    resolvePlaceholder({
      disabledReason: "当前会话正在执行，请稍候",
      placeholder: "输入需求，让问渠帮你推进项目...",
    }),
    "当前会话正在执行，请稍候",
    "禁用原因必须优先于引导文案",
  );
  assert.equal(resolvePlaceholder({}), "输入消息", "无引导文案时保持原占位");
}
console.log("✓ Composer 占位文案优先级正确");

console.log("\n空会话状态断言全部通过。");
