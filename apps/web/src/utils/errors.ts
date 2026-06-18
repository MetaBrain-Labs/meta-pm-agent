/**
 * 将底层请求错误转换成面向用户的中文提示。
 */
export function mapErrorToChinese(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "网络连接失败，请检查网络后重试";
  }
  if (message.includes("AbortError")) return "";

  const statusMatch = message.match(/Server error: (\d+)/);
  if (statusMatch) {
    const code = parseInt(statusMatch[1]!, 10);
    if (code === 400) {
      return "请求参数不完整，请先选择工作区";
    }
    if (code === 429) {
      return "请求过于频繁，请稍后再试";
    }
    if (code >= 500) {
      return "服务器繁忙，请稍后重试";
    }
    if (code === 401 || code === 403) {
      return "鉴权失败，请检查 API Key 配置";
    }
  }

  if (message.includes("No response body")) {
    return "服务器未返回有效响应";
  }

  return "连接中断，请点击重试";
}
