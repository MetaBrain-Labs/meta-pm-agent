/**
 * Agent 运行时可见的日期上下文，用于约束相对时间类问题的理解。
 */
export interface RuntimeDateContext {
  currentDate: string;
  currentYear: number;
  currentDateTime: string;
  timeZone: string;
}

/**
 * 获取服务器当前日期上下文，避免 Agent 使用模型训练语料中的过期年份。
 */
export function getRuntimeDateContext(now = new Date()): RuntimeDateContext {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const currentDate = formatDateInTimeZone(now, timeZone);

  return {
    currentDate,
    currentYear: Number(currentDate.slice(0, 4)),
    currentDateTime: now.toISOString(),
    timeZone,
  };
}

/**
 * 按服务器时区格式化本地业务日期，保持提示词中的日期稳定可读。
 */
function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value;

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}
