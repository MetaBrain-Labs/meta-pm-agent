/**
 * API 主机目录浏览服务
 *
 * Responsibilities:
 * - 读取单层子目录、父目录和本机磁盘入口
 * - 校验绝对路径与目录读取权限
 *
 * Notes:
 * - 仅用于本机目录选择，不读取文件内容，也不修改文件系统。
 */
import { constants } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { LocalDirectoryEntry, LocalDirectoryListing } from "@repo/shared";

/** 可直接展示给用户的目录浏览错误。 */
export class LocalDirectoryError extends Error {
  /** 保存可展示的错误原因及对应 HTTP 状态。 */
  constructor(message: string, readonly statusCode: 400 | 403 | 404) {
    super(message);
  }
}

/** 读取指定绝对目录；未指定时从 API 运行用户的主目录开始。 */
export async function browseLocalDirectory(input?: string): Promise<LocalDirectoryListing> {
  const requested = input ?? homedir();
  if (!path.isAbsolute(requested)) {
    throw new LocalDirectoryError("请输入绝对目录路径，或选择主目录重新浏览。", 400);
  }
  try {
    const currentPath = path.normalize(await realpath(requested));
    if (!(await stat(currentPath)).isDirectory()) {
      throw new LocalDirectoryError("所选路径不是文件夹。", 400);
    }
    await access(currentPath, constants.R_OK);
    const [entries, roots] = await Promise.all([
      readdir(currentPath, { withFileTypes: true }),
      listDirectoryRoots(),
    ]);
    const directories: LocalDirectoryEntry[] = [];
    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        directories.push({ name: entry.name, path: entryPath });
      } else if (entry.isSymbolicLink()) {
        // 目录链接可进入，损坏或不可访问的链接不阻断整个列表。
        try {
          if ((await stat(entryPath)).isDirectory()) {
            directories.push({ name: entry.name, path: entryPath });
          }
        } catch { /* 忽略无法解析的链接。 */ }
      }
    }));
    directories.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    const parent = path.dirname(currentPath);
    return { currentPath, parentPath: parent === currentPath ? null : parent, directories, roots };
  } catch (error) {
    if (error instanceof LocalDirectoryError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new LocalDirectoryError("没有权限读取此文件夹，请选择其他目录。", 403);
    }
    throw new LocalDirectoryError("文件夹不存在或无法读取，请选择其他目录。", 404);
  }
}

/** 列出主目录及可用磁盘根目录，兼容 Windows 和 POSIX 主机。 */
async function listDirectoryRoots(): Promise<LocalDirectoryEntry[]> {
  const roots: LocalDirectoryEntry[] = [{ name: "主目录", path: homedir() }];
  if (process.platform !== "win32") {
    roots.push({ name: "文件系统 /", path: "/" });
    return roots;
  }
  const drives = await Promise.all(Array.from({ length: 26 }, async (_, index) => {
    const drive = `${String.fromCharCode(65 + index)}:\\`;
    try {
      if ((await stat(drive)).isDirectory()) return { name: drive, path: drive };
    } catch { /* 不显示不存在或不可访问的磁盘。 */ }
    return null;
  }));
  roots.push(...drives.filter((drive): drive is LocalDirectoryEntry => drive !== null));
  return roots;
}
