import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Plus, Send, Settings2, ShieldCheck, Wifi, WifiOff, X, CheckCheck } from 'lucide-react';
import { checkInstance, deleteNotification, receiveNotification, sendText, type GreenConfig } from './api';

type Message = { id: string; text: string; direction: 'out' | 'in'; time: number; status?: string };
type Chat = { id: string; phone: string; title: string; messages: Message[]; updatedAt: number };

const CONFIG_KEY = 'max-green-api-config-v1';
const CHATS_KEY = 'max-green-api-chats-v1';
const DEFAULT_URL = 'https://api.green-api.com';

function readJson<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}
function clock(value: number) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(value);
}
function initials(name: string) {
  return name.replace(/\D/g, '').slice(-2) || name.slice(0, 2).toUpperCase();
}

export default function App() {
  const [config, setConfig] = useState<GreenConfig>(() => readJson(CONFIG_KEY, {
    apiUrl: DEFAULT_URL, idInstance: '', apiTokenInstance: '',
  }));
  const [chats, setChats] = useState<Chat[]>(() => readJson(CHATS_KEY, []));
  const [activeId, setActiveId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChat = useMemo(() => chats.find(chat => chat.id === activeId), [chats, activeId]);

  useEffect(() => { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }, [config]);
  useEffect(() => { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); }, [chats]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeChat?.messages.length]);

  const updateChat = useCallback((chatId: string, updater: (chat: Chat) => Chat) => {
    setChats(current => current.map(chat => chat.id === chatId ? updater(chat) : chat));
  }, []);

  const connect = async () => {
    if (!config.idInstance.trim() || !config.apiTokenInstance.trim() || !config.apiUrl.trim()) {
      setError('Заполните API URL, idInstance и apiTokenInstance.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      await checkInstance(config);
      setConnected(true);
      setSettingsOpen(false);
      setNotice('Подключение к GREEN-API проверено.');
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Не удалось подключиться. Проверьте настройки инстанса.');
    } finally { setBusy(false); }
  };

  const createChat = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = phone.trim().replace(/[^\d+]/g, '');
    if (normalized.replace(/\D/g, '').length < 5) {
      setError('Введите корректный номер телефона или ID чата.');
      return;
    }
    const existing = chats.find(chat => chat.phone === normalized);
    if (existing) {
      setActiveId(existing.id); setNewChatOpen(false); setPhone(''); setError('');
      return;
    }
    const chat: Chat = {
      id: normalized, phone: normalized, title: normalized, messages: [], updatedAt: Date.now(),
    };
    setChats(current => [chat, ...current]);
    setActiveId(chat.id); setNewChatOpen(false); setPhone(''); setError('');
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeChat || !draft.trim() || busy) return;
    if (!connected) {
      setError('Сначала подключитесь к GREEN-API через настройки.');
      setSettingsOpen(true);
      return;
    }
    const text = draft.trim();
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await sendText(config, activeChat.id, text);
      const message: Message = {
        id: result.idMessage || crypto.randomUUID(), text, direction: 'out',
        time: Date.now(), status: 'Отправлено в API',
      };
      updateChat(activeChat.id, chat => ({ ...chat, messages: [...chat.messages, message], updatedAt: Date.now() }));
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить сообщение.');
    } finally { setBusy(false); }
  };

  // GREEN-API HTTP API notifications are polled and deleted after processing.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const seen = new Set<string>();
    const poll = async () => {
      try {
        const notification = await receiveNotification(config);
        if (cancelled || !notification || typeof notification.receiptId !== 'number') return;
        const body = notification.body;
        const type = body?.typeWebhook || '';
        const chatId = body?.senderData?.chatId || body?.senderData?.sender || '';
        const text = body?.messageData?.textMessageData?.textMessage
          || body?.messageData?.extendedTextMessageData?.text
          || body?.message
          || '';
        if (type.toLowerCase().includes('incoming') && text && chatId && !seen.has(String(notification.receiptId))) {
          seen.add(String(notification.receiptId));
          const normalized = chatId;
          setChats(current => {
            const index = current.findIndex(chat => chat.id === normalized || chat.phone === normalized);
            const incoming: Message = {
              id: `in-${notification.receiptId}`, text, direction: 'in', time: Date.now(),
            };
            if (index >= 0) {
              return current.map((chat, i) => i === index
                ? { ...chat, messages: [...chat.messages, incoming], updatedAt: Date.now() } : chat);
            }
            const newChat: Chat = {
              id: normalized, phone: normalized,
              title: body?.senderData?.senderName || normalized,
              messages: [incoming], updatedAt: Date.now(),
            };
            return [newChat, ...current];
          });
        }
        await deleteNotification(config, notification.receiptId);
      } catch {
        // Keep the UI quiet during temporary network errors; polling retries automatically.
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [connected, config, updateChat]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><MessageCircle size={22} /></div>
          <div><strong>MAX Messenger</strong><span>GREEN-API client</span></div>
        </div>
        <button className="new-chat" onClick={() => { setNewChatOpen(true); setError(''); }}>
          <Plus size={18} /> Новый чат
        </button>
        <div className="sidebar-label">СООБЩЕНИЯ <span>{chats.length}</span></div>
        <div className="chat-list">
          {chats.length === 0 && <div className="empty-list">Здесь появятся ваши чаты. Создайте новый, чтобы начать переписку.</div>}
          {chats.map(chat => {
            const last = chat.messages[chat.messages.length - 1];
            return <button key={chat.id} className={`chat-item ${activeId === chat.id ? 'selected' : ''}`} onClick={() => { setActiveId(chat.id); setError(''); }}>
              <div className="avatar">{initials(chat.title)}</div>
              <div className="chat-summary">
                <div className="chat-line"><strong>{chat.title}</strong><time>{last ? clock(last.time) : ''}</time></div>
                <p>{last?.text || 'Начните переписку'}</p>
              </div>
            </button>;
          })}
        </div>
        <div className="sidebar-bottom">
          <div className={`connection-dot ${connected ? 'online' : ''}`} />
          <span>{connected ? 'GREEN-API подключён' : 'Нет подключения'}</span>
          <button className="icon-button" aria-label="Настройки" onClick={() => setSettingsOpen(v => !v)}><Settings2 size={18} /></button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title">
            {activeChat ? <><div className="avatar small">{initials(activeChat.title)}</div><div><strong>{activeChat.title}</strong><span>{activeChat.phone}</span></div></> : <div><strong>Ваши сообщения</strong><span>Простой клиент для MAX</span></div>}
          </div>
          <div className={`status-pill ${connected ? 'is-online' : ''}`}>{connected ? <Wifi size={15} /> : <WifiOff size={15} />}{connected ? 'Подключено' : 'Не подключено'}</div>
        </header>

        {settingsOpen && <section className="settings-card">
          <div className="section-heading"><div><span className="eyebrow">НАСТРОЙКИ ИНТЕГРАЦИИ</span><h2>Подключение GREEN-API</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть"><X size={18} /></button></div>
          <p className="muted">Укажите данные инстанса из личного кабинета GREEN-API.</p>
          <div className="settings-grid">
            <label>API URL<input value={config.apiUrl} onChange={e => setConfig(c => ({ ...c, apiUrl: e.target.value }))} placeholder="https://api.green-api.com" /></label>
            <label>ID инстанса<input value={config.idInstance} onChange={e => setConfig(c => ({ ...c, idInstance: e.target.value }))} placeholder="Например, 7100000000" /></label>
            <label className="token-field">API Token<input type="password" autoComplete="off" value={config.apiTokenInstance} onChange={e => setConfig(c => ({ ...c, apiTokenInstance: e.target.value }))} placeholder="Вставьте токен инстанса" /></label>
          </div>
          <div className="settings-actions"><span><ShieldCheck size={15} /> Данные хранятся локально в этом браузере</span><button className="primary-button" onClick={connect} disabled={busy}>{busy ? 'Проверяем…' : 'Проверить подключение'}</button></div>
        </section>}

        {notice && <div className="notice">{notice}<button onClick={() => setNotice('')} aria-label="Закрыть"><X size={15} /></button></div>}
        {error && <div className="error-banner">{error}<button onClick={() => setError('')} aria-label="Закрыть"><X size={15} /></button></div>}

        {activeChat ? <section className="conversation">
          <div className="messages">
            {activeChat.messages.length === 0 ? <div className="welcome-state"><div className="welcome-icon"><MessageCircle size={28} /></div><h2>Начните переписку</h2><p>Напишите первое текстовое сообщение для <strong>{activeChat.title}</strong>.</p></div> :
              activeChat.messages.map(message => <div key={message.id} className={`message-row ${message.direction === 'out' ? 'outgoing' : 'incoming'}`}>
                <div className="bubble"><p>{message.text}</p><div className="message-meta"><time>{clock(message.time)}</time>{message.direction === 'out' && <CheckCheck size={14} />}</div></div>
              </div>)}
            <div ref={bottomRef} />
          </div>
          <form className="composer" onSubmit={send}>
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Напишите сообщение…" aria-label="Текст сообщения" maxLength={4000} />
            <span className="char-count">{draft.length}/4000</span>
            <button className="send-button" type="submit" disabled={!draft.trim() || busy} aria-label="Отправить"><Send size={18} /></button>
          </form>
          <div className="composer-hint">Только текстовые сообщения · Максимум 4000 символов</div>
        </section> : <section className="empty-main">
          <div className="empty-illustration"><MessageCircle size={34} /></div><h1>Всё важное — в одном месте</h1><p>Создайте чат по номеру телефона или ID чата MAX, чтобы отправить сообщение.</p><button className="primary-button" onClick={() => setNewChatOpen(true)}><Plus size={17} /> Создать чат</button>
        </section>}
      </main>

      {newChatOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setNewChatOpen(false); }}>
        <form className="modal" onSubmit={createChat}>
          <div className="section-heading"><div><span className="eyebrow">НОВАЯ ПЕРЕПИСКА</span><h2>Создать чат</h2></div><button type="button" className="icon-button" onClick={() => setNewChatOpen(false)} aria-label="Закрыть"><X size={18} /></button></div>
          <label>Номер телефона или ID чата<input autoFocus value={phone} onChange={e => setPhone(e.target.value)} placeholder="Например, 79991234567" /></label>
          <p className="muted small-note">Укажите идентификатор в формате, который поддерживает ваш инстанс MAX в GREEN-API.</p>
          <button className="primary-button full-width" type="submit"><Plus size={17} /> Открыть чат</button>
        </form>
      </div>}
      <div className="footer-note">Сделано на React · GREEN-API</div>
    </div>
  );
}