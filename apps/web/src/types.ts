export type StreamEventType =
  | "start"
  | "thinking"
  | "thinking-done"
  | "text"
  | "question-form-start"
  | "question-form-complete"
  | "user-input-start"
  | "user-input-complete"
  | "request-analysis-start"
  | "request-analysis-complete"
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
  analysis?: RequestAnalysis;
}

export interface TodoItem {
  index: number;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface UserInputItem {
  index: number;
  content: string;
  type: "陈述" | "提问" | "补充" | "请求";
}

export interface MissingInformation {
  index: number;
  description: string;
  importance: number;
}

export interface BusinessModelItem {
  index: number;
  user_goal: string;
  goal_constraints: string[];
  missing_information: MissingInformation[];
  covered_user_input_indexes: number[];
}

export interface RequestAnalysis {
  business_model: BusinessModelItem[];
  questions: number[];
  chitchat: number[];
}

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  thinking?: string;
  questionForm?: { state: "generating" | "complete"; content?: string };
  userInput?: { state: "generating" | "complete"; content?: string };
  requestAnalysis?: {
    state: "generating" | "complete";
    content?: string;
    analysis?: RequestAnalysis;
  };
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
  workspaceId: string;
  requestFormId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInfo {
  id: string;
  userId: string;
  name: string;
  storageType?: string | null;
  localPath?: string | null;
  cloudPath?: string | null;
  syncStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountInfo {
  id: string;
  email?: string | null;
  username?: string | null;
  avatar?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PersistedMessageInfo {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  reasoningContent?: string;
  userInput?: Array<{ index: number; content: string; type: string }> | null;
  requestAnalysis?: RequestAnalysis | null;
}
