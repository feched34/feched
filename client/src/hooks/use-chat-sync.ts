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
  onHistoryReceived?: (messages: ChatMessage[]) => void;
}

export function useChatSync({ roomId, userId, userName, userAvatar, onMessageReceived, onHistoryReceived }: UseChatSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const maxRetries = 5;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || isConnectingRef.current) return;

    isConnectingRef.current = true;

    // Render.com için WebSocket URL'sini düzelt
    let wsUrl: string;
    
    if (import.meta.env.VITE_SERVER_URL) {
      // Production'da VITE_SERVER_URL kullan
      wsUrl = import.meta.env.VITE_SERVER_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    } else if (window.location.hostname === 'feched.onrender.com') {
      // Render.com'da doğrudan wss kullan - proxy üzerinden
      wsUrl = 'wss://feched.onrender.com';
    } else {
      // Development'ta mevcut origin kullan
      wsUrl = window.location.origin.replace('https://', 'wss://').replace('http://', 'ws://');
    }
    
    // WebSocket path ve token ekle - Render.com için özel format
    const token = Date.now();
    wsUrl += `/ws?token=${token}&roomId=${roomId}&userId=${userId}`;
    
    console.log('💬 Connecting to Chat WebSocket:', wsUrl);
    
    try {
      wsRef.current = new WebSocket(wsUrl);

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CONNECTING) {
          console.log('Chat WebSocket connection timeout');
          wsRef.current.close();
        }
      }, 10000); // 10 saniye timeout

      wsRef.current.onopen = () => {
        console.log('💬 Chat WebSocket connected successfully');
        isConnectingRef.current = false;
        retryCountRef.current = 0; // Başarılı bağlantıda retry sayısını sıfırla
        clearTimeout(connectionTimeout);
        
        // WebSocket'in hazır olduğundan emin ol
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          console.log('💬 Joining chat room:', roomId);
          // Odaya katıl
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
            // Tüm mesajları al - kendi mesajlarımız da görünsün
            console.log('💬 Received chat message from:', message.user.name);
            onMessageReceived(message);
          }
          
          if (data.type === 'chat_history' && onHistoryReceived) {
            console.log('💬 Received chat history:', data.messages.length, 'messages');
            onHistoryReceived(data.messages);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('Chat WebSocket error:', error);
        isConnectingRef.current = false;
        clearTimeout(connectionTimeout);
      };

      wsRef.current.onclose = (event) => {
        console.log('💬 Chat WebSocket disconnected, code:', event.code);
        isConnectingRef.current = false;
        clearTimeout(connectionTimeout);
        
        // Yeniden bağlanma denemesi - sadece manuel kapatma değilse ve zaten bağlanmaya çalışmıyorsa
        if (event.code !== 1000 && !isConnectingRef.current && retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000); // Exponential backoff, max 10s
          
          console.log(`💬 Retrying Chat WebSocket connection in ${retryDelay}ms (attempt ${retryCountRef.current}/${maxRetries})`);
          
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            if (wsRef.current?.readyState !== WebSocket.OPEN && wsRef.current?.readyState !== WebSocket.CONNECTING) {
              connect();
            }
          }, retryDelay);
        }
      };
    } catch (error) {
      console.error('Error creating Chat WebSocket connection:', error);
      isConnectingRef.current = false;
    }
  }, [roomId, userId, onMessageReceived]);

  const sendMessage = useCallback(async (content: string) => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('💬 Sending chat message:', content);
        wsRef.current.send(JSON.stringify({
          type: 'chat_message',
          roomId,
          userId,
          userName,
          userAvatar,
          message: content
        }));
      } else {
        console.error('💬 WebSocket not connected, cannot send message');
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
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    sendMessage,
    loadChatHistory
  };
} 