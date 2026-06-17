export function isFormAnswer(text: string): boolean {
  return /^\[form answers\s*[-–—]\s*[\w-]+\]/m.test(text);
}
