/**
 * 本地路径定位能力探测
 *
 * 在桌面宿主（Electron 等）中把项目目录交给系统资源管理器打开。浏览器页面
 * 没有访问磁盘的权限，因此这里只调用宿主注入的能力，不做任何路径伪造或降级
 * 下载。
 *
 * Responsibilities:
 * - 探测宿主是否提供 revealPath 能力
 * - 调用宿主能力并汇报是否成功
 *
 * Notes:
 * - 未提供宿主能力时必须返回 false，由调用方禁用入口并说明原因。
 * - 不读取磁盘、不发起请求、不修改项目数据。
 */

/** 宿主可能注入的能力集合；字段全部可选，缺失即视为不支持。 */
interface DesktopHostBridge {
  revealPath?: (targetPath: string) => unknown;
}

/** 读取宿主桥接对象；普通浏览器中不存在。 */
function getHostBridge(): DesktopHostBridge | null {
  const candidate = (globalThis as { desktopHost?: unknown }).desktopHost;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate as DesktopHostBridge;
}

/**
 * 当前环境能否在资源管理器中打开本地路径。
 *
 * 传入绝对路径时只判断能力本身；未传路径时只判断宿主是否具备该能力。
 */
export function canRevealLocalPath(targetPath?: string | null): boolean {
  if (targetPath !== undefined && !targetPath) return false;
  return typeof getHostBridge()?.revealPath === "function";
}

/**
 * 请求宿主在资源管理器中定位路径；缺能力或调用失败时返回 false。
 */
export async function revealLocalPath(
  targetPath?: string | null,
): Promise<boolean> {
  if (!targetPath) return false;
  const reveal = getHostBridge()?.revealPath;
  if (typeof reveal !== "function") return false;
  try {
    await reveal(targetPath);
    return true;
  } catch (error) {
    console.error("[workspace] Failed to reveal local path:", error);
    return false;
  }
}
