/**
 * 前端只保存当前激活工作区这类 UI 偏好，不保存聊天消息正文。
 */
export const ACTIVE_WORKSPACE_KEY = "pm-agent-active-workspace";

/**
 * 新建会话在后端落库前使用的默认标题。
 */
export const DEFAULT_CHAT_TITLE = "\u65b0\u5bf9\u8bdd";

/**
 * 没有工作区数据时展示的兜底名称。
 */
export const DEFAULT_WORKSPACE_NAME = "\u672c\u5730\u5de5\u4f5c\u533a";

/**
 * 阻止用户在未选择工作区时发送消息的提示。
 */
export const NO_WORKSPACE_MESSAGE =
  "\u8bf7\u5148\u65b0\u5efa\u6216\u9009\u62e9\u5de5\u4f5c\u533a";
