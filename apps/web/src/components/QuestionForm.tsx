import { useMemo, useState } from "react";
import { formatFormAnswers, QuestionForm } from "../utils/question-form";

interface Props {
  form: QuestionForm;
  // Whether the user can still submit answers. The owning AssistantMessage
  // disables the form when the assistant turn is no longer the most recent
  // one (i.e. the user has already moved past it).
  interactive: boolean;
  // Pre-existing answers — when we detect a follow-up user message that
  // begins with "[form answers — <id>]", we parse it back out and pass it
  // here so the rendered form reflects what was sent.
  submittedAnswers?: Record<string, string | string[]>;
  onSubmit?: (text: string, answers: Record<string, string | string[]>) => void;
}

export function QuestionFormView({
  form,
  interactive,
  submittedAnswers,
  onSubmit,
}: Props) {
  const initial = useMemo(
    () => buildInitialState(form, submittedAnswers),
    [form, submittedAnswers],
  );
  const [answers, setAnswers] =
    useState<Record<string, string | string[]>>(initial);
  const locked = !interactive || !onSubmit || submittedAnswers !== undefined;

  function update(id: string, value: string | string[]) {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleCheckbox(id: string, option: string, maxSelections?: number) {
    if (locked) return;
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      const has = current.includes(option);
      if (
        !has &&
        maxSelections !== undefined &&
        current.length >= maxSelections
      ) {
        return prev;
      }
      const next = has
        ? current.filter((v) => v !== option)
        : [...current, option];
      return { ...prev, [id]: next };
    });
  }

  function missingRequired(): string | null {
    for (const q of form.questions) {
      if (!q.required) continue;
      const v = answers[q.id];
      if (
        Array.isArray(v)
          ? v.length === 0
          : !(typeof v === "string" && v.trim().length > 0)
      ) {
        return q.label;
      }
    }
    return null;
  }

  function handleSubmit() {
    if (locked || !onSubmit) return;
    if (!withinSelectionLimits) return;
    const missing = missingRequired();
    if (missing) {
      // Soft inline guard — surface via aria but don't alert; the disabled
      // state of the submit button covers most cases.
      return;
    }
    onSubmit(formatFormAnswers(form, answers), answers);
  }

  const required = form.questions.filter((q) => q.required);
  const withinSelectionLimits = form.questions.every((q) => {
    if (q.type !== "checkbox" || q.maxSelections === undefined) return true;
    const v = answers[q.id];
    return !Array.isArray(v) || v.length <= q.maxSelections;
  });
  const ready =
    withinSelectionLimits &&
    required.every((q) => {
      const v = answers[q.id];
      return Array.isArray(v)
        ? v.length > 0
        : typeof v === "string" && v.trim().length > 0;
    });

  return (
    <div className={`question-form${locked ? " question-form-locked" : ""}`}>
      <div className="question-form-head">
        <span className="question-form-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 6.5C6 5.67 6.67 5 7.5 5h.5a2 2 0 0 1 0 4h-.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11" r="0.8" fill="currentColor" />
          </svg>
        </span>
        <div className="question-form-titles">
          <div className="question-form-title">{form.title}</div>
          {form.description ? (
            <div className="question-form-desc">{form.description}</div>
          ) : null}
        </div>
        {locked ? (
          <span className="question-form-pill">
            {submittedAnswers ? "已提交" : "只读"}
          </span>
        ) : null}
      </div>
      <div className="question-form-body">
        {form.questions.map((q) => {
          const value = answers[q.id];
          return (
            <div key={q.id} className="qf-field">
              <label className="qf-label">
                <span>{q.label}</span>
                {q.required ? <span className="qf-required">*</span> : null}
              </label>
              {q.help ? <div className="qf-help">{q.help}</div> : null}
              {q.type === "radio" && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => (
                    <label
                      key={opt}
                      className={`qf-chip${value === opt ? " qf-chip-on" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`${form.id}-${q.id}`}
                        value={opt}
                        checked={value === opt}
                        disabled={locked}
                        onChange={() => update(q.id, opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              {q.type === "checkbox" && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => {
                    const arr = Array.isArray(value) ? value : [];
                    const on = arr.includes(opt);
                    const maxed =
                      q.maxSelections !== undefined &&
                      !on &&
                      arr.length >= q.maxSelections;
                    return (
                      <label
                        key={opt}
                        className={`qf-chip${on ? " qf-chip-on" : ""}${maxed ? " qf-chip-disabled" : ""}`}
                      >
                        <input
                          type="checkbox"
                          value={opt}
                          checked={on}
                          disabled={locked || maxed}
                          onChange={() =>
                            toggleCheckbox(q.id, opt, q.maxSelections)
                          }
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {q.type === "select" && q.options ? (
                <select
                  className="qf-select"
                  value={typeof value === "string" ? value : ""}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : null}
              {q.type === "text" ? (
                <input
                  type="text"
                  className="qf-input"
                  value={typeof value === "string" ? value : ""}
                  placeholder={q.placeholder}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              ) : null}
              {q.type === "textarea" ? (
                <textarea
                  className="qf-textarea"
                  value={typeof value === "string" ? value : ""}
                  placeholder={q.placeholder}
                  disabled={locked}
                  rows={3}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="question-form-foot">
        {locked ? (
          <span className="qf-locked-note">
            {submittedAnswers ? "表单已提交" : "历史记录（只读）"}
          </span>
        ) : (
          <span className="qf-hint">请填写以上信息</span>
        )}
        {!locked ? (
          <button
            type="button"
            className="primary"
            onClick={handleSubmit}
            disabled={!ready}
            title={ready ? "提交表单" : "请完成必填项"}
          >
            {form.submitLabel ?? "提交"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function buildInitialState(
  form: QuestionForm,
  submitted: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const q of form.questions) {
    if (submitted && submitted[q.id] !== undefined) {
      out[q.id] = submitted[q.id]!;
      continue;
    }
    if (q.defaultValue !== undefined) {
      out[q.id] = q.defaultValue;
      continue;
    }
    if (q.type === "checkbox") {
      out[q.id] = [];
    } else {
      out[q.id] = "";
    }
  }
  return out;
}

/**
 * Reverse of formatFormAnswers — when we render an old assistant message
 * that contained a form, look at the next user message in the conversation
 * to see if the form was already answered. If so, return the answers map
 * so the form renders in the locked "answered" state with the user's
 * picks visible.
 */
export function parseSubmittedAnswers(
  form: QuestionForm,
  userMessageContent: string,
): Record<string, string | string[]> | null {
  const lines = userMessageContent.split("\n").map((l) => l.trim());
  if (lines.length === 0) return null;
  const header = lines[0] ?? "";
  // We accept any "form answers" header so the agent can paraphrase.
  if (!/^\[form answers/i.test(header)) return null;
  const answers: Record<string, string | string[]> = {};
  const labelToId = new Map<string, string>();
  for (const q of form.questions) labelToId.set(q.label.toLowerCase(), q.id);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^[-*]\s*([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const labelKey = m[1]!.trim().toLowerCase();
    const value = m[2]!.trim();
    const id = labelToId.get(labelKey);
    if (!id) continue;
    const q = form.questions.find((x) => x.id === id);
    if (!q) continue;
    if (q.type === "checkbox") {
      answers[id] = value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.toLowerCase() !== "(skipped)");
    } else {
      answers[id] = value.toLowerCase() === "(skipped)" ? "" : value;
    }
  }
  return Object.keys(answers).length > 0 ? answers : null;
}
