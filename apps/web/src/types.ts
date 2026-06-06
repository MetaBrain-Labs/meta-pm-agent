export type StreamEventType =
  | "start"
  | "thinking"
  | "thinking-done"
  | "text"
  | "question-form-start"
  | "question-form-complete"
  | "todo-update"
  | "tool-call"
  | "tool-result"
  | "step-finish"
  | "finish"
  | "error"
  | "abort";

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  usage?: Record<string, unknown>;
  error?: unknown;
  todos?: Array<{ index: number; content: string; status: string }>;
}

export interface TodoItem {
  index: number;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  thinking?: string;
  questionForm?: { state: "generating" | "complete"; content?: string };
  todos?: TodoItem[];
  toolCalls?: Array<{ name: string; args?: Record<string, unknown>; result?: unknown }>;
  usage?: Record<string, unknown>;
  timestamp: number;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

export interface ThreadInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
