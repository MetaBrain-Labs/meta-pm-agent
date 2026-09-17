/**
 * PostgreSQL 错误识别工具
 *
 * Responsibilities:
 * - 识别 undefined_table（42P01）错误，用于兼容尚未执行建表 SQL 的本地部署
 *
 * Notes:
 * - 只做错误识别，不访问数据库、不改变错误本身
 */

/** 判断错误是否为指定表的 undefined_table（42P01）。 */
export function isMissingTableError(
  error: unknown,
  tableName: string,
): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; message?: string };
  };
  return (
    record.code === "42P01" ||
    record.meta?.code === "42P01" ||
    record.message?.includes(tableName) === true ||
    record.meta?.message?.includes(tableName) === true
  );
}
