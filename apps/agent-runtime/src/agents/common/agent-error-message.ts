/**
 * Agent 用户可见错误文本
 *
 * 把运行时失败压缩成「阻塞点 + 受影响 Agent + 下一步」三段式中文提示，
 * 避免把内部错误前缀、重试细节或供应商信息直接推到聊天界面。
 *
 * Responsibilities:
 * - toUserVisibleAgentError()：已知运行失败给出可操作的中文提示
 * - 未知错误保持原始消息，避免隐藏真实故障
 *
 * Notes:
 * - 只影响用户可见文本；日志、SSE 之外的持久化与诊断仍保留原始错误消息。
 */

/** Planner 输出预算被思考耗尽的诊断标记，由 planner-subagent 生成。 */
const PLANNER_OUTPUT_STARVED_MARKER = "planner-output-starved";
/** 运行时墙钟超时错误前缀，与 common/run-agent 保持一致。 */
const AGENT_DEADLINE_EXCEEDED_PREFIX = "agent-deadline-exceeded:";
/** 补证流程拒绝执行缺失 DAG 的错误前缀。 */
const DOCUMENT_EVIDENCE_PLANNER_INVALID = "document-evidence-planner-invalid:";

/**
 * 将运行时错误转换为面向用户的紧凑提示。
 */
export function toUserVisibleAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes(PLANNER_OUTPUT_STARVED_MARKER)) {
    return "规划子代理（Planner）的思考耗尽了模型输出预算，未生成可执行计划；已自动重试 1 次仍未成功。请在「模型使用列表」中降低规划档位的推理强度后重试本轮。";
  }

  if (message.startsWith(AGENT_DEADLINE_EXCEEDED_PREFIX)) {
    const exceededMs = readExceededDurationMs(message);
    const limit = exceededMs ? `${Math.round(exceededMs / 1000)} 秒` : "默认上限";
    return `本轮规划超出运行时时间上限（${limit}），已中止以避免长时间无响应。请降低规划档位的推理强度或缩小补充范围后重试。`;
  }

  if (
    message.includes(DOCUMENT_EVIDENCE_PLANNER_INVALID) ||
    message.includes("required-subagent-not-invoked: planner")
  ) {
    return "规划子代理（Planner）连续两次未生成可执行的证据补充计划。请重试本轮；若持续失败，请检查规划档位的模型配置是否可用。";
  }

  return message;
}

/** 从超时错误消息中还原被超过的毫秒上限，读取失败时返回 null。 */
function readExceededDurationMs(message: string): number | null {
  const match = /exceeded\s+(\d+)ms/.exec(message);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
