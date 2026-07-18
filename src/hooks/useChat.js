import { useState, useEffect, useCallback, useRef } from 'react';
import { sb } from '../lib/supabase';

const ONLINE_MS = 120 * 1000;

const otherOf  = (c, uid) => (c.user_low === uid ? c.user_high : c.user_low);
const myReadOf = (c, uid) => (c.user_low === uid ? c.low_last_read : c.high_last_read);

// 1:1 chat: conversation list, active thread, send/read, unread, Realtime.
export function useChat(user) {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId]           = useState(null);
  const [messages, setMessages]           = useState([]);
  const activeRef = useRef(null);
  useEffect(() => { activeRef.current = activeId; }, [activeId]);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data: convs } = await sb.from('conversations')
      .select('*').order('last_message_at', { ascending: false });
    if (!convs || convs.length === 0) { setConversations([]); return; }
    const ids = convs.map(c => c.id);
    const otherIds = convs.map(c => otherOf(c, user.id));
    const [{ data: profs }, { data: msgs }] = await Promise.all([
      sb.from('profiles').select('id, username, avatar_url, equipped_frame, equipped_name_effect, last_active').in('id', otherIds),
      sb.from('messages').select('id, conversation_id, sender_id, type, body, payload, created_at').in('conversation_id', ids).order('created_at', { ascending: false }).limit(400),
    ]);
    const pm = Object.fromEntries((profs || []).map(p => [p.id, p]));
    const last = {}; const unread = {};
    for (const m of (msgs || [])) {
      if (!last[m.conversation_id]) last[m.conversation_id] = m;
    }
    for (const c of convs) {
      const read = myReadOf(c, user.id);
      unread[c.id] = (msgs || []).filter(m =>
        m.conversation_id === c.id && m.sender_id !== user.id &&
        (!read || new Date(m.created_at) > new Date(read))).length;
    }
    const now = Date.now();
    setConversations(convs.map(c => {
      const p = pm[otherOf(c, user.id)] || null;
      return {
        id: c.id, other: p, otherId: otherOf(c, user.id),
        lastMessage: last[c.id] || null,
        unread: unread[c.id] || 0,
        online: !!p?.last_active && now - new Date(p.last_active).getTime() < ONLINE_MS,
        lastMessageAt: c.last_message_at,
      };
    }));
  }, [user]);

  const markRead = useCallback(async (convId) => {
    await sb.rpc('mark_conversation_read', { p_conversation: convId });
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, unread: 0 } : c));
  }, []);

  const openConversation = useCallback(async (otherId) => {
    if (!user) return;
    const { data: convId, error } = await sb.rpc('get_or_create_conversation', { p_other: otherId });
    if (error) { console.error(error); return; }
    setActiveId(convId);
    const { data: msgs } = await sb.from('messages')
      .select('*').eq('conversation_id', convId).order('created_at', { ascending: true });
    setMessages(msgs || []);
    markRead(convId);
    return convId;
  }, [user, markRead]);

  const closeConversation = useCallback(() => { setActiveId(null); setMessages([]); loadConversations(); }, [loadConversations]);

  const sendMessage = useCallback(async (convId, { type = 'text', body = null, payload = null }) => {
    if (!user) return;
    const { data, error } = await sb.from('messages')
      .insert({ conversation_id: convId, sender_id: user.id, type, body, payload }).select().single();
    if (error) { console.error(error); return { error }; }
    setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]);
    return { data };
  }, [user]);

  useEffect(() => {
    if (!user) { setConversations([]); setActiveId(null); setMessages([]); return; }
    loadConversations();
    const ch = sb.channel('messages-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new;
        if (m.conversation_id === activeRef.current) {
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
          if (m.sender_id !== user.id) markRead(m.conversation_id);
        }
        loadConversations();
      })
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [user, loadConversations, markRead]);

  const totalUnread = conversations.reduce((s, c) => s + c.unread, 0);

  return { conversations, activeId, messages, openConversation, closeConversation, sendMessage, markRead, totalUnread };
}
