import { ChatMessage } from "../schemas/chat";

export type EventType =
  | "message.created"
  | "message.processed"
  | "agent.thinking"
  | "agent.completed";

export interface MessageCreatedEvent {
  type: "message.created";
  payload: ChatMessage;
}

export interface MessageProcessedEvent {
  type: "message.processed";
  payload: {
    message: ChatMessage;
    response: ChatMessage;
  };
}

export interface AgentThinkingEvent {
  type: "agent.thinking";
  payload: {
    sessionId: string;
    status: "thinking" | "done";
  };
}

export type ChatEvent =
  | MessageCreatedEvent
  | MessageProcessedEvent
  | AgentThinkingEvent;
