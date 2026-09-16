/**
 * 本地目录浏览契约
 *
 * Responsibilities:
 * - 定义 API 主机目录选择器的目录条目和导航响应
 *
 * Notes:
 * - 仅传递目录名称和绝对路径，不传递文件内容。
 */

/** 可进入或选择的目录入口。 */
export interface LocalDirectoryEntry {
  name: string;
  path: string;
}

/** 单层目录列表及其父目录、磁盘导航信息。 */
export interface LocalDirectoryListing {
  currentPath: string;
  parentPath: string | null;
  directories: LocalDirectoryEntry[];
  roots: LocalDirectoryEntry[];
}
