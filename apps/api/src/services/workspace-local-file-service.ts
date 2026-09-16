/**
 * 工作区受控本地文件服务
 *
 * Responsibilities:
 * - 统一项目产物路径并检查真实目录边界
 * - 原子保存、无覆盖复制和生成目录忽略规则
 *
 * Notes:
 * - 只处理应用生成的文件，不向 Agent 提供文件系统能力。
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile, link } from "node:fs/promises";
import path from "node:path";

/** 检查产物标识，避免标识被当作任意路径片段。 */
export function localFileId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid local artifact identifier.");
  return value;
}

/** 获取工作区的上下文、兼容标记与 PRD 目录。 */
export function workspaceLocalPaths(localPath: string, workspaceId: string) {
  const id = localFileId(workspaceId);
  return {
    context: path.join(localPath, "resources", "product-contexts", `${id}.json`),
    retired: path.join(localPath, "resources", "product-contexts", `${id}.legacy-retired`),
    prdDirectory: path.join(localPath, "resources", "documents", id, "prd"),
  };
}

/** 检查相对路径是否仍位于根目录中。 */
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** 检查每层已存在的真实路径；拒绝链接，避免读写逃逸或误操作链接目标。 */
export async function assertLocalFileBoundary(root: string, target: string): Promise<void> {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  if (!inside(absoluteRoot, absoluteTarget)) throw new Error("Local artifact is outside the project directory.");
  const actualRoot = await realpath(absoluteRoot);
  let current = absoluteRoot;
  for (const segment of path.relative(absoluteRoot, absoluteTarget).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (current !== absoluteTarget && !info.isDirectory()) {
        throw Object.assign(new Error("Local artifact parent must be a directory."), { code: "ENOTDIR" });
      }
      if (info.isSymbolicLink() || !inside(actualRoot, await realpath(current))) {
        throw new Error("Local artifact path contains a directory link or escapes the project.");
      }
    } catch (error) {
      if (isMissingLocalFile(error)) break;
      throw error;
    }
  }
}

/** 判断文件不存在，其他权限和文件损坏错误不能伪装成缺失。 */
export function isMissingLocalFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** 安全读取应用产物，仅文件缺失时返回 null。 */
export async function readLocalFile(root: string, target: string): Promise<string | null> {
  await assertLocalFileBoundary(root, target);
  try { return await readFile(target, "utf8"); }
  catch (error) { if (isMissingLocalFile(error)) return null; throw error; }
}

/** 创建产物目录和局部忽略规则，不覆盖已有规则或项目根配置。 */
async function prepareDirectory(root: string, target: string): Promise<void> {
  await assertLocalFileBoundary(root, target);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  await assertLocalFileBoundary(root, target);
  const ignore = path.join(directory, ".gitignore");
  await assertLocalFileBoundary(root, ignore);
  try { await writeFile(ignore, "*\n!.gitignore\n", { encoding: "utf8", flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

/** 原子发布文件；无覆盖模式使用硬链接发布，目标存在时不会替换。 */
export async function writeLocalFile(root: string, target: string, content: string, overwrite = true): Promise<void> {
  await prepareDirectory(root, target);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await assertLocalFileBoundary(root, target);
    if (overwrite) await rename(temporary, target);
    else await link(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 无覆盖复制有效内容；相同文件跳过，不同内容向用户报告冲突。 */
export async function copyLocalFile(root: string, target: string, content: string): Promise<void> {
  const existing = await readLocalFile(root, target);
  if (existing === content) return;
  if (existing !== null) throw new Error("目标已有不同内容，未覆盖；请保留或移开该文件后重新同步。");
  try { await writeLocalFile(root, target, content, false); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" && await readLocalFile(root, target) === content) return;
    throw error;
  }
}

/** 安全删除单个应用文件，不递归操作项目目录。 */
export async function removeLocalFile(root: string, target: string): Promise<void> {
  await assertLocalFileBoundary(root, target);
  await rm(target, { force: true });
}

/** 将磁盘错误压缩为可操作的本地同步提示。 */
export function localStorageErrorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "本地目录不可写，请检查权限后重新同步。";
  if (code === "ENOSPC") return "磁盘空间不足，请释放空间后重新同步。";
  if (error instanceof Error && error.message.startsWith("目标已有")) return error.message;
  return "本地文件无法同步，请检查目录、文件冲突或目录链接后重新同步。";
}
