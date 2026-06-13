import { useMemo, useState } from "react";
import { Button, Form, Radio, Checkbox, Select, Input, Card, Tag, Typography } from "antd";
import { QuestionCircleOutlined, CheckCircleOutlined, EditOutlined } from "@ant-design/icons";
import { formatFormAnswers, QuestionForm } from "../utils/question-form";

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Props {
  form: QuestionForm;
  interactive: boolean;
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

  function handleSubmit() {
    if (locked || !onSubmit) return;
    const missing = form.questions
      .filter((q) => q.required)
      .find((q) => {
        const v = answers[q.id];
        return Array.isArray(v) ? v.length === 0 : !(typeof v === "string" && v.trim().length > 0);
      });
    if (missing) return;
    onSubmit(formatFormAnswers(form, answers), answers);
  }

  const ready = form.questions
    .filter((q) => q.required)
    .every((q) => {
      const v = answers[q.id];
      return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0;
    });

  return (
    <Card
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <QuestionCircleOutlined style={{ color: "#1677ff" }} />
          <span>{form.title}</span>
          <Tag color={locked ? (submittedAnswers ? "success" : "default") : "processing"}>
            {locked ? (submittedAnswers ? "已提交" : "只读") : "待填写"}
          </Tag>
        </div>
      }
      size="small"
      style={{ marginBottom: 8 }}
      extra={form.description && <Text type="secondary" style={{ fontSize: 12 }}>{form.description}</Text>}
    >
      {form.questions.map((q) => {
        const value = answers[q.id];
        return (
          <div key={q.id} style={{ marginBottom: 12 }}>
            <Form.Item
              label={
                <span>
                  {q.label}
                  {q.required && <span style={{ color: "#ff4d4f" }}> *</span>}
                </span>
              }
              help={q.help}
              style={{ marginBottom: 0 }}
            >
              {q.type === "radio" && q.options && (
                <Radio.Group
                  value={typeof value === "string" ? value : undefined}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                >
                  {q.options.map((opt) => (
                    <Radio.Button key={opt} value={opt}>{opt}</Radio.Button>
                  ))}
                </Radio.Group>
              )}

              {q.type === "checkbox" && q.options && (
                <Checkbox.Group
                  value={Array.isArray(value) ? value : []}
                  disabled={locked}
                  onChange={(vals) => update(q.id, vals as string[])}
                  options={q.options}
                />
              )}

              {q.type === "select" && q.options && (
                <Select
                  value={typeof value === "string" && value ? value : undefined}
                  disabled={locked}
                  onChange={(val) => update(q.id, val)}
                  placeholder="请选择"
                  style={{ width: "100%" }}
                  options={q.options.map((opt) => ({ value: opt, label: opt }))}
                />
              )}

              {q.type === "text" && (
                <Input
                  value={typeof value === "string" ? value : ""}
                  placeholder={q.placeholder}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              )}

              {q.type === "textarea" && (
                <TextArea
                  value={typeof value === "string" ? value : ""}
                  placeholder={q.placeholder}
                  disabled={locked}
                  rows={3}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              )}
            </Form.Item>
          </div>
        );
      })}

      {!locked && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button type="primary" onClick={handleSubmit} disabled={!ready}>
            {form.submitLabel ?? "提交"}
          </Button>
        </div>
      )}

      {locked && (
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {submittedAnswers ? "表单已提交" : "历史记录（只读）"}
          </Text>
        </div>
      )}
    </Card>
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

export function parseSubmittedAnswers(
  form: QuestionForm,
  userMessageContent: string,
): Record<string, string | string[]> | null {
  const lines = userMessageContent.split("\n").map((l) => l.trim());
  if (lines.length === 0) return null;
  const header = lines[0] ?? "";
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
