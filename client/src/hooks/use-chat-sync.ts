import { useCallback, useEffect, useRef } from 'react';

interface ChatMessage {
  id: string;
  user: {
    id: string;
    name: string;
    avatar: string;
  };
  content: string;
  time: string;
  type: 'text' | 'image' | 'video';
  mediaUrl?: string;
  emojis?: { emoji: string; count: number; users: string[] }[];
}

interface UseChatSyncOptions {
  roomId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  onMessageReceived: (message: ChatMessage) => void;
  onHistoryReceived?: (messages: ChatMessage[]) => void;
}

function getWsUrl(roomId: string, userId: string): string {
  let base: string;
  if (import.meta.env.VITE_SERVER_URL) {
    // HTTP URL'sini WS'e çevir
    base = import.meta.env.VITE_SERVER_URL
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
  } else if (window.location.hostname === 'feched.onrender.com') {
    base = 'wss://feched.onrender.com';
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    base = `${protocol}//${window.location.host}`;
  }
  return `${base}/ws?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}&type=chat`;
}

export function useChatSync({
  roomId,
  userId,
  userName,
  userAvatar,
  onMessageReceived,
  onHistoryReceived,
}: UseChatSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef<number>(0);
  const isUnmountedRef = useRef<boolean>(false);
  const maxRetries = 8;

  // Callback ref'leri — bağımlılık array'ini temiz tutar
  const onMessageRef = useRef(onMessageReceived);
  const onHistoryRef = useRef(onHistoryReceived);
  useEffect(() => { onMessageRef.current = onMessageReceived; }, [onMessageReceived]);
  useEffect(() => { onHistoryRef.current = onHistoryReceived; }, [onHistoryReceived]);

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    // Eski bağlantıyı temiz kapat
    if (wsRef.current) {
      wsRef.current.onclose = null; // reconnect loop'u engelle
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = getWsUrl(roomId, userId);
    console.log('💬 Chat WS connecting:', wsUrl);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('💬 Cannot create WebSocket:', err);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      console.log('💬 Chat WS connected');
      retryCountRef.current = 0;
      // join_room mesajı gönder — history ve state'i al
      ws.send(JSON.stringify({
        type: 'join_room',
        roomId,
        userId,
        userName,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'chat_message') {
          onMessageRef.current(data.message as ChatMessage);
        }

        if (data.type === 'chat_history' && onHistoryRef.current) {
          console.log('💬 Received chat history:', data.messages?.length, 'messages');
          onHistoryRef.current(data.messages as ChatMessage[]);
        }
        // pong / diğer mesajları yoksay
      } catch (err) {
        console.error('💬 WS message parse error:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('💬 Chat WS error:', err);
    };

    ws.onclose = (event) => {
      if (isUnmountedRef.current) return;
      console.warn('💬 Chat WS closed:', event.code, event.reason);

      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 15000);
        console.log(`💬 Retrying WS in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, [roomId, userId, userName]);

  const sendMessage = useCallback(async (content: string) => {
    // Önce WebSocket üzerinden dene (anlık)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat_message',
        roomId,
        userId,
        userName,
        userAvatar,
        message: content,
      }));
      return;
    }

    // Fallback: HTTP POST
    try {
      let serverUrl: string;
      if (import.meta.env.VITE_SERVER_URL) {
        serverUrl = import.meta.env.VITE_SERVER_URL;
      } else if (window.location.hostname === 'feched.onrender.com') {
        serverUrl = 'https://feched.onrender.com';
      } else {
        serverUrl = window.location.origin;
      }

      await fetch(`${serverUrl}/api/chat/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId, userName, userAvatar, content, messageType: 'text' }),
      });
    } catch (err) {
      console.error('💬 Failed to send message via HTTP fallback:', err);
    }
  }, [roomId, userId, userName, userAvatar]);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { sendMessage };
}