import { useState, useRef, useEffect } from 'react';
import Avatar from './Avatar';
import Username from './Username';

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

function preview(m) {
  if (!m) return 'No messages yet';
  if (m.type === 'fit') return 'Shared a fit';
  if (m.type === 'item') return 'Shared an item';
  if (m.type === 'article') return 'Shared an article';
  return m.body || '';
}

function SharedCard({ m }) {
  const p = m.payload || {};
  if (m.type === 'fit') return (
    <div className="chat-card">
      {p.image_url && <img src={p.image_url} alt="" className="chat-card-img" />}
      <div className="chat-card-meta"><span className="chat-card-kicker">FIT</span>{p.fit_name || 'Untitled'}</div>
    </div>
  );
  if (m.type === 'item') return (
    <div className="chat-card">
      {p.image_url && <img src={p.image_url} alt="" className="chat-card-img" />}
      <div className="chat-card-meta"><span className="chat-card-kicker">ITEM</span>{p.name || 'Item'}</div>
    </div>
  );
  if (m.type === 'article') {
    const safeUrl = /^https?:\/\//i.test(p.url || '') ? p.url : null;
    const inner = (
      <>
        {p.image && <img src={p.image} alt="" className="chat-card-img" />}
        <div className="chat-card-meta"><span className="chat-card-kicker">ARTICLE</span>{p.title || p.url || 'Article'}</div>
      </>
    );
    return safeUrl
      ? <a className="chat-card chat-card-link" href={safeUrl} target="_blank" rel="noopener noreferrer">{inner}</a>
      : <div className="chat-card">{inner}</div>;
  }
  return null;
}

export default function ChatPage({ user, chat }) {
  const { conversations, activeId, messages, openConversation, closeConversation, sendMessage } = chat;
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const active = conversations.find(c => c.id === activeId);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    await sendMessage(activeId, { type: 'text', body: t });
  }

  // Thread view
  if (activeId) {
    return (
      <div className="v-screen chat-thread">
        <div className="chat-thread-header">
          <button className="chat-back" onClick={closeConversation}>←</button>
          <Avatar url={active?.other?.avatar_url} size={36} frame={active?.other?.equipped_frame} />
          <div className="chat-thread-who">
            <Username name={active?.other?.username || 'Anonymous'} effect={active?.other?.equipped_name_effect} className="chat-thread-name" />
            <span className="chat-thread-status">{active?.online ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
        </div>
        <div className="chat-messages">
          {messages.length === 0 && <div className="v-empty">Say hi 👋</div>}
          {messages.map(m => (
            <div key={m.id} className={`chat-msg${m.sender_id === user.id ? ' mine' : ''}`}>
              <div className="chat-bubble">
                {m.type === 'text' ? m.body : <SharedCard m={m} />}
                <div className="chat-msg-time">{timeAgo(m.created_at)}</div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="chat-composer">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder="Message…"
            className="chat-input"
          />
          <button className="chat-send" onClick={send} disabled={!text.trim()}>SEND</button>
        </div>
      </div>
    );
  }

  // Conversation list
  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">CHAT</div>
          <div className="v-screen-sub">YOUR MESSAGES</div>
        </div>
      </div>
      <div className="v-body" style={{ padding: '0 36px 24px' }}>
        {conversations.length === 0 && (
          <div className="v-empty">No conversations yet — share a fit or say hi to a friend.</div>
        )}
        {conversations.map(c => (
          <div key={c.id} className="design-people-row" style={{ cursor: 'pointer' }} onClick={() => openConversation(c.otherId)}>
            <div className="chat-avatar-wrap">
              <Avatar url={c.other?.avatar_url} frame={c.other?.equipped_frame} />
              {c.online && <span className="presence-dot online" />}
            </div>
            <div className="design-people-info">
              <div className="design-people-name"><Username name={c.other?.username || 'Anonymous'} effect={c.other?.equipped_name_effect} /></div>
              <div className="chat-preview">{preview(c.lastMessage)}</div>
            </div>
            <div className="chat-row-right">
              <div className="chat-row-time">{timeAgo(c.lastMessageAt)}</div>
              {c.unread > 0 && <span className="chat-unread">{c.unread}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
