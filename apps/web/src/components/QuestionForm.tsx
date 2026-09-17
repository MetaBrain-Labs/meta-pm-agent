/**
 * Agent 中断表单（HITL / Question Form）
 *
 * 运行时在等待用户补充信息时会暂停工作流。该表单**替换对话栏底部的输入框**，
 * 而不是作为消息卡片混在历史里：用户此刻只能回答当前问题，答完提交后工作流
 * 继续，输入框自动恢复。
 *
 * Responsibilities:
 * - 逐题展示当前问题、选项与补充说明，并提供上一个 / 下一个导航
 * - 校验必填项，缺答时跳到第一个未答问题
 * - 以只读方式回放已提交答案
 *
 * Notes:
 * - 提交负载沿用既有 question-form 逻辑：formatFormAnswers / formatFormAction
 *   与 formatHumanInTheLoopResume，组件本身不调用 API。
 * - 一次只展示一题只是展示层分页，答案结构与提交格式完全不变。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Input,
  Radio,
  Select,
  Tooltip,
} from "antd";
import {
  AimOutlined,
  CheckCircleFilled,
  DownOutlined,
  LeftOutlined,
  PauseCircleFilled,
  RightOutlined,
  SendOutlined,
  UpOutlined,
} from "@ant-design/icons";
import {
  formatFormAction,
  formatFormAnswers,
  type FormQuestion,
  type QuestionForm,
} from "../utils/question-form";

const { TextArea } = Input;

interface Props {
  form: QuestionForm;
  interactive: boolean;
  submittedAnswers?: Record<string, string | string[]>;
  onSubmit?: (text: string, answers: Record<string, string | string[]>) => void;
}

/** 答案是否为空；空数组与纯空白字符串都算未填写。 */
function isEmptyAnswer(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return !(typeof value === "string" && value.trim().length > 0);
}

/** 选项多于此数量时改用下拉，避免当前问题把面板撑得很高。 */
const OPTION_LIST_LIMIT = 6;

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
  const [index, setIndex] = useState(0);
  /**
   * 是否忽略全部选填问题。
   *
   * 只影响本题的呈现顺序：勾选后浏览范围收窄到必填题，必填答完即可提交。
   * 答案结构与提交格式完全不变——被跳过的选填题在提交文本里仍是 (skipped)，
   * 与用户逐题留空的效果一致，因此后端/Agent 不需要任何改动。
   */
  const [skipOptional, setSkipOptional] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  /** 换题后把内容区滚回顶部。 */
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = 0;
  }, [index]);

  const locked = !interactive || !onSubmit || submittedAnswers !== undefined;
  /** 勾选忽略选填后，只浏览必填题；全部选填时回退到完整列表。 */
  const requiredOnly = form.questions.filter((item) => item.required);
  const browsable =
    skipOptional && requiredOnly.length > 0 ? requiredOnly : form.questions;
  const total = browsable.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const question = browsable[safeIndex];
  const hasOptional = requiredOnly.length < form.questions.length;

  /** 第一个未作答的必填题在原列表中的下标；没有则为 -1。 */
  const firstMissingIndex = form.questions.findIndex(
    (item) => item.required && isEmptyAnswer(answers[item.id]),
  );
  const requiredReady = firstMissingIndex === -1;
  const hasAnyAnswer = Object.values(answers).some(
    (value) => !isEmptyAnswer(value),
  );
  const ready = requiredReady && (!form.requireAnyAnswer || hasAnyAnswer);
  const isLastQuestion = safeIndex >= total - 1;
  /** 已提交或历史回放时退化为只读摘要。 */
  const lockedAnswers = submittedAnswers ?? answers;

  /** 跳到某个必填题在浏览范围内对应的步数。 */
  function goToMissingRequired() {
    const target = form.questions[firstMissingIndex];
    if (!target) return;
    const position = browsable.findIndex((item) => item.id === target.id);
    setIndex(position === -1 ? 0 : position);
  }

  function update(id: string, value: string | string[]) {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function handleSubmit() {
    if (locked || !onSubmit || total === 0) return;
    // 必填项没答完时跳到第一个缺口，让用户知道差哪一题。
    if (!requiredReady) {
      goToMissingRequired();
      return;
    }
    if (form.requireAnyAnswer && !hasAnyAnswer) return;
    onSubmit(formatFormAnswers(form, answers), answers);
  }

  /** 切换「忽略选填」后重置到第一题，避免停在越界的步数上。 */
  function handleToggleSkipOptional(next: boolean) {
    setSkipOptional(next);
    setIndex(0);
  }

  function handleSecondaryAction() {
    if (locked || !onSubmit || !form.secondarySubmitLabel) return;
    onSubmit(
      formatFormAction(form, form.secondaryActionValue ?? "secondary_action"),
      {},
    );
  }

  if (locked || !question) {
    return (
      <section className="hitl-form is-locked" aria-label="Agent 中断表单">
        <header className="hitl-form-head">
          <span className="hitl-form-icon" aria-hidden="true">
            <CheckCircleFilled />
          </span>
          <div className="hitl-form-head-copy">
            <strong>
              {submittedAnswers ? "已提交，工作流将继续执行" : "历史人审记录"}
            </strong>
            <span>
              {submittedAnswers ? "答案已发送给 Agent" : "该表单已结束，仅作回放"}
            </span>
          </div>
        </header>
        <dl className="hitl-answers">
          {form.questions
            .filter(
              (item) => submittedAnswers !== undefined || !isEmptyAnswer(lockedAnswers[item.id]),
            )
            .map((item) => (
              <div key={item.id} className="hitl-answer">
                <dt>{item.label}</dt>
                <dd>{formatAnswerValue(lockedAnswers[item.id])}</dd>
              </div>
            ))}
        </dl>
      </section>
    );
  }

  return (
    <section className="hitl-form" aria-label="Agent 中断表单">
      {/* 头部始终说明 Agent 处于暂停状态，这是用户最需要先知道的事。 */}
      <header className="hitl-form-head">
        <span className="hitl-form-icon" aria-hidden="true">
          <PauseCircleFilled />
        </span>
        <div className="hitl-form-head-copy">
          <strong>问渠正在等待您的回答</strong>
          <span>Agent 已暂停，提交后工作流会继续执行</span>
        </div>
        {form.title && (
          <Tooltip title={form.title}>
            <span className="hitl-form-title">{form.title}</span>
          </Tooltip>
        )}
      </header>

      <div className="hitl-form-body scrollbar-none-thin" ref={bodyRef}>
        {form.description && safeIndex === 0 && (
          <p className="hitl-form-description">{form.description}</p>
        )}

        <div className="hitl-form-progress">
          <span>
            问题 {safeIndex + 1} / {total}
          </span>
          <em>{question.required ? "必填" : "选填"}</em>
          {skipOptional && hasOptional && (
            <em className="hitl-form-progress-note">已忽略选填</em>
          )}
          {!requiredReady && (
            <Button
              type="link"
              size="small"
              className="hitl-form-jump"
              icon={<AimOutlined />}
              onClick={goToMissingRequired}
            >
              跳到未答问题
            </Button>
          )}
        </div>

        <h3 className="hitl-form-label">{question.label}</h3>

        {question.help && question.helpMode !== "modal" && (
          <p className="hitl-form-help">{question.help}</p>
        )}

        <div className="hitl-form-input">
          <QuestionInput
            question={question}
            value={answers[question.id]}
            onChange={(value) => update(question.id, value)}
          />
        </div>

        {question.help && question.helpMode === "modal" && (
          <CollapsibleHelp label={question.label} help={question.help} />
        )}

        {(question.type === "text" || question.type === "textarea") && (
          <p className="hitl-form-hint">补充内容会随答案一起发送给 Agent。</p>
        )}
      </div>

      <footer className="hitl-form-foot">
        <div className="hitl-form-foot-nav">
          <Button
            icon={<LeftOutlined />}
            disabled={safeIndex === 0}
            onClick={() => setIndex(Math.max(0, safeIndex - 1))}
          >
            上一个
          </Button>

          {isLastQuestion ? (
            <Tooltip
              title={
                ready
                  ? "提交后 Agent 会带着这些答案继续执行"
                  : "还有必填问题未回答"
              }
            >
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={!ready}
                onClick={handleSubmit}
              >
                {form.submitLabel ?? "发送"}
              </Button>
            </Tooltip>
          ) : (
            <Button
              type="primary"
              icon={<RightOutlined />}
              iconPosition="end"
              onClick={() => setIndex(Math.min(total - 1, safeIndex + 1))}
            >
              下一个
            </Button>
          )}

          {form.secondarySubmitLabel && (
            <Button icon={<SendOutlined />} onClick={handleSecondaryAction}>
              {form.secondarySubmitLabel}
            </Button>
          )}
        </div>

        {/*
          只有存在选填题时才提供该开关。勾选后浏览范围收窄到必填题，
          必填答完即可提交；被跳过的选填题在提交文本里记为 (skipped)。
        */}
        {hasOptional && (
          <Checkbox
            className="hitl-form-skip"
            checked={skipOptional}
            onChange={(event) => handleToggleSkipOptional(event.target.checked)}
          >
            忽略所有选填（共 {form.questions.length - requiredOnly.length} 题）
          </Checkbox>
        )}
      </footer>
    </section>
  );
}

/**
 * 单题输入控件；类型与 Question Form 契约保持一致。
 */
function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: FormQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  if (question.type === "radio" && question.options) {
    // 选项不多时用原生单选列表，与「○ 选项」的阅读习惯一致。
    if (question.options.length <= OPTION_LIST_LIMIT) {
      return (
        <Radio.Group
          className="hitl-options"
          value={typeof value === "string" ? value : undefined}
          onChange={(event) => onChange(event.target.value)}
        >
          {question.options.map((option) => (
            <Radio key={option} value={option}>
              {option}
            </Radio>
          ))}
        </Radio.Group>
      );
    }
    return (
      <Select
        virtual={false}
        classNames={{ popup: { root: "question-form-options" } }}
        value={typeof value === "string" && value ? value : undefined}
        onChange={onChange}
        placeholder="请选择"
        className="w-full"
        options={question.options.map((option) => ({
          value: option,
          label: option,
        }))}
      />
    );
  }

  if (question.type === "checkbox" && question.options) {
    return (
      <Checkbox.Group
        className="hitl-options"
        value={Array.isArray(value) ? value : []}
        onChange={(values) => onChange(values as string[])}
        options={question.options}
      />
    );
  }

  if (question.type === "select" && question.options) {
    return (
      <Select
        virtual={false}
        classNames={{ popup: { root: "question-form-options" } }}
        value={typeof value === "string" && value ? value : undefined}
        onChange={onChange}
        placeholder="请选择"
        className="w-full"
        options={question.options.map((option) => ({
          value: option,
          label: option,
        }))}
      />
    );
  }

  if (question.type === "textarea") {
    return (
      <TextArea
        value={typeof value === "string" ? value : ""}
        placeholder={question.placeholder}
        rows={3}
        autoSize={{ minRows: 3, maxRows: 6 }}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      value={typeof value === "string" ? value : ""}
      placeholder={question.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * 折叠展示的长帮助内容：默认收起，避免把当前问题挤出视野。
 */
function CollapsibleHelp({ label, help }: { label: string; help: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hitl-form-fold">
      <button
        type="button"
        className="hitl-form-fold-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <UpOutlined /> : <DownOutlined />}
        <span>{open ? "收起相关资料" : `查看相关资料：${label}`}</span>
      </button>
      {open && <p className="hitl-form-help">{help}</p>}
    </div>
  );
}

/** 答案值转成一行可读文本。 */
function formatAnswerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join("、") : "未填写";
  return value && value.trim() ? value : "未填写";
}

function buildInitialState(
  form: QuestionForm,
  submitted: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const question of form.questions) {
    if (submitted && submitted[question.id] !== undefined) {
      out[question.id] = submitted[question.id]!;
      continue;
    }
    if (question.defaultValue !== undefined) {
      out[question.id] = question.defaultValue;
      continue;
    }
    out[question.id] = question.type === "checkbox" ? [] : "";
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
  for (const question of form.questions) {
    labelToId.set(question.label.toLowerCase(), question.id);
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = /^[-*]\s*([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const labelKey = match[1]!.trim().toLowerCase();
    const value = match[2]!.trim();
    const id = labelToId.get(labelKey);
    if (!id) continue;
    const question = form.questions.find((item) => item.id === id);
    if (!question) continue;
    if (question.type === "checkbox") {
      answers[id] = value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.toLowerCase() !== "(skipped)");
    } else {
      answers[id] = value.toLowerCase() === "(skipped)" ? "" : value;
    }
  }
  return Object.keys(answers).length > 0 ? answers : null;
}
