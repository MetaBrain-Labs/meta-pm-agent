/**
 * Parser for inline <question-form>...</question-form> blocks the agent
 * emits to ask the user a structured set of clarifying questions before
 * starting design work.
 *
 * Body must be JSON. Example:
 *
 *   <question-form id="discovery" title="Quick brief">
 *   {
 *     "questions": [
 *       { "id": "platform", "label": "Platform", "type": "radio",
 *         "options": ["Mobile (iOS/Android)", "Desktop web", "Responsive"],
 *         "required": true },
 *       { "id": "audience", "label": "Primary audience", "type": "text",
 *         "placeholder": "e.g. SaaS buyers" }
 *     ]
 *   }
 *   </question-form>
 *
 * Splits a final assistant text payload into ordered segments — prose +
 * forms — so AssistantMessage can render the form inline.
 */
export type QuestionType =
  | "radio"
  | "checkbox"
  | "select"
  | "text"
  | "textarea"
  | "direction-cards";

/**
 * Rich card metadata for a single `direction-cards` option. The picker
 * renders a swatch row, a serif/sans type sample, a mood blurb, and a
 * "refs" line so users can scan visually instead of squinting at radio
 * labels. The agent emits this metadata inline in the form JSON so the
 * UI can render without additional fetches.
 */
export interface DirectionCard {
  /** The radio value — what comes back in the user's answer. Match a label in `options`. */
  id: string;
  /** Short headline on the card (e.g. "Editorial — Monocle / FT magazine"). */
  label: string;
  /** One- or two-sentence mood blurb. */
  mood: string;
  /** Real-world exemplars (≤ 4). */
  references: string[];
  /** 4–6 swatch hex / OKLch strings for the palette row. */
  palette: string[];
  /** Display (headline) font stack, used to render the live "Aa" sample. */
  displayFont: string;
  /** Body font stack, used to render the secondary sample. */
  bodyFont: string;
}

export interface FormQuestion {
  id: string;
  label: string;
  type: QuestionType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  help?: string;
  /** help 的展示方式；缺省时保持题目下方内联展示。 */
  helpMode?: "inline" | "modal";
  defaultValue?: string | string[];
  /** Only applies when `type === 'checkbox'`. Caps the number of selected options. */
  maxSelections?: number;
  /** Only present when `type === 'direction-cards'`. Mapped to options by `id`. */
  cards?: DirectionCard[];
  /** 是否允许用户折叠单个问题。 */
  collapsible?: boolean;
  /** 首次渲染时是否默认折叠。 */
  defaultCollapsed?: boolean;
}

export interface QuestionForm {
  id: string;
  title: string;
  description?: string;
  questions: FormQuestion[];
  submitLabel?: string;
  /** 仅包含选填问题时使用的流程变体。 */
  variant?: "optional-followup";
  /** 主提交按钮是否至少需要一个非空答案。 */
  requireAnyAnswer?: boolean;
  /** 不提交答案时显示的次要动作文案。 */
  secondarySubmitLabel?: string;
  /** 发送给运行时的稳定次要动作值。 */
  secondaryActionValue?: string;
}

/**
 * 前端提交给 API 的 LangGraph HITL 恢复命令。
 */
export interface HumanInTheLoopResume {
  threadId: string;
  response: {
    decisions: Array<{ type: "respond"; message: string }>;
  };
}

export type FormSegment =
  | { kind: "text"; text: string }
  | { kind: "form"; form: QuestionForm; raw: string };

const OPEN_RE = /<question-form\b([^>]*)>/i;
const CLOSE_TAG = "</question-form>";

export function splitOnQuestionForms(input: string): FormSegment[] {
  const out: FormSegment[] = [];
  let cursor = 0;
  // Scan repeatedly for <question-form> opens; for each, locate the
  // matching close tag and try to parse the JSON body. Anything that
  // doesn't parse cleanly stays in the prose stream.
  while (cursor < input.length) {
    const slice = input.slice(cursor);
    const m = OPEN_RE.exec(slice);
    if (!m) {
      out.push({ kind: "text", text: slice });
      break;
    }
    const openStart = cursor + m.index;
    const openEnd = openStart + m[0].length;
    const closeIdx = input.indexOf(CLOSE_TAG, openEnd);
    if (closeIdx === -1) {
      // Unterminated — leave the rest as prose so we don't swallow it.
      out.push({ kind: "text", text: slice });
      break;
    }
    if (openStart > cursor) {
      out.push({ kind: "text", text: input.slice(cursor, openStart) });
    }
    const body = input.slice(openEnd, closeIdx);
    const attrs = parseAttrs(m[1] ?? "");
    const form = tryParseForm(body, attrs);
    if (form) {
      out.push({
        kind: "form",
        form,
        raw: input.slice(openStart, closeIdx + CLOSE_TAG.length),
      });
    } else {
      // Malformed — keep raw text so the user can still see it.
      out.push({
        kind: "text",
        text: input.slice(openStart, closeIdx + CLOSE_TAG.length),
      });
    }
    cursor = closeIdx + CLOSE_TAG.length;
  }
  return out;
}

/* 
  解析 HTML Tag 属性
  例如：
  解析前：
    <question-form id="discovery" title="Quick brief">
  解析后：
    {
      id: "discovery",
      title: "Quick brief"
    }
*/
function parseAttrs(raw: string): Record<string, string> {
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out[m[1] as string] = (m[2] ?? m[3] ?? "") as string;
  }
  return out;
}

/*
  JSON 字符串
        ↓
  JSON.parse
        ↓
  类型校验
        ↓
  标准化
        ↓
  QuestionForm 对象
*/
function tryParseForm(
  body: string,
  attrs: Record<string, string>,
): QuestionForm | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  // Allow the JSON to be wrapped in a fenced ```json block — common when
  // the model echoes its own indented body.
  // 去掉 Markdown 代码块包裹，只保留里面的 JSON 内容
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let data: unknown;
  try {
    data = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : null;
  if (!rawQuestions) return null;
  const questions: FormQuestion[] = [];
  rawQuestions.forEach((q, i) => {
    if (!q || typeof q !== "object") return;
    const qo = q as Record<string, unknown>;
    const id =
      typeof qo.id === "string" && qo.id.trim().length > 0
        ? qo.id.trim()
        : `q${i + 1}`;
    const label = typeof qo.label === "string" ? qo.label : id;
    const type = normalizeType(qo.type);
    const options = Array.isArray(qo.options)
      ? qo.options.filter((o): o is string => typeof o === "string")
      : undefined;
    const placeholder =
      typeof qo.placeholder === "string" ? qo.placeholder : undefined;
    const help = typeof qo.help === "string" ? qo.help : undefined;
    const helpMode: FormQuestion["helpMode"] =
      qo.helpMode === "modal" ? "modal" : undefined;
    const required = qo.required === true;
    const maxSelections =
      typeof qo.maxSelections === "number" &&
      Number.isInteger(qo.maxSelections) &&
      qo.maxSelections > 0
        ? qo.maxSelections
        : undefined;
    const cards = parseDirectionCards(qo.cards);
    const collapsible = qo.collapsible === true;
    const defaultCollapsed = qo.defaultCollapsed === true;
    const defaultValue =
      typeof qo.defaultValue === "string"
        ? qo.defaultValue
        : Array.isArray(qo.defaultValue)
          ? qo.defaultValue.filter((v): v is string => typeof v === "string")
          : typeof qo.default === "string"
            ? qo.default
            : undefined;
    questions.push({
      id,
      label,
      type,
      ...(options ? { options } : {}),
      ...(placeholder ? { placeholder } : {}),
      ...(help ? { help } : {}),
      ...(helpMode ? { helpMode } : {}),
      ...(required ? { required } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(maxSelections !== undefined && type === "checkbox"
        ? { maxSelections }
        : {}),
      ...(cards ? { cards } : {}),
      ...(collapsible ? { collapsible } : {}),
      ...(defaultCollapsed ? { defaultCollapsed } : {}),
    });
  });
  if (questions.length === 0) return null;
  const id = attrs.id ?? (typeof obj.id === "string" ? obj.id : "discovery");
  const title =
    attrs.title ??
    (typeof obj.title === "string" ? obj.title : "A few quick questions");
  const description =
    typeof obj.description === "string" ? obj.description : undefined;
  const submitLabel =
    typeof obj.submitLabel === "string" ? obj.submitLabel : undefined;
  const variant =
    obj.variant === "optional-followup" ? obj.variant : undefined;
  const requireAnyAnswer = obj.requireAnyAnswer === true;
  const secondarySubmitLabel =
    typeof obj.secondarySubmitLabel === "string"
      ? obj.secondarySubmitLabel
      : undefined;
  const secondaryActionValue =
    typeof obj.secondaryActionValue === "string"
      ? obj.secondaryActionValue
      : undefined;
  return {
    id,
    title,
    questions,
    ...(description ? { description } : {}),
    ...(submitLabel ? { submitLabel } : {}),
    ...(variant ? { variant } : {}),
    ...(requireAnyAnswer ? { requireAnyAnswer } : {}),
    ...(secondarySubmitLabel ? { secondarySubmitLabel } : {}),
    ...(secondaryActionValue ? { secondaryActionValue } : {}),
  };
}

function normalizeType(raw: unknown): QuestionType {
  if (typeof raw !== "string") return "text";
  const lower = raw.toLowerCase().trim();
  if (lower === "radio" || lower === "single" || lower === "choice")
    return "radio";
  if (lower === "checkbox" || lower === "multi" || lower === "multiple")
    return "checkbox";
  if (lower === "select" || lower === "dropdown") return "select";
  if (lower === "textarea" || lower === "long" || lower === "paragraph")
    return "textarea";
  if (
    lower === "direction-cards" ||
    lower === "directions" ||
    lower === "cards" ||
    lower === "direction"
  )
    return "direction-cards";
  return "text";
}

function parseDirectionCards(raw: unknown): DirectionCard[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DirectionCard[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id =
      typeof e.id === "string" && e.id.trim().length > 0 ? e.id.trim() : null;
    const label = typeof e.label === "string" ? e.label : null;
    if (id === null || label === null) continue;
    const mood = typeof e.mood === "string" ? e.mood : "";
    const references = Array.isArray(e.references)
      ? e.references
          .filter((r): r is string => typeof r === "string")
          .slice(0, 6)
      : [];
    const palette = Array.isArray(e.palette)
      ? e.palette.filter((p): p is string => typeof p === "string").slice(0, 8)
      : [];
    const displayFont =
      typeof e.displayFont === "string" ? e.displayFont : "Georgia, serif";
    const bodyFont =
      typeof e.bodyFont === "string"
        ? e.bodyFont
        : "-apple-system, system-ui, sans-serif";
    out.push({ id, label, mood, references, palette, displayFont, bodyFont });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Format a finished set of answers into a prose user message that the
 * agent can read on its next turn. The shape is stable enough that the
 * agent can recognise "the form was answered" without us emitting any
 * structured wrapper.
 */
export function formatFormAnswers(
  form: QuestionForm,
  answers: Record<string, string | string[]>,
): string {
  const lines: string[] = [];
  lines.push(`[form answers - ${form.id}]`);
  for (const q of form.questions) {
    const v = answers[q.id];
    let display: string;
    if (Array.isArray(v)) display = v.length > 0 ? v.join(", ") : "(skipped)";
    else if (typeof v === "string")
      display = v.trim().length > 0 ? v.trim() : "(skipped)";
    else display = "(skipped)";
    lines.push(`- ${q.label}: ${display}`);
  }
  return lines.join("\n");
}

/**
 * 格式化无需填写字段的表单动作，供运行时选择后续确认流程。
 */
export function formatFormAction(form: QuestionForm, action: string): string {
  return `[form answers - ${form.id}]\n- workflow_action: ${action}`;
}

/**
 * 判断表单文本是否为“停止可选问题”的内部流程控制动作。
 */
export function isOptionalWorkflowStopAction(text: string): boolean {
  return /^-\s*workflow_action:\s*stop_optional_questions\s*$/m.test(text);
}

/**
 * 将 Question Form 答案转换为 LangChain HITL 的 respond 决策。
 */
export function formatHumanInTheLoopResume(
  threadId: string,
  form: QuestionForm,
  answers: Record<string, string | string[]>,
  message?: string,
): HumanInTheLoopResume {
  return {
    threadId,
    response: {
      decisions: [
        {
          type: "respond",
          message: message ?? formatFormAnswers(form, answers),
        },
      ],
    },
  };
}
