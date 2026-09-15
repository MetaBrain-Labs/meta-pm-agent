/**
 * 业务标识的界面展示格式化。
 *
 * Responsibilities:
 * - 缩短 UUID 类标识并保留业务前缀。
 *
 * Notes:
 * - 返回值只用于显示，不能用于存储、引用或请求参数。
 */

/** 为 UUID 类标识保留前八位和末四位，其他标识原样返回。 */
export function formatDisplayId(id: string): string {
  return id.replace(
    /([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{8}([0-9a-f]{4})$/i,
    "$1…$2",
  );
}
