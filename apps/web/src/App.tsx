import { useChat } from "./hooks/useChat";
import { ChatApp } from "./components/ChatApp";

export default function App() {
  const { messages, isLoading, error, threadId, sendMessage, loadThread, newThread, clearMessages } = useChat();

  return (
    <ChatApp
      messages={messages}
      isLoading={isLoading}
      error={error}
      threadId={threadId}
      onSend={sendMessage}
      onClear={clearMessages}
      onLoadThread={loadThread}
      onNewThread={newThread}
    />
  );
}
