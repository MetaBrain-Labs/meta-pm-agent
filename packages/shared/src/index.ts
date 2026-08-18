/**
 * 共享包统一导出入口
 *
 * 汇总 API、前端与 Agent Runtime 共用的 schema、DTO、事件和业务契约，
 * 让工作区内各应用通过 @repo/shared 获取同一份类型定义。
 *
 * Responsibilities:
 * - 导出聊天、表单、产品工作流和文档生成契约
 * - 保持跨包类型引用稳定
 * - 避免各应用重复定义协议字段
 */

export * from "./schemas/chat";
export * from "./events/chat";
export * from "./agent/request-analysis";
export * from "./agent/product-workflow";
export * from "./agent/document";
export * from "./question-form";
export * from "./model-usage-profile";
