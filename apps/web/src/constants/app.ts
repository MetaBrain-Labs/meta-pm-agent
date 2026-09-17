/**
 * 前端只保存当前激活工作区这类 UI 偏好，不保存聊天消息正文。
 */
export const ACTIVE_WORKSPACE_KEY = "pm-agent-active-workspace";

/**
 * 侧栏与对话栏宽度偏好缓存；只保存 UI 尺寸，不保存聊天内容。
 * v2 使用像素宽度对象，读取端会校验并回退到默认布局。
 */
export const SPLIT_LAYOUT_STORAGE_KEY = "pm-agent-workspace-split-v2";

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

/**
 * 内置默认模型使用列表 id，与 API 的 SYSTEM_MODEL_PROFILE_ID 保持一致。
 */
export const SYSTEM_MODEL_PROFILE_ID = "system-default";
