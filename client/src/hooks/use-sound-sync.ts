import { useEffect, useRef, useCallback } from 'react';
import { apiRequest } from '../lib/queryClient';

interface SoundControlMessage {
  type: 'play_sound' | 'stop_sound';
  soundId: string;
  userId: string;
  timestamp: number;
}

interface UseSoundSyncOptions {
  roomId: string;
  userId: string;
  onPlaySound?: (soundId: string, userId: string) => void;
  onStopSound?: (soundId: string, userId: string) => void;
  onStateUpdate?: (state: any) => void;
}

export function useSoundSync({ roomId, userId, onPlaySound, onStopSound, onStateUpdate }: UseSoundSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const maxRetries = 5;

  // Callback'leri ref'te tut - stale closure sorununu çöz
  const onPlaySoundRef = useRef(onPlaySound);
  const onStopSoundRef = useRef(onStopSound);
  const onStateUpdateRef = useRef(onStateUpdate);

  useEffect(() => { onPlaySoundRef.current = onPlaySound; }, [onPlaySound]);
  useEffect(() => { onStopSoundRef.current = onStopSound; }, [onStopSound]);
  useEffect(() => { onStateUpdateRef.current = onStateUpdate; }, [onStateUpdate]);

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

    wsUrl += `/ws?token=${Date.now()}`;
    
    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('🔊 Sound sync WS connected');
        isConnectingRef.current = false;
        retryCountRef.current = 0;
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'join_room', roomId }));
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'pong') return;
          
          if (data.type === 'soundboard_state_broadcast' && onStateUpdateRef.current) {
            onStateUpdateRef.current(data.state);
            return;
          }
          
          if (data.type === 'play_sound' && data.soundId && onPlaySoundRef.current) {
            onPlaySoundRef.current(data.soundId, data.userId || 'unknown');
            return;
          }
          
          if (data.type === 'sound_control') {
            const message: SoundControlMessage = data;
            if (message.userId === userId) return;
            
            switch (message.type) {
              case 'play_sound':
                onPlaySoundRef.current?.(message.soundId, message.userId);
                break;
              case 'stop_sound':
                onStopSoundRef.current?.(message.soundId, message.userId);
                break;
            }
          }
        } catch (error) {
          console.error('Error parsing WS message:', error);
        }
      };

      wsRef.current.onerror = () => {
        isConnectingRef.current = false;
      };

      wsRef.current.onclose = () => {
        isConnectingRef.current = false;
        
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
          setTimeout(() => {
            if (wsRef.current?.readyState !== WebSocket.OPEN && wsRef.current?.readyState !== WebSocket.CONNECTING) {
              connect();
            }
          }, delay);
        }
      };
    } catch (error) {
      console.error('Error creating WS connection:', error);
      isConnectingRef.current = false;
    }
  }, [roomId, userId]); // Sadece roomId ve userId'ye bağlı

  const sendPlaySoundCommand = useCallback(async (soundId: string) => {
    try {
      await apiRequest('POST', '/api/sound/play', { roomId, soundId, userId });
    } catch (error) {
      console.error('Error sending play sound command:', error);
    }
  }, [roomId, userId]);

  const sendStopSoundCommand = useCallback(async (soundId: string) => {
    try {
      await apiRequest('POST', '/api/sound/stop', { roomId, soundId, userId });
    } catch (error) {
      console.error('Error sending stop sound command:', error);
    }
  }, [roomId, userId]);

  const sendStateUpdate = useCallback((state: any) => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'soundboard_state_update',
          roomId,
          state
        }));
      }
    } catch (error) {
      console.error('Error sending soundboard state update:', error);
    }
  }, [roomId]);

  const uploadSoundFile = useCallback(async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('sound', file);
      formData.append('roomId', roomId);
      formData.append('userId', userId);

      let serverUrl = '';
      if (import.meta.env.VITE_SERVER_URL) {
        serverUrl = import.meta.env.VITE_SERVER_URL;
      } else if (window.location.hostname === 'feched.onrender.com') {
        serverUrl = 'https://feched.onrender.com';
      }

      const response = await fetch(`${serverUrl}/api/sound/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload sound file');
      }

      return await response.json();
    } catch (error) {
      console.error('Error uploading sound file:', error);
      throw error;
    }
  }, [roomId, userId]);

  useEffect(() => {
    connect();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000);
      }
    };
  }, [connect]);

  return {
    sendPlaySoundCommand,
    sendStopSoundCommand,
    sendStateUpdate,
    uploadSoundFile
  };
}