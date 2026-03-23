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

export function useChatSync({ roomId, userId, userName, userAvatar, onMessageReceived, onHistoryReceived }: UseChatSyncOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const maxRetries = 5;

  // Callback'leri ref'te tut - böylece connect fonksiyonu her render'da yeniden oluşmaz
  const onMessageReceivedRef = useRef(onMessageReceived);
  const onHistoryReceivedRef = useRef(onHistoryReceived);

  // Her render'da ref'leri güncelle
  useEffect(() => {
    onMessageReceivedRef.current = onMessageReceived;
  }, [onMessageReceived]);

  useEffect(() => {
    onHistoryReceivedRef.current = onHistoryReceived;
  }, [onHistoryReceived]);

  const connect = useCallback(() => {
    if (eventSourceRef.current?.readyState === EventSource.OPEN || isConnectingRef.current) {
      return;
    }

    isConnectingRef.current = true;

    // SSE URL'sini oluştur
    let sseUrl: string;
    
    if (import.meta.env.VITE_SERVER_URL) {
      sseUrl = import.meta.env.VITE_SERVER_URL;
    } else if (window.location.hostname === 'feched.onrender.com') {
      sseUrl = 'https://feched.onrender.com';
    } else {
      sseUrl = window.location.origin;
    }
    
    sseUrl += `/api/chat/${roomId}/events?userId=${userId}`;
    
    console.log('💬 Connecting to SSE:', sseUrl);
    
    try {
      // Önceki bağlantıyı temizle
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      
      eventSourceRef.current = new EventSource(sseUrl);

      eventSourceRef.current.onopen = () => {
        console.log('💬 SSE connected successfully');
        isConnectingRef.current = false;
        retryCountRef.current = 0;
      };

      eventSourceRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'chat_message') {
            const message: ChatMessage = data.message;
            console.log('💬 Received chat message from:', message.user.name);
            onMessageReceivedRef.current(message);
          }
          
          if (data.type === 'chat_history' && onHistoryReceivedRef.current) {
            console.log('💬 Received chat history:', data.messages.length, 'messages');
            onHistoryReceivedRef.current(data.messages);
          }
          
          if (data.type === 'connected') {
            console.log('💬 SSE connection confirmed for room:', data.roomId);
          }
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      };

      eventSourceRef.current.onerror = () => {
        console.error('💬 SSE error');
        isConnectingRef.current = false;
        
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
          
          console.log(`💬 Retrying SSE connection in ${retryDelay}ms (attempt ${retryCountRef.current}/${maxRetries})`);
          
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            if (eventSourceRef.current?.readyState !== EventSource.OPEN) {
              connect();
            }
          }, retryDelay);
        }
      };

    } catch (error) {
      console.error('Error creating SSE connection:', error);
      isConnectingRef.current = false;
    }
  }, [roomId, userId]); // Artık sadece roomId ve userId'ye bağlı

  const sendMessage = useCallback(async (content: string) => {
    try {
      console.log('💬 Sending message via HTTP POST:', content);
      
      // Server URL'sini belirle
      let serverUrl: string;
      if (import.meta.env.VITE_SERVER_URL) {
        serverUrl = import.meta.env.VITE_SERVER_URL;
      } else if (window.location.hostname === 'feched.onrender.com') {
        serverUrl = 'https://feched.onrender.com';
      } else {
        serverUrl = window.location.origin;
      }
      
      const response = await fetch(`${serverUrl}/api/chat/${roomId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          userId,
          userName,
          userAvatar,
          content,
          messageType: 'text'
        })
      });
      
      if (response.ok) {
        console.log('💬 Message sent successfully');
      } else {
        console.error('💬 Failed to send message:', response.status);
      }
    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  }, [roomId, userId, userName, userAvatar]);

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  return {
    sendMessage,
  };
}