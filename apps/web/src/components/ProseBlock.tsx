import { Fragment, useMemo, useState } from "react";
import { parseSubmittedAnswers, QuestionFormView } from "./QuestionForm";
import { QuestionForm, splitOnQuestionForms } from "../utils/question-form";
import { renderMarkdown } from "../utils/markdown";
import { Icon } from "./Icon";

/**
 * 将Question Form的内容进行拆分
 */
export function ProseBlock({
  text,
  isLastAssistant,
  streaming,
  nextUserContent,
  locallySubmitted,
  onSubmitForm,
}: {
  text: string;
  isLastAssistant: boolean;
  streaming: boolean;
  nextUserContent?: string;
  locallySubmitted: Set<string>;
  onSubmitForm: (formId: string, text: string) => void;
}) {
  const cleaned = useMemo(() => stripArtifact(text), [text]);
  const segments = useMemo(() => splitOnQuestionForms(cleaned), [cleaned]);

  // 每个文本段落会进一步拆分为 `<system-reminder>` 块，因此这些块会以独立的可折叠卡片形式呈现，而非原始标记。
  const renderable = segments.flatMap(
    (
      seg,
      idx,
    ): Array<
      | { key: string; kind: "text"; text: string }
      | { key: string; kind: "reminder"; text: string }
      | { key: string; kind: "form"; form: QuestionForm }
    > => {
      if (seg.kind === "form") {
        return [{ key: `f-${idx}`, kind: "form", form: seg.form }];
      }
      if (seg.text.trim().length === 0) return [];
      const sub = splitSystemReminders(seg.text);
      return sub.map((s, j) => ({
        key: `t-${idx}-${j}`,
        kind: s.kind,
        text: s.text,
      }));
    },
  );

  if (renderable.length === 0) return null;

  return (
    <div className="prose-block">
      {renderable.map((seg) => {
        if (seg.kind === "reminder") {
          return <SystemReminderBlock key={seg.key} text={seg.text} />;
        }
        if (seg.kind === "text") {
          return <Fragment key={seg.key}>{renderMarkdown(seg.text)}</Fragment>;
        }
        return (
          <FormBlock
            key={seg.key}
            form={seg.form}
            isLastAssistant={isLastAssistant}
            streaming={streaming}
            nextUserContent={nextUserContent}
            locallySubmitted={locallySubmitted}
            onSubmitForm={onSubmitForm}
          />
        );
      })}
    </div>
  );
}

/**
 * 默认折叠显示 system reminder 的摘要，点击后展开完整内容
 */
function SystemReminderBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  const preview = trimmed.split("\n")[0]?.slice(0, 120) ?? "";
  return (
    <div className="system-reminder-block">
      <button
        className="system-reminder-toggle"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span className="system-reminder-icon" aria-hidden>
          <Icon name="settings" size={12} />
        </span>
        <span className="system-reminder-label">{"systemReminder"}</span>
        <span className="system-reminder-preview">
          {open ? "" : preview}
          {!open && trimmed.length > preview.length ? "…" : ""}
        </span>
        <span className="system-reminder-chev">
          <Icon name={open ? "chevron-down" : "chevron-right"} size={11} />
        </span>
      </button>
      {open ? <pre className="system-reminder-body">{trimmed}</pre> : null}
    </div>
  );
}

/**
 * 根据拆分内容进行构建Question Form相关样式
 */
function FormBlock({
  form,
  isLastAssistant,
  streaming,
  nextUserContent,
  locallySubmitted,
  onSubmitForm,
}: {
  form: QuestionForm;
  isLastAssistant: boolean;
  streaming: boolean;
  nextUserContent?: string;
  locallySubmitted: Set<string>;
  onSubmitForm: (formId: string, text: string) => void;
}) {
  // 根据用户的后续消息重建之前的回答，以便滚动回溯时显示的较早表单能以已回答的状态呈现。
  const submittedFromHistory = useMemo(() => {
    if (!nextUserContent) return null;
    return parseSubmittedAnswers(form, nextUserContent);
  }, [form, nextUserContent]);
  const wasSubmittedLocally = locallySubmitted.has(form.id);

  const interactive =
    isLastAssistant &&
    !streaming &&
    !submittedFromHistory &&
    !wasSubmittedLocally;
  return (
    <QuestionFormView
      form={form}
      interactive={interactive}
      submittedAnswers={submittedFromHistory ?? undefined}
      onSubmit={(text) => onSubmitForm(form.id, text)}
    />
  );
}

/**
 * 删除 <artifact>...</artifact> 标签块。
 */
function stripArtifact(content: string): string {
  const open = content.indexOf("<artifact");
  if (open === -1) return content;
  const closeTag = content.indexOf(">", open);
  const end = content.indexOf("</artifact>", closeTag);
  return (
    content.slice(0, open) +
    content.slice(end === -1 ? content.length : end + 11)
  ).trim();
}

/**
 * 消息分段类型
 *
 * 普通文本
 *   {
 *     kind: "text"
 *   }
 * 系统提醒
 *   {
 *     kind: "reminder"
 *   }
 */
type ProseSegment = { kind: "text" | "reminder"; text: string };

/**
 * 把 <system-reminder> 从文本中拆出来
 */
function splitSystemReminders(input: string): ProseSegment[] {
  const re = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
  const out: ProseSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", text: input.slice(lastIndex, m.index) });
    }
    out.push({ kind: "reminder", text: m[1] ?? "" });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < input.length) {
    out.push({ kind: "text", text: input.slice(lastIndex) });
  }
  // 删除所有残留的孤立标签（即未闭合的开始标签，或未开始的结束标签）并丢弃在去除后变为空的文本片段。
  return out
    .map((seg) =>
      seg.kind === "text"
        ? { ...seg, text: seg.text.replace(/<\/?system-reminder>/g, "") }
        : seg,
    )
    .filter((seg) => seg.kind === "reminder" || seg.text.trim().length > 0);
}
