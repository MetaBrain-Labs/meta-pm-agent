export interface QuestionFormData {
  id: string;
  title: string;
  body: Record<string, unknown>;
  rawBody: string;
  fullMatch: string;
}

export function parseQuestionForm(text: string): QuestionFormData | null {
  const regex =
    /<question-form\s+id="([^"]*)"\s+title="([^"]*)"\s*>([\s\S]*?)<\/question-form>/;
  const match = text.match(regex);
  if (!match) {
    return null;
  }

  const rawBody = match[3].trim();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }

  return {
    id: match[1],
    title: match[2],
    body,
    rawBody,
    fullMatch: match[0],
  };
}

export function hasQuestionForm(text: string): boolean {
  return /<question-form\s+id="[^"]*"\s+title="[^"]*"\s*>/.test(text);
}

export function isFormAnswer(text: string): boolean {
  return /^\[form answers\s*[-–—]\s*[\w-]+\]/m.test(text);
}

export function parseFormAnswers(
  text: string,
): Record<string, string> | null {
  const answers: Record<string, string> = {};

  for (const line of text.split("\n")) {
    const match = line.match(/^-\s*([^:]+):\s*(.*)$/);
    if (match) {
      answers[match[1].trim()] = match[2].trim();
    }
  }

  return Object.keys(answers).length > 0 ? answers : null;
}
