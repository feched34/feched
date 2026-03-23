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
  currentTime?: number;
}

interface VideoState {
  isPlaying: boolean;
  currentVideoId: string | null;
  currentTime: number;
  duration: number;
  lastUpdate: number;
}

interface UseMusicSyncOptions {
  roomId: string;
  userId: string;
  onPlay?: (videoId: string, userId: string, currentTime?: number) => void;
  onPause?: (userId: string, currentTime?: number) => void;
  onAddToQueue?: (song: any, userId: string) => void;
  onShuffle?: (isShuffled: boolean, userId: string) => void;
  onRepeat?: (repeatMode: string, userId: string) => void;
  onStateUpdate?: (state: any) => void;
  onVideoStateUpdate?: (videoState: VideoState) => void;
}

export function useMusicSync({ roomId, userId, onPlay, onPause, onAddToQueue, onShuffle, onRepeat, onStateUpdate, onVideoStateUpdate }: UseMusicSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStateUpdateRef = useRef<number>(0);
  const isConnectingRef = useRef<boolean>(false);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef<number>(0);
  const maxRetries = 5;

  // Callback'leri ref'te tut - stale closure sorununu çöz
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onAddToQueueRef = useRef(onAddToQueue);
  const onShuffleRef = useRef(onShuffle);
  const onRepeatRef = useRef(onRepeat);
  const onStateUpdateRef = useRef(onStateUpdate);
  const onVideoStateUpdateRef = useRef(onVideoStateUpdate);

  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  useEffect(() => { onPauseRef.current = onPause; }, [onPause]);
  useEffect(() => { onAddToQueueRef.current = onAddToQueue; }, [onAddToQueue]);
  useEffect(() => { onShuffleRef.current = onShuffle; }, [onShuffle]);
  useEffect(() => { onRepeatRef.current = onRepeat; }, [onRepeat]);
  useEffect(() => { onStateUpdateRef.current = onStateUpdate; }, [onStateUpdate]);
  useEffect(() => { onVideoStateUpdateRef.current = onVideoStateUpdate; }, [onVideoStateUpdate]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || isConnectingRef.current) return;

    isConnectingRef.current = true;

    let wsUrl: string;
    if (import.meta.env.VITE_SERVER_URL) {
      wsUrl = import.meta.env.VITE_SERVER_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    } else if (window.location.hostname === 'feched.onrender.com') {
      wsUrl = 'wss://feched.onrender.com';
    } else {
      wsUrl = window.location.origin.replace('https://', 'wss://').replace('http://', 'ws://');
    }
    
    const token = Date.now();
    wsUrl += `/ws?token=${token}&roomId=${roomId}&userId=${userId}`;
    
    try {
      wsRef.current = new WebSocket(wsUrl);

      const connectionTimeout = setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
      }, 10000);

      wsRef.current.onopen = () => {
        isConnectingRef.current = false;
        retryCountRef.current = 0;
        clearTimeout(connectionTimeout);
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'join_room', roomId }));
          
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
          }
          heartbeatIntervalRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'ping' }));
            }
          }, 25000);
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'pong') return;
          
          if (data.type === 'video_state_broadcast' && onVideoStateUpdateRef.current) {
            onVideoStateUpdateRef.current(data.state);
            return;
          }
          
          if (data.type === 'music_state_broadcast' && onStateUpdateRef.current) {
            onStateUpdateRef.current(data.state);
            return;
          }
          
          // Chat history mesajını da dinle (WebSocket üzerinden)
          if (data.type === 'chat_history' || data.type === 'chat_message') {
            return; // Chat hook'u tarafından işlenecek
          }
          
          if (data.type === 'music_control') {
            const message: MusicControlMessage = data;
            if (message.userId === userId) return;
            
            switch (message.type) {
              case 'play':
                if (message.videoId) onPlayRef.current?.(message.videoId, message.userId, message.currentTime);
                break;
              case 'pause':
                onPauseRef.current?.(message.userId, message.currentTime);
                break;
              case 'add_to_queue':
                if (message.song) onAddToQueueRef.current?.(message.song, message.userId);
                break;
              case 'shuffle':
                if (typeof message.isShuffled === 'boolean') onShuffleRef.current?.(message.isShuffled, message.userId);
                break;
              case 'repeat':
                if (message.repeatMode) onRepeatRef.current?.(message.repeatMode, message.userId);
                break;
            }
          }
        } catch (error) {
          console.error('Error parsing WS message:', error);
        }
      };

      wsRef.current.onerror = () => {
        isConnectingRef.current = false;
        clearTimeout(connectionTimeout);
      };

      wsRef.current.onclose = (event) => {
        isConnectingRef.current = false;
        clearTimeout(connectionTimeout);
        
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        
        if (event.code !== 1000 && !isConnectingRef.current && retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
          
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
      console.error('Error creating WS connection:', error);
      isConnectingRef.current = false;
    }
  }, [roomId, userId]); // Sadece roomId ve userId'ye bağlı

  const sendPlayCommand = useCallback(async (videoId: string, currentTime: number = 0) => {
    try {
      await apiRequest('POST', '/api/music/play', { roomId, videoId, userId, currentTime });
    } catch (error) {
      console.error('Error sending play command:', error);
    }
  }, [roomId, userId]);

  const sendPauseCommand = useCallback(async (currentTime: number = 0) => {
    try {
      await apiRequest('POST', '/api/music/pause', { roomId, userId, currentTime });
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

  const sendStateUpdate = useCallback((state: any) => {
    const now = Date.now();
    if (now - lastStateUpdateRef.current < 2000) return;
    
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

  const sendVideoStateUpdate = useCallback(async (videoState: VideoState) => {
    try {
      await apiRequest('POST', '/api/video/state', {
        roomId,
        userId,
        isPlaying: videoState.isPlaying,
        currentTime: videoState.currentTime,
        duration: videoState.duration,
        videoId: videoState.currentVideoId
      });
    } catch (error) {
      console.error('Error sending video state update:', error);
    }
  }, [roomId, userId]);

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (wsRef.current) wsRef.current.close(1000);
    };
  }, [connect]);

  return {
    sendPlayCommand,
    sendPauseCommand,
    sendAddToQueueCommand,
    sendShuffleCommand,
    sendRepeatCommand,
    sendStateUpdate,
    sendVideoStateUpdate
  };
}