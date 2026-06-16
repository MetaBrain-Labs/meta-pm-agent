export interface StreamChunk {
  type: "reasoning" | "text";
  content: string;
}

export type ConversationStreamEvent =
  | StreamChunk
  | { type: "question-form-start" }
  | { type: "question-form-complete"; content: string }
  | { type: "user-input-start" }
  | { type: "user-input-complete"; content: string };
