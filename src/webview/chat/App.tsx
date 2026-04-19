import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { HostToWebviewMessage } from '../../types/messages';
import type { ChatMessage, SessionState } from '../../session';
import vscode from './vscodeApi';

// ── Simple markdown → React elements (no dangerouslySetInnerHTML) ──────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    // Fenced code block
    const fenceMatch = lines[i].match(/^```(\w*)/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const codeText = codeLines.join('\n');
      result.push(
        <div key={result.length} className="chat-code-block">
          <div className="chat-code-header">
            <span className="chat-code-lang">{lang}</span>
            <CodeCopyButton text={codeText} />
          </div>
          <pre><code>{codeText}</code></pre>
        </div>,
      );
      continue;
    }

    // Heading
    const headingMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      result.push(<Tag key={result.length} className="chat-heading">{renderInline(headingMatch[2])}</Tag>);
      i++;
      continue;
    }

    // Unordered list item
    if (lines[i].match(/^\s*[-*]\s+/)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>);
        i++;
      }
      result.push(<ul key={result.length} className="chat-list">{items}</ul>);
      continue;
    }

    // Ordered list item
    if (lines[i].match(/^\s*\d+\.\s+/)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>);
        i++;
      }
      result.push(<ol key={result.length} className="chat-list">{items}</ol>);
      continue;
    }

    // Empty line → spacer
    if (lines[i].trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    result.push(<p key={result.length} className="chat-paragraph">{renderInline(lines[i])}</p>);
    i++;
  }

  return result;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Regex: inline code, bold, italic (in priority order)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      // Inline code
      parts.push(<code key={parts.length} className="chat-inline-code">{match[1].slice(1, -1)}</code>);
    } else if (match[2]) {
      // Bold
      parts.push(<strong key={parts.length}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      // Italic
      parts.push(<em key={parts.length}>{match[3].slice(1, -1)}</em>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// ── Small components used inside markdown ────────────────────────────────────

function CodeCopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      } else {
        // Fallback for VSCode webview where clipboard API may be unavailable
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // silently fail
    }
  }, [text]);
  return (
    <button className="chat-copy-btn" onClick={handleCopy} title="Copy code">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App(): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [inputValue, setInputValue] = useState('');
  const [workspaceName, setWorkspaceName] = useState<string | undefined>();
  const [animateFrom, setAnimateFrom] = useState(-1); // index from which to animate
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Request history on mount
  useEffect(() => {
    vscode.postMessage({ type: 'chat:requestHistory' });
  }, []);

  // Listen for host messages
  useEffect(() => {
    function handler(event: MessageEvent) {
      const msg = event.data as HostToWebviewMessage;
      switch (msg.type) {
        case 'chat:message':
          setMessages(prev => {
            setAnimateFrom(prev.length); // animate only the new message
            return [...prev, msg.message];
          });
          break;
        case 'chat:stateChange':
          setSessionState(msg.state);
          break;
        case 'chat:history':
          setAnimateFrom(-1); // no animation on history load
          setMessages(msg.messages);
          break;
        case 'chat:workspaceInfo':
          setWorkspaceName(msg.workspaceName);
          break;
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) { return; }
    if (sessionState === 'starting') { return; }
    vscode.postMessage({ type: 'chat:sendMessage', text });
    setInputValue('');
    inputRef.current?.focus();
  }, [inputValue, sessionState]);

  const handleInterrupt = useCallback(() => {
    vscode.postMessage({ type: 'chat:interrupt' });
  }, []);

  const isThinking = sessionState === 'starting';
  const stateLabel = sessionState === 'idle' ? 'New' : sessionState === 'active' ? 'Ready' : sessionState === 'starting' ? 'Working' : 'Ended';

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && isThinking) {
      handleInterrupt();
    }
  }, [handleSend, isThinking, handleInterrupt]);

  // Window-level Escape listener (textarea is disabled during thinking, so onKeyDown won't fire)
  useEffect(() => {
    if (!isThinking) { return; }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleInterrupt();
      }
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [isThinking, handleInterrupt]);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) { return; }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [inputValue]);

  return (
    <div className="chat-root">
      {workspaceName && (
        <div className="chat-header">
          <span className="chat-header-name">{workspaceName}</span>
          <span className={`chat-header-state chat-state-${sessionState}`}>{stateLabel}</span>
        </div>
      )}
      <div className="chat-messages">
        {messages.length === 0 && !workspaceName && (
          <div className="chat-empty">
            <p>Open a workspace to start chatting.</p>
          </div>
        )}
        {messages.length === 0 && workspaceName && (
          <div className="chat-empty">
            <p>Type a message to start a Claude Code session.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} animate={i >= animateFrom && animateFrom >= 0} />
        ))}
        {isThinking && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        {isThinking && (
          <button className="chat-interrupt-btn" onClick={handleInterrupt} title="Interrupt (Ctrl+C)">
            Stop
          </button>
        )}
        <textarea
          ref={inputRef}
          className="chat-input"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isThinking ? 'Working... (Esc to stop)' : 'Message (Enter to send)'}
          disabled={isThinking}
          rows={1}
          autoFocus
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={isThinking || !inputValue.trim()}
          title="Send (Enter)"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── Components ─────────────────────────────────────────────────────────────

function TypingIndicator(): React.ReactElement {
  return (
    <div className="chat-msg chat-msg-typing">
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
    </div>
  );
}

function MessageBubble({ message, animate }: { message: ChatMessage; animate: boolean }): React.ReactElement {
  const roleClass = `chat-msg chat-msg-${message.role}${animate ? ' chat-msg-animate' : ''}`;

  if (message.role === 'tool') {
    return (
      <div className={roleClass}>
        <span className="chat-tool-icon">&#9881;</span>
        <span className="chat-tool-name">{message.toolName}</span>
        <span className="chat-tool-summary">{message.content}</span>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className={roleClass}>
        <span className="chat-error-text">{message.content}</span>
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className={roleClass}>
        <span className="chat-system-text">{message.content}</span>
      </div>
    );
  }

  if (message.role === 'assistant') {
    return (
      <div className={roleClass}>
        <span className="chat-role-label">Claude</span>
        <div className="chat-msg-content">{renderMarkdown(message.content)}</div>
      </div>
    );
  }

  // user
  return (
    <div className={roleClass}>
      <span className="chat-role-label">You</span>
      <div className="chat-msg-content">{message.content}</div>
    </div>
  );
}
