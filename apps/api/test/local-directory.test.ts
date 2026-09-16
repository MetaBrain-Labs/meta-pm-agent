/**
 * 本地目录浏览接口测试
 *
 * Responsibilities:
 * - 验证真实目录导航、空目录选择与路径错误
 * - 确认响应不包含文件内容或普通文件条目
 *
 * Notes:
 * - 使用临时目录，不连接数据库或调用模型。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalDirectoryRoutes } from "../src/controllers/local-directory-controller";

/** 验证真实文件系统上的单层浏览、目录确认信息及错误恢复契约。 */
test("browses only directories and supports empty folders and parent navigation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "meta-pm-directory-"));
  const child = path.join(directory, "空文件夹");
  const file = path.join(directory, "private.txt");
  t.after(async () => {
    // 逐项清理测试创建的文件和空目录，不递归删除临时目录之外的路径。
    await unlink(file);
    await rmdir(child);
    await rmdir(directory);
  });
  await mkdir(child);
  await writeFile(file, "private file content");
  const routes = createLocalDirectoryRoutes();
  const response = await routes.request(`/?${new URLSearchParams({ path: directory })}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const listing = await response.json();
  assert.equal(listing.currentPath, await realpath(directory));
  assert.deepEqual(listing.directories, [{ name: "空文件夹", path: path.join(listing.currentPath, "空文件夹") }]);
  assert.equal(JSON.stringify(listing).includes("private"), false);
  assert.ok(listing.roots.some((root: { path: string }) => root.path === homedir()));

  const empty = await (await routes.request(`/?${new URLSearchParams({ path: child })}`)).json();
  assert.deepEqual(empty.directories, []);
  assert.equal(empty.currentPath, await realpath(child));
  assert.equal(empty.parentPath, listing.currentPath);

  for (const [value, status] of [["relative-folder", 400], [file, 400], [path.join(directory, "missing"), 404], ["", 400]] as const) {
    const invalid = await routes.request(`/?${new URLSearchParams({ path: value })}`);
    assert.equal(invalid.status, status);
    assert.equal(typeof (await invalid.json()).error, "string");
  }
});

/** 验证默认主目录入口和文件系统根目录没有上级导航。 */
test("starts at home and disables parent navigation at the filesystem root", async () => {
  const routes = createLocalDirectoryRoutes();
  const home = await (await routes.request("/")).json();
  assert.equal(home.currentPath, await realpath(homedir()));
  const root = path.parse(home.currentPath).root;
  const response = await routes.request(`/?${new URLSearchParams({ path: root })}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).parentPath, null);
});
