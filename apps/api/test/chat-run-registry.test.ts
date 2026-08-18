/**
 * Chat 运行注册表测试
 *
 * 验证停止接口与连接生命周期传播的 AbortSignal reason 可被 API 错误边界稳定识别。
 *
 * Responsibilities:
 * - 验证默认手动停止来源
 * - 验证页面卸载和客户端断连来源
 * - 验证运行清理
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  STOP_REQUEST_GRACE_MS,
  abortChatRun,
  isChatRunActive,
  registerChatRun,
  resolveChatAbortOrigin,
  resolveEffectiveAbortOrigin,
  unregisterChatRun,
} from "../src/services/chat-run-registry";

test("propagates the explicit chat abort origin", () => {
  const chatId = crypto.randomUUID();
  const controller = new AbortController();
  registerChatRun(chatId, controller);

  try {
    assert.equal(isChatRunActive(chatId), true);
    assert.equal(abortChatRun(chatId, "client_disconnect"), true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(resolveChatAbortOrigin(controller.signal), "client_disconnect");
    assert.equal(isChatRunActive(chatId), false);
  } finally {
    unregisterChatRun(chatId, controller);
  }
});

test("defaults stop requests to manual stop and preserves page unload", () => {
  const manualChatId = crypto.randomUUID();
  const unloadChatId = crypto.randomUUID();
  const manualController = new AbortController();
  const unloadController = new AbortController();
  registerChatRun(manualChatId, manualController);
  registerChatRun(unloadChatId, unloadController);

  try {
    abortChatRun(manualChatId);
    abortChatRun(unloadChatId, "page_unload");
    assert.equal(resolveChatAbortOrigin(manualController.signal), "manual_stop");
    assert.equal(resolveChatAbortOrigin(unloadController.signal), "page_unload");
  } finally {
    unregisterChatRun(manualChatId, manualController);
    unregisterChatRun(unloadChatId, unloadController);
  }
});

test("reclassifies an already-disconnected run when a stop request arrives within the grace window", () => {
  const chatId = crypto.randomUUID();
  const controller = new AbortController();
  registerChatRun(chatId, controller);

  try {
    // 模拟传输层断连先于页面卸载的 stop 请求到达。
    controller.abort("client_disconnect");
    assert.equal(abortChatRun(chatId, "page_unload"), true);
    assert.equal(
      resolveEffectiveAbortOrigin(chatId, controller.signal),
      "page_unload",
    );
  } finally {
    unregisterChatRun(chatId, controller);
  }
});

test("falls back to the transport origin after the grace window expires", () => {
  const chatId = crypto.randomUUID();
  const controller = new AbortController();
  registerChatRun(chatId, controller);

  try {
    controller.abort("client_disconnect");
    abortChatRun(chatId, "page_unload");
    const pastNow = Date.now() + STOP_REQUEST_GRACE_MS + 1_000;
    assert.equal(
      resolveEffectiveAbortOrigin(chatId, controller.signal, pastNow),
      "client_disconnect",
    );
  } finally {
    unregisterChatRun(chatId, controller);
  }
});

test("falls back to the signal origin when no stop request was recorded", () => {
  const chatId = crypto.randomUUID();
  const controller = new AbortController();
  registerChatRun(chatId, controller);

  try {
    controller.abort("client_disconnect");
    assert.equal(
      resolveEffectiveAbortOrigin(chatId, controller.signal),
      "client_disconnect",
    );
  } finally {
    unregisterChatRun(chatId, controller);
  }
});

test("clears stale stop records when a new run registers", () => {
  const chatId = crypto.randomUUID();
  const first = new AbortController();
  registerChatRun(chatId, first);

  try {
    first.abort("client_disconnect");
    abortChatRun(chatId, "page_unload");

    // 新一轮运行注册后，上一轮的 stop 补记不再参与判定。
    const second = new AbortController();
    registerChatRun(chatId, second);
    second.abort("client_disconnect");
    assert.equal(
      resolveEffectiveAbortOrigin(chatId, second.signal),
      "client_disconnect",
    );
    unregisterChatRun(chatId, second);
  } finally {
    unregisterChatRun(chatId, first);
  }
});
