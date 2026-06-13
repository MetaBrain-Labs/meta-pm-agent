import { Fragment, useMemo, useState } from "react";
import { SettingOutlined, CaretRightOutlined, CaretDownOutlined } from "@ant-design/icons";
import { parseSubmittedAnswers, QuestionFormView } from "./QuestionForm";
import { QuestionForm, splitOnQuestionForms } from "../utils/question-form";
import { splitOnCompressed } from "../utils/compress";
import { renderMarkdown } from "../utils/markdown";
import { CompressedCard } from "./CompressedCard";

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

  type RenderableItem =
    | { key: string; kind: "text"; text: string }
    | { key: string; kind: "reminder"; text: string }
    | { key: string; kind: "compress"; raw: string; title?: string }
    | { key: string; kind: "form"; form: QuestionForm };

  const renderable: RenderableItem[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]!;
    if (seg.kind === "form") {
      renderable.push({ key: `f-${idx}`, kind: "form", form: seg.form });
      continue;
    }
    if (seg.text.trim().length === 0) continue;
    const sub = splitSystemReminders(seg.text);
    for (let j = 0; j < sub.length; j++) {
      const s = sub[j]!;
      if (s.kind === "reminder") {
        renderable.push({ key: `t-${idx}-${j}`, kind: "reminder", text: s.text });
        continue;
      }
      const compressed = splitOnCompressed(s.text);
      for (let k = 0; k < compressed.length; k++) {
        const c = compressed[k]!;
        if (c.kind === "compress") {
          renderable.push({ key: `t-${idx}-${j}-${k}`, kind: "compress", raw: c.raw, title: c.title });
        } else {
          renderable.push({ key: `t-${idx}-${j}-${k}`, kind: "text", text: c.text });
        }
      }
    }
  }

  if (renderable.length === 0) return null;

  return (
    <div className="prose-block">
      {renderable.map((seg) => {
        if (seg.kind === "reminder") {
          return <SystemReminderBlock key={seg.key} text={seg.text} />;
        }
        if (seg.kind === "compress") {
          return <CompressedCard key={seg.key} raw={seg.raw} title={seg.title} />;
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
        <span className="system-reminder-icon">
          <SettingOutlined />
        </span>
        <span className="system-reminder-label">systemReminder</span>
        <span className="system-reminder-preview">
          {open ? "" : preview}
          {!open && trimmed.length > preview.length ? "…" : ""}
        </span>
        <span className="system-reminder-chev">
          {open ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </span>
      </button>
      {open ? <pre className="system-reminder-body">{trimmed}</pre> : null}
    </div>
  );
}

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

type ProseSegment = { kind: "text" | "reminder"; text: string };

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
  return out
    .map((seg) =>
      seg.kind === "text"
        ? { ...seg, text: seg.text.replace(/<\/?system-reminder>/g, "") }
        : seg,
    )
    .filter((seg) => seg.kind === "reminder" || seg.text.trim().length > 0);
}
