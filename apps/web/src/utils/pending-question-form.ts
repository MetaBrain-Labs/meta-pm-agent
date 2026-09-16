/**
 * 待回答的 HITL 表单
 *
 * 从当前消息列表里找出"运行时正等着用户回答"的 Question Form。抽取成独立模块，
 * 让输入区与消息流共用同一份判定，避免两处各写一套导致状态不一致。
 *
 * Responsibilities:
 * - 从最新助手消息中解析 Question Form（interrupt payload 或正文标签块）
 * - 判定该表单是否仍可交互（未流式中、未被历史或本地提交过）
 *
 * Notes:
 * - 只做读取与判定，不修改消息、不发起请求。
 * - 表单有两条来源：LangGraph interrupt 的 question_form 动作，以及助手正文里的
 *   <question-form> 标签块。两者都要覆盖，否则会出现"输入框和表单同时存在"。
 */

import type { Message } from "../types";
import { splitOnQuestionForms, type QuestionForm } from "./question-form";
import { getQuestionFormFromInterrupt } from "../components/MessageBubble";

/** 输入区需要渲染的待回答表单。 */
export interface PendingQuestionForm {
  form: QuestionForm;
  /** LangGraph HITL resume 需要的线程 ID；缺少时按普通消息发送。 */
  threadId: string | null;
}

/**
 * 找到仍待回答的 Question Form。
 *
 * 只检查最后一条助手消息：中间轮次的表单已经完成，不应再抢占输入区。
 */
export function findPendingQuestionForm(
  messages: Message[],
  submittedFormIds: Set<string>,
  options: { streaming: boolean },
): PendingQuestionForm | null {
  // 流式过程中表单可能还没输出完整，避免抖动。
  if (options.streaming) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "agent") continue;

    const candidate = readCandidate(message);
    if (!candidate) return null;
    if (submittedFormIds.has(candidate.form.id)) return null;
    // 已有下一条用户消息说明这一轮已经答过（例如刷新后恢复历史）。
    if (hasUserAnswerAfter(messages, index)) return null;

    return candidate;
  }

  return null;
}

/** 从单条消息里解析待回答表单。 */
function readCandidate(message: Message): PendingQuestionForm | null {
  // 来源一：LangGraph interrupt 携带的 question_form 动作。
  const interrupt = message.humanInterrupt;
  if (interrupt) {
    if (interrupt.state !== "pending") return null;
    const raw = getQuestionFormFromInterrupt(interrupt.interrupt);
    if (!raw) return null;
    const form = parseFirstForm(raw);
    return form ? { form, threadId: interrupt.interrupt.threadId } : null;
  }

  // 来源二：助手正文里的 <question-form> 标签块。
  const inline = message.questionForm;
  if (inline?.state === "complete" && inline.content) {
    const form = parseFirstForm(inline.content);
    return form ? { form, threadId: null } : null;
  }

  return null;
}

/** 解析 payload 中的第一个 Question Form。 */
function parseFirstForm(raw: string): QuestionForm | null {
  for (const segment of splitOnQuestionForms(raw)) {
    if (segment.kind === "form") return segment.form;
  }
  return null;
}

/** 该助手消息之后是否已经存在用户回复。 */
function hasUserAnswerAfter(messages: Message[], assistantIndex: number): boolean {
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") return true;
  }
  return false;
}
