import { useChat } from "./hooks/useChat";
import { ChatApp } from "./components/ChatApp";

export default function App() {
  const { messages, isLoading, error, undoAvailable, sendMessage, stopGeneration, undoLastMessage, clearMessages } = useChat();

  return (
    <ChatApp
      messages={messages}
      isLoading={isLoading}
      error={error}
      undoAvailable={undoAvailable}
      onSend={sendMessage}
      onStop={stopGeneration}
      onUndo={undoLastMessage}
      onClear={clearMessages}
    />
  );
}
