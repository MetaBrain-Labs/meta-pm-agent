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
  abortChatRun,
  isChatRunActive,
  registerChatRun,
  resolveChatAbortOrigin,
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
