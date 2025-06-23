import { useEffect, useRef, useCallback } from 'react';
import { apiRequest } from '../lib/queryClient';

interface MusicControlMessage {
  type: 'play' | 'pause' | 'add_to_queue' | 'shuffle' | 'repeat';
  videoId?: string;
  userId: string;
  timestamp: number;
  song?: any;
  isShuffled?: boolean;
  repeatMode?: string;
}

interface UseMusicSyncOptions {
  roomId: string;
  userId: string;
  onPlay?: (videoId: string, userId: string) => void;
  onPause?: (userId: string) => void;
  onAddToQueue?: (song: any, userId: string) => void;
  onShuffle?: (isShuffled: boolean, userId: string) => void;
  onRepeat?: (repeatMode: string, userId: string) => void;
  onStateUpdate?: (state: any) => void;
}

export function useMusicSync({ roomId, userId, onPlay, onPause, onAddToQueue, onShuffle, onRepeat, onStateUpdate }: UseMusicSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastStateUpdateRef = useRef<number>(0);
  const isConnectingRef = useRef<boolean>(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
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
      // Render.com'da doğrudan wss kullan
      wsUrl = 'wss://feched.onrender.com';
    } else {
      // Development'ta mevcut origin kullan
      wsUrl = window.location.origin.replace('https://', 'wss://').replace('http://', 'ws://');
    }
    
    // WebSocket path ve token ekle
    wsUrl += `/ws?token=${Date.now()}`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    
    try {
      wsRef.current = new WebSocket(wsUrl);

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CONNECTING) {
          console.log('WebSocket connection timeout');
          wsRef.current.close();
        }
      }, 10000); // 10 saniye timeout

      wsRef.current.onopen = () => {
        console.log('Music sync WebSocket connected');
        isConnectingRef.current = false;
        retryCountRef.current = 0; // Başarılı bağlantıda retry sayısını sıfırla
        clearTimeout(connectionTimeout);
        
        // WebSocket'in hazır olduğundan emin ol
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Odaya katıl
          wsRef.current.send(JSON.stringify({
            type: 'join_room',
            roomId
          }));
          
          // Heartbeat başlat
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
          }
          heartbeatIntervalRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'ping' }));
            }
          }, 25000); // 25 saniyede bir ping
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Pong mesajını işle
          if (data.type === 'pong') {
            return;
          }
          
          // Müzik state broadcast mesajını dinle
          if (data.type === 'music_state_broadcast' && onStateUpdate) {
            console.log('Received music state broadcast:', data.state);
            onStateUpdate(data.state);
            return;
          }
          
          if (data.type === 'music_control') {
            const message: MusicControlMessage = data;
            
            // Kendi gönderdiğimiz mesajları işleme
            if (message.userId === userId) return;
            
            console.log('Received music control:', message);
            
            switch (message.type) {
              case 'play':
                if (message.videoId && onPlay) {
                  onPlay(message.videoId, message.userId);
                }
                break;
              case 'pause':
                if (onPause) {
                  onPause(message.userId);
                }
                break;
              case 'add_to_queue':
                if (message.song && onAddToQueue) {
                  onAddToQueue(message.song, message.userId);
                }
                break;
              case 'shuffle':
                if (typeof message.isShuffled === 'boolean' && onShuffle) {
                  onShuffle(message.isShuffled, message.userId);
                }
                break;
              case 'repeat':
                if (message.repeatMode && onRepeat) {
                  onRepeat(message.repeatMode, message.userId);
                }
                break;
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('Music sync WebSocket error:', error);
        isConnectingRef.current = false;
        clearTimeout(connectionTimeout);
      };

      wsRef.current.onclose = (event) => {
        console.log('Music sync WebSocket disconnected, code:', event.code);
        isConnectingRef.current = false;
        clearTimeout(connectionTimeout);
        
        // Heartbeat'i durdur
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        
        // Yeniden bağlanma denemesi - sadece manuel kapatma değilse ve zaten bağlanmaya çalışmıyorsa
        if (event.code !== 1000 && !isConnectingRef.current && retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000); // Exponential backoff, max 10s
          
          console.log(`Retrying WebSocket connection in ${retryDelay}ms (attempt ${retryCountRef.current}/${maxRetries})`);
          
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
      console.error('Error creating WebSocket connection:', error);
      isConnectingRef.current = false;
    }
  }, [roomId, userId, onPlay, onPause, onAddToQueue, onShuffle, onRepeat, onStateUpdate]);

  const sendPlayCommand = useCallback(async (videoId: string) => {
    try {
      await apiRequest('POST', '/api/music/play', { roomId, videoId, userId });
    } catch (error) {
      console.error('Error sending play command:', error);
    }
  }, [roomId, userId]);

  const sendPauseCommand = useCallback(async () => {
    try {
      await apiRequest('POST', '/api/music/pause', { roomId, userId });
    } catch (error) {
      console.error('Error sending pause command:', error);
    }
  }, [roomId, userId]);

  const sendAddToQueueCommand = useCallback(async (song: any) => {
    try {
      await apiRequest('POST', '/api/music/queue', { roomId, song, userId });
    } catch (error) {
      console.error('Error sending add to queue command:', error);
    }
  }, [roomId, userId]);

  const sendShuffleCommand = useCallback(async (isShuffled: boolean) => {
    try {
      await apiRequest('POST', '/api/music/shuffle', { roomId, isShuffled, userId });
    } catch (error) {
      console.error('Error sending shuffle command:', error);
    }
  }, [roomId, userId]);

  const sendRepeatCommand = useCallback(async (repeatMode: string) => {
    try {
      await apiRequest('POST', '/api/music/repeat', { roomId, repeatMode, userId });
    } catch (error) {
      console.error('Error sending repeat command:', error);
    }
  }, [roomId, userId]);

  // State güncellemesi gönderme fonksiyonu - throttled
  const sendStateUpdate = useCallback((state: any) => {
    const now = Date.now();
    // Son state güncellemesinden en az 2 saniye geçmişse gönder
    if (now - lastStateUpdateRef.current < 2000) {
      return;
    }
    
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        lastStateUpdateRef.current = now;
        wsRef.current.send(JSON.stringify({
          type: 'music_state_update',
          roomId,
          state
        }));
      }
    } catch (error) {
      console.error('Error sending music state update:', error);
    }
  }, [roomId]);

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000); // Normal kapatma
      }
    };
  }, [connect]);

  return {
    sendPlayCommand,
    sendPauseCommand,
    sendAddToQueueCommand,
    sendShuffleCommand,
    sendRepeatCommand,
    sendStateUpdate
  };
} 