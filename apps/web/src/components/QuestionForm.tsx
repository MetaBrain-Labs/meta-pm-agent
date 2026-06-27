/**
 * Human-in-the-Loop 表单卡片。
 *
 * 渲染由 LangGraph interrupt payload 携带的 Question Form，并在提交时把结构化答案
 * 交给上层转换为 Command(resume) 所需的 HITL response。
 *
 * Responsibilities:
 * - 渲染单选、多选、下拉、文本和长文本问题
 * - 校验必填项并输出稳定的答案文本
 * - 在历史消息中以只读方式展示已提交答案
 *
 * Notes:
 * - 本组件不直接调用 API；LangGraph resume 由页面层随 `/api/chat` 请求提交。
 */

import { useMemo, useState } from "react";
import {
  Button,
  Form,
  Radio,
  Checkbox,
  Select,
  Input,
  Card,
  Tag,
  Typography,
  Divider,
} from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { formatFormAnswers, QuestionForm } from "../utils/question-form";

const { Text } = Typography;
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
        return Array.isArray(v)
          ? v.length === 0
          : !(typeof v === "string" && v.trim().length > 0);
      });
    if (missing) return;
    onSubmit(formatFormAnswers(form, answers), answers);
  }

  const ready = form.questions
    .filter((q) => q.required)
    .every((q) => {
      const v = answers[q.id];
      return Array.isArray(v)
        ? v.length > 0
        : typeof v === "string" && v.trim().length > 0;
    });

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <QuestionCircleOutlined style={{ color: "var(--primary)" }} />
          <span
            style={{
              fontFamily: "var(--sans)",
              color: "var(--ink)",
              fontWeight: 800,
            }}
          >
            {form.title}
          </span>
          <Tag
            style={{
              fontFamily: "var(--sans)",
              fontSize: 11,
              borderRadius: 6,
              border: "none",
              background: locked
                ? submittedAnswers
                  ? "var(--success-soft)"
                  : "var(--line-faint)"
                : "var(--primary-soft)",
              color: locked
                ? submittedAnswers
                  ? "var(--success)"
                  : "var(--ink-faint)"
                : "var(--primary)",
            }}
          >
            {locked ? (submittedAnswers ? "HITL 已提交" : "HITL 只读") : "HITL 待处理"}
          </Tag>
        </div>
      }
      size="small"
      className="mb-2"
      style={{
        background: "var(--surface)",
        borderColor: "var(--line-soft)",
        borderRadius: 8,
        borderLeft:
          interactive && !submittedAnswers
            ? "3px solid var(--primary)"
            : undefined,
        boxShadow: "var(--shadow-card)",
      }}
      extra={
        form.description && (
          <Text
            style={{
              color: "var(--ink-faint)",
              fontSize: 12,
              fontFamily: "var(--body)",
            }}
          >
            {form.description}
          </Text>
        )
      }
    >
      {form.questions.map((q) => {
        const value = answers[q.id];
        return (
          <div key={q.id}>
            <Form.Item
              layout="vertical"
              label={
                <span
                  style={{
                    fontFamily: "var(--sans)",
                    color: "var(--ink)",
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  {q.label}
                  {q.required && (
                    <span style={{ color: "var(--danger)" }}> *</span>
                  )}
                </span>
              }
              help={q.help && <div className="mb-4">{q.help}</div>}
            >
              {q.type === "radio" && q.options && (
                <Radio.Group
                  value={typeof value === "string" ? value : undefined}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                >
                  {q.options.map((opt) => (
                    <Radio.Button key={opt} value={opt}>
                      {opt}
                    </Radio.Button>
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
                  className="w-full"
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

            <Divider />
          </div>
        );
      })}

      {!locked && (
        <div className="flex justify-end">
          <Button type="primary" onClick={handleSubmit} disabled={!ready}>
            {form.submitLabel ?? "提交"}
          </Button>
        </div>
      )}

      {locked && (
        <div className="text-right">
          <Text
            style={{
              color: "var(--ink-faint)",
              fontSize: 12,
              fontFamily: "var(--body)",
            }}
          >
            {submittedAnswers ? "人审决策已提交" : "历史人审记录（只读）"}
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
