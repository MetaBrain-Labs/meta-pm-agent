/**
 * 助手正文与 HITL 表单渲染器。
 *
 * 将助手正文拆分为 Markdown 文本、系统提示和 Question Form 片段。表单片段会按
 * Human-in-the-Loop 交互提交，向上层同时返回普通答案文本和 LangGraph resume payload。
 *
 * Responsibilities:
 * - 渲染 Markdown 正文和引用来源
 * - 将 question-form tagged block 渲染为 HITL 表单卡片
 * - 为表单提交生成 Command(resume) 兼容 payload
 *
 * Notes:
 * - 该组件只负责浏览器侧展示，不直接发起网络请求。
 */

import { Fragment, useMemo, useState } from "react";
import { Button } from "antd";
import { SettingOutlined, CaretRightOutlined, CaretDownOutlined } from "@ant-design/icons";
import { parseSubmittedAnswers, QuestionFormView } from "./QuestionForm";
import {
  formatHumanInTheLoopResume,
  QuestionForm,
  splitOnQuestionForms,
} from "../utils/question-form";
import { renderMarkdown } from "../utils/markdown";
import { collectWebSearchCitationSources } from "../utils/citations";
import type { HumanInTheLoopResume, ToolCallInfo } from "../types";

export function ProseBlock({
  text,
  toolCalls,
  isLastAssistant,
  streaming,
  nextUserContent,
  locallySubmitted,
  onSubmitForm,
  hitlThreadId,
}: {
  text: string;
  toolCalls?: ToolCallInfo[];
  isLastAssistant: boolean;
  streaming: boolean;
  nextUserContent?: string;
  locallySubmitted: Set<string>;
  onSubmitForm: (
    formId: string,
    text: string,
    hitlResume?: HumanInTheLoopResume,
  ) => void;
  hitlThreadId?: string;
}) {
  const cleaned = useMemo(() => stripArtifact(text), [text]);
  const segments = useMemo(() => splitOnQuestionForms(cleaned), [cleaned]);
  const citationSources = useMemo(
    () => collectWebSearchCitationSources(toolCalls),
    [toolCalls],
  );

  type RenderableItem =
    | { key: string; kind: "text"; text: string }
    | { key: string; kind: "reminder"; text: string }
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
      renderable.push({ key: `t-${idx}-${j}`, kind: "text", text: s.text });
    }
  }

  if (renderable.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        fontFamily: 'var(--body)',
        fontSize: 14,
        color: 'var(--ink-soft)',
        lineHeight: 1.6,
      }}
    >
      {renderable.map((seg) => {
        if (seg.kind === "reminder") {
          return <SystemReminderBlock key={seg.key} text={seg.text} />;
        }
        if (seg.kind === "text") {
          return (
            <Fragment key={seg.key}>
              {renderMarkdown(seg.text, { citationSources })}
            </Fragment>
          );
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
            hitlThreadId={hitlThreadId}
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
    <div
      className="rounded-lg overflow-hidden my-1"
      style={{
        border: '1px solid var(--line-soft)',
        background: 'var(--surface-muted)',
      }}
    >
      <Button
        type="text"
        block
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 h-auto text-xs text-left"
        style={{
          height: "auto",
          minHeight: 38,
          whiteSpace: "normal",
          color: 'var(--ink-faint)',
          fontFamily: 'var(--body)',
        }}
      >
        <span className="shrink-0" style={{ color: 'var(--primary)' }}>
          <SettingOutlined />
        </span>
        <span
          className="uppercase tracking-wide whitespace-nowrap"
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ink-mute)',
            letterSpacing: '0.12em',
          }}
        >
          systemReminder
        </span>
        <span
          className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          style={{ color: 'var(--ink-faint)' }}
        >
          {open ? "" : preview}
          {!open && trimmed.length > preview.length ? "..." : ""}
        </span>
        <span className="shrink-0" style={{ color: 'var(--primary)' }}>
          {open ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </span>
      </Button>
      {open && (
        <pre
          className="px-3 pb-2.5 m-0 text-xs leading-relaxed whitespace-pre-wrap max-h-[260px] overflow-y-auto scrollbar-none-thin"
          style={{
            fontFamily: 'var(--mono)',
            color: 'var(--ink-mute)',
            borderTop: '1px solid var(--line-soft)',
            fontSize: 12,
          }}
        >
          {trimmed}
        </pre>
      )}
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
  hitlThreadId,
}: {
  form: QuestionForm;
  isLastAssistant: boolean;
  streaming: boolean;
  nextUserContent?: string;
  locallySubmitted: Set<string>;
  onSubmitForm: (
    formId: string,
    text: string,
    hitlResume?: HumanInTheLoopResume,
  ) => void;
  hitlThreadId?: string;
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
      onSubmit={(text, answers) =>
        onSubmitForm(
          form.id,
          text,
          hitlThreadId
            ? formatHumanInTheLoopResume(hitlThreadId, form, answers)
            : undefined,
        )
      }
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
