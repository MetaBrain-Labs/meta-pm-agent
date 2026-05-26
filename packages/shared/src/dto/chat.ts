import type { ChatMessage, ChatSession } from "../types/chat";

export interface CreateMessageDTO {
  content: string;
  sessionId: string;
}

export interface ChatResponseDTO {
  message: ChatMessage;
  session: ChatSession;
}

export interface PaginationDTO {
  page: number;
  pageSize: number;
}

export interface PaginatedResponseDTO<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
