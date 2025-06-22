import { useCallback, useRef, useEffect } from 'react';
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
}

export function useChatSync({ roomId, userId, userName, userAvatar, onMessageReceived }: UseChatSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}?token=${Date.now()}`;
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('Chat WebSocket connected');
        // Odaya katıl
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'join_room',
            roomId
          }));
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'chat_message') {
            const message: ChatMessage = data.message;
            // Kendi gönderdiğimiz mesajları işleme
            if (message.user.id === userId) return;
            onMessageReceived(message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('Chat WebSocket error:', error);
      };

      wsRef.current.onclose = () => {
        console.log('Chat WebSocket disconnected');
        // Yeniden bağlanma denemesi
        setTimeout(() => {
          if (wsRef.current?.readyState !== WebSocket.OPEN && wsRef.current?.readyState !== WebSocket.CONNECTING) {
            connect();
          }
        }, 3000);
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [roomId, userId, onMessageReceived]);

  const sendMessage = useCallback(async (content: string) => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'chat_message',
          roomId,
          userId,
          userName,
          userAvatar,
          message: content
        }));
      }
    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  }, [roomId, userId, userName, userAvatar]);

  useEffect(() => {
    connect();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    sendMessage
  };
} 