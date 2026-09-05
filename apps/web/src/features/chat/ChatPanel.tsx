import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessage, type ChatMessageData } from './ChatMessage';

const defaultPrompt: ChatMessageData = { id: 'welcome', role: 'assistant', content: '告诉我你想怎么旅行，我会先整理一份可以调整的行程草案。', status: 'sent' };
export function buildAssistantMessage(id: string, content: string): ChatMessageData { return { id, role: 'assistant', content, status: 'pending' }; }
export function retryMessage(message: ChatMessageData, content: string): ChatMessageData { return { ...message, content, status: 'sent' }; }

export type ChatSubmit = (content: string, clientMessageId: string) => Promise<string | void> | string | void;

export function ChatPanel({ initialMessages, onSubmit, onUndo, changeSummary, draftRequest }: { initialMessages?: ChatMessageData[]; onSubmit?: ChatSubmit; onUndo?: () => Promise<void> | void; changeSummary?: string; draftRequest?: { content: string } }) {
  const [messages, setMessages] = useState<ChatMessageData[]>(initialMessages?.length ? initialMessages : [defaultPrompt]);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [lastFailed, setLastFailed] = useState<string>();
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!draftRequest) return;
    setValue(draftRequest.content);
    composer.current?.focus();
  }, [draftRequest]);
  useEffect(() => { if (initialMessages?.length) setMessages(initialMessages); }, [initialMessages]);
  const displayMessages = useMemo(() => messages.filter(message => message.id !== lastFailed || message.status === 'failed'), [messages, lastFailed]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = value.trim();
    if (!content || sending) return;
    const id = crypto.randomUUID();
    setValue(''); setSending(true); setLastFailed(undefined);
    setMessages(current => [...current, { id, role: 'user', content, status: 'sent' }, buildAssistantMessage(`${id}-assistant`, '正在生成规划…')]);
    try {
      if (!onSubmit) throw new Error('chat action unavailable');
      const assistantContent = await onSubmit(content, id);
      if (assistantContent) setMessages(current => current.map(message => message.id === `${id}-assistant` ? retryMessage(message, assistantContent) : message));
    }
    catch { setLastFailed(id); setMessages(current => current.filter(message => message.id !== `${id}-assistant`).map(message => message.id === id ? { ...message, status: 'failed' } : message)); }
    finally { setSending(false); }
  }

  async function retry(messageId = lastFailed) {
    if (sending) return;
    const failed = messages.find(message => message.id === messageId);
    if (!failed) return;
    setSending(true); setLastFailed(undefined); setMessages(current => [...current.map(message => message.id === failed.id ? { ...message, status: 'sent' as const } : message), buildAssistantMessage(`${failed.id}-assistant-retry`, '正在生成规划…')]);
    try {
      if (!onSubmit) throw new Error('chat action unavailable');
      const assistantContent = await onSubmit(failed.content, failed.id);
      if (assistantContent) setMessages(current => current.map(message => message.id === `${failed.id}-assistant-retry` ? retryMessage(message, assistantContent) : message));
    }
    catch { setLastFailed(failed.id); setMessages(current => current.filter(message => message.id !== `${failed.id}-assistant-retry`).map(message => message.id === failed.id ? { ...message, status: 'failed' } : message)); }
    finally { setSending(false); }
  }

  return <section className="chat-panel section-block" aria-labelledby="chat-title">
    <div className="section-heading"><div><span className="eyebrow">CHAT-FIRST PLANNING</span><h2 id="chat-title">和旅行助手聊聊</h2></div><span className="status-badge status-running">规划模式</span></div>
    <p className="chat-prompt">例如：10月去杭州玩4天，节奏轻松，预算每人3000元</p>
    <div className="chat-thread" aria-live="polite">{displayMessages.map(message => <ChatMessage key={message.id} message={message} onRetry={message.status === 'failed' ? () => void retry(message.id) : undefined} />)}</div>
    {changeSummary && <div className="chat-change-summary" data-testid="change-summary"><strong>刚刚的调整</strong><span>{changeSummary}</span>{onUndo && <button type="button" onClick={() => void onUndo()}>撤销</button>}</div>}
    <form className="chat-composer" onSubmit={submit}><label htmlFor="chat-input">你的想法</label><div><textarea ref={composer} id="chat-input" aria-label="你的想法" rows={1} value={value} onChange={event => setValue(event.target.value)} placeholder="例如：帮我规划上海三日游…" /><button type="submit" aria-label={sending ? '整理中' : '发送'} disabled={sending || !value.trim()}>{sending ? '整理中…' : <svg className="send-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>}</button></div></form>
  </section>;
}
