import React from 'react';
import type { RelayMessage } from '@harnesstune/shared';
import { relativeTime } from '../utils';

interface ChatBubbleProps {
  message: RelayMessage;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.direction === 'to_agent';

  return (
    <div className={`chat-bubble chat-bubble--${isUser ? 'user' : 'agent'} chat-fade-in`}>
      <div className="chat-bubble__meta">
        <span className="chat-bubble__sender">{isUser ? 'You' : 'Agent'}</span>
        <span className="chat-bubble__time">{relativeTime(message.createdAt)}</span>
      </div>
      <div className="chat-bubble__body">{message.body.text}</div>
    </div>
  );
}
