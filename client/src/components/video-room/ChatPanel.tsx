import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../types/videoRoom';

interface ChatPanelProps {
  isVisible: boolean;
  messages: ChatMessage[];
  newMessage: string;
  onMessageChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
}

const ChatPanel = ({
  isVisible,
  messages,
  newMessage,
  onMessageChange,
  onSend,
  onClose,
}: ChatPanelProps) => {
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  if (!isVisible) return null;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Chat</h3>
        <button onClick={onClose}>❌</button>
      </div>
      <div className="chat-messages" ref={chatContainerRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="chat-message">
              <span className="message-author">{message.userName}:</span>
              <span className="message-content">{message.message}</span>
              <span className="message-time">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => onMessageChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend()}
          placeholder="Type a message..."
          maxLength={500}
        />
        <button onClick={onSend} disabled={!newMessage.trim()}>
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatPanel;
