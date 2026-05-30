import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RelayMessage } from '@harnesstune/shared';
import { relativeTime } from '../utils';

interface ChatBubbleProps {
  message: RelayMessage;
}

// Must match the sentinel emitted by agy strategy in
// packages/harnesstune-agent/src/strategies/agy.ts
const REASONING_SENTINEL = '<!--__HARNESSTUNE_REASONING__-->';

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.direction === 'to_agent';
  const text = message.body.text ?? '';

  // Agent text may carry an embedded reasoning section. Split it off so we can
  // render the final answer plainly and tuck reasoning behind a <details>.
  let answerText = text;
  let reasoningText: string | null = null;
  if (!isUser) {
    const sentinelIdx = text.indexOf(REASONING_SENTINEL);
    if (sentinelIdx !== -1) {
      answerText = text.slice(0, sentinelIdx).trim();
      reasoningText = text.slice(sentinelIdx + REASONING_SENTINEL.length).trim() || null;
    }
  }

  return (
    <div className={`chat-bubble chat-bubble--${isUser ? 'user' : 'agent'} chat-fade-in`}>
      <div className="chat-bubble__meta">
        <span className="chat-bubble__sender">{isUser ? 'You' : 'Agent'}</span>
        <span className="chat-bubble__time">{relativeTime(message.createdAt)}</span>
      </div>
      <div className="chat-bubble__body">
        {isUser ? (
          // User text is exactly what they typed — render literally, no markdown
          // parsing. Agents send rich markdown; users typically don't.
          text
        ) : (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answerText}</ReactMarkdown>
            {reasoningText && (
              <details className="chat-bubble__reasoning">
                <summary>Reasoning</summary>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningText}</ReactMarkdown>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
