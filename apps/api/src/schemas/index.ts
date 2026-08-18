/**
 * API Schema 统一导出入口
 *
 * 汇总控制器层复用的请求体验证规则，避免各控制器直接引用散落路径。
 *
 * Responsibilities:
 * - 导出聊天、工作区、请求表单和文档生成 schema
 * - 保持 API 输入校验的单一入口
 * - 为新增路由提供稳定导入路径
 */

export * from "./chat.schema";
export * from "./workspace.schema";
export * from "./request.schema";
export * from "./document.schema";
export * from "./model-profile.schema";
