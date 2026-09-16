/**
 * 工作区两栏布局的本地存储
 *
 * 对话栏宽度与收起状态属于非权威 UI 偏好，只保存在浏览器本地；本模块是读写
 * 这套偏好的唯一入口，负责校验与回退，避免组件里散落多份状态互相覆盖。
 *
 * Responsibilities:
 * - 读取并校验本地保存的对话栏宽度、收起状态与手动调整标记
 * - 写入单一来源的布局快照
 *
 * Notes:
 * - 不保存任何聊天内容；存储异常时静默回退到默认布局。
 * - 宽度是像素值，读取时只做合法性校验，不做上限裁剪（上限取决于窗口大小）。
 */

import { SPLIT_LAYOUT_STORAGE_KEY } from "../constants/app";

/** 对话栏默认宽度；与 WorkspaceSplit 的参考尺寸保持一致。 */
export const DEFAULT_CONVERSATION_WIDTH = 400;
/** 对话栏硬下限；低于该宽度应改为收起。 */
export const MIN_CONVERSATION_WIDTH = 300;

/** 本地保存的布局快照。 */
export interface StoredSplitLayout {
  /** 对话栏宽度（px）。 */
  width: number;
  /** 对话栏是否收起。 */
  collapsed: boolean;
  /** 用户是否手动调整过宽度；未调整时宽度跟随可用空间。 */
  pinned: boolean;
}

const FALLBACK: StoredSplitLayout = {
  width: DEFAULT_CONVERSATION_WIDTH,
  collapsed: false,
  pinned: false,
};

/** 把任意输入收敛为合法宽度。 */
function normalizeWidth(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONVERSATION_WIDTH;
  return Math.max(MIN_CONVERSATION_WIDTH, Math.round(numeric));
}

/**
 * 读取布局快照。
 *
 * 兼容两类历史数据：旧的百分比字符串，以及缺少 pinned 字段的 v2 对象；
 * 无法解析时一律回退默认值，绝不因为缓存异常改变布局语义。
 */
export function readSplitLayout(): StoredSplitLayout {
  try {
    const raw = localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY);
    if (!raw) return FALLBACK;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return FALLBACK;

    const candidate = parsed as Record<string, unknown>;
    const rawWidth = candidate.conversationWidth ?? candidate.width;
    // 旧版本存过 "50%" 这类百分比，无法换算成像素，直接回退默认值。
    const width =
      typeof rawWidth === "string" && rawWidth.endsWith("%")
        ? DEFAULT_CONVERSATION_WIDTH
        : normalizeWidth(rawWidth);

    return {
      width,
      collapsed: candidate.collapsed === true,
      pinned: candidate.pinned === true,
    };
  } catch {
    return FALLBACK;
  }
}

/** 写入布局快照；存储不可用时忽略，不影响当前会话内的布局。 */
export function writeSplitLayout(layout: StoredSplitLayout): void {
  try {
    localStorage.setItem(
      SPLIT_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        width: normalizeWidth(layout.width),
        collapsed: layout.collapsed === true,
        pinned: layout.pinned === true,
      }),
    );
  } catch {
    // 忽略存储异常。
  }
}
