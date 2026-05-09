import React, { useState, useRef, useEffect, useCallback } from 'react';
import { relativeTime } from '../utils';

interface MessageComposerProps {
  onSend: (text: string) => void;
  replyTo: { reportId: string; reportType: string; timestamp: string } | null;
  onCancelReply: () => void;
}

export default function MessageComposer({ onSend, replyTo, onCancelReply }: MessageComposerProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when reply context is set
  useEffect(() => {
    if (replyTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyTo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSend(text.trim());
        setText('');
      }
    }
  }, [text, onSend]);

  const handleSend = useCallback(() => {
    if (text.trim()) {
      onSend(text.trim());
      setText('');
    }
  }, [text, onSend]);

  return (
    <div className="message-composer">
      {replyTo && (
        <div className="message-composer__reply-indicator">
          <span>Replying to {replyTo.reportType} from {relativeTime(replyTo.timestamp)}</span>
          <button
            className="message-composer__reply-dismiss"
            onClick={onCancelReply}
            aria-label="Cancel reply"
          >
            {'\u2715'}
          </button>
        </div>
      )}
      <div className="message-composer__row">
        <textarea
          ref={textareaRef}
          className="message-composer__input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message your agent... (Enter to send)"
          rows={1}
        />
        <button
          className="message-composer__send"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
