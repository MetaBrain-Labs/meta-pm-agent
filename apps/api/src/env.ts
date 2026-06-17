/**
 * 在应用启动初期加载项目根目录的 .env 文件，确保环境变量在模块导入前就绪。
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 解析当前模块路径，定位到项目根目录的 .env 文件
dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
});
