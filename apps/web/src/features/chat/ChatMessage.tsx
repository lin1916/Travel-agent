export type ChatMessageStatus = 'sent' | 'pending' | 'failed';
export interface ChatMessageData { id: string; role: 'user' | 'assistant'; content: string; status?: ChatMessageStatus }

export function ChatMessage({ message, onRetry }: { message: ChatMessageData; onRetry?: () => void }) {
  const status = message.status ?? 'sent';
  return <article className={`chat-message chat-message--${message.role}`} data-testid={`chat-message-${message.role}`}>
    <div className="chat-message__role">{message.role === 'user' ? '你' : '旅行助手'}</div>
    <div className="chat-message__body"><p>{message.content}</p>{status === 'pending' && <span className="chat-message__status">正在整理…</span>}{status === 'failed' && <div className="chat-message__failed"><span>发送失败</span>{onRetry && <button type="button" onClick={onRetry}>重试本轮</button>}</div>}</div>
  </article>;
}
