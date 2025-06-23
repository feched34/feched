import { useCallback, useEffect, useRef } from 'react';
import { apiRequest } from '@/lib/queryClient';

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
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const maxRetries = 5;

  const connect = useCallback(() => {
    if (eventSourceRef.current?.readyState === EventSource.OPEN || isConnectingRef.current) {
      console.log('💬 Already connected or connecting, skipping...');
      return;
    }

    isConnectingRef.current = true;
    console.log('💬 Starting SSE connection...');

    // SSE URL'sini oluştur
    let sseUrl: string;
    
    if (import.meta.env.VITE_SERVER_URL) {
      // Production'da VITE_SERVER_URL kullan
      sseUrl = import.meta.env.VITE_SERVER_URL;
    } else if (window.location.hostname === 'feched.onrender.com') {
      // Render.com'da doğrudan kullan
      sseUrl = 'https://feched.onrender.com';
    } else {
      // Development'ta mevcut origin kullan
      sseUrl = window.location.origin;
    }
    
    // SSE endpoint'i ekle
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
        retryCountRef.current = 0; // Başarılı bağlantıda retry sayısını sıfırla
      };

      eventSourceRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'chat_message') {
            const message: ChatMessage = data.message;
            console.log('💬 Received chat message from:', message.user.name);
            onMessageReceived(message);
          }
          
          if (data.type === 'chat_history' && onHistoryReceived) {
            console.log('💬 Received chat history:', data.messages.length, 'messages');
            onHistoryReceived(data.messages);
          }
          
          if (data.type === 'connected') {
            console.log('💬 SSE connection confirmed for room:', data.roomId);
          }
          
          if (data.type === 'ping') {
            console.log('💬 SSE ping received:', data.timestamp);
          }
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      };

      eventSourceRef.current.onerror = (error) => {
        console.error('💬 SSE error:', error);
        isConnectingRef.current = false;
      };

    } catch (error) {
      console.error('Error creating SSE connection:', error);
      isConnectingRef.current = false;
    }
  }, [roomId, userId, onMessageReceived, onHistoryReceived]);

  const sendMessage = useCallback(async (content: string) => {
    try {
      console.log('💬 Sending message via HTTP POST:', content);
      
      const response = await fetch(`/api/chat/${roomId}/messages`, {
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

  const loadChatHistory = useCallback(async () => {
    try {
      const response = await apiRequest('GET', `/api/chat/${roomId}/messages?limit=50`);
      if (response && Array.isArray(response)) {
        const formattedMessages: ChatMessage[] = response.map((msg: any) => ({
          id: 'm' + msg.id,
          user: {
            id: msg.userId,
            name: msg.userName,
            avatar: msg.userAvatar || '/logo.png'
          },
          content: msg.content,
          time: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: msg.messageType as 'text' | 'image' | 'video',
          mediaUrl: msg.mediaUrl
        }));
        
        if (onHistoryReceived) {
          onHistoryReceived(formattedMessages);
        }
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  }, [roomId, onHistoryReceived]);

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
    loadChatHistory
  };
} 