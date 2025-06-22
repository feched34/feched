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
}

export function useSoundSync({ roomId, userId, onPlaySound, onStopSound }: UseSoundSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Environment variable'dan al veya mevcut origin'i kullan
    const wsUrl = import.meta.env.VITE_SERVER_URL 
      ? `${import.meta.env.VITE_SERVER_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/ws?token=${Date.now()}`
      : `${window.location.origin.replace('https://', 'wss://').replace('http://', 'ws://')}/ws?token=${Date.now()}`;
    
    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('Sound sync WebSocket connected');
        // WebSocket'in hazır olduğundan emin ol
        if (wsRef.current?.readyState === WebSocket.OPEN) {
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
          
          if (data.type === 'sound_control') {
            const message: SoundControlMessage = data;
            
            // Kendi gönderdiğimiz mesajları işleme
            if (message.userId === userId) return;
            
            switch (message.type) {
              case 'play_sound':
                if (onPlaySound) {
                  onPlaySound(message.soundId, message.userId);
                }
                break;
              case 'stop_sound':
                if (onStopSound) {
                  onStopSound(message.soundId, message.userId);
                }
                break;
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('Sound sync WebSocket error:', error);
      };

      wsRef.current.onclose = () => {
        console.log('Sound sync WebSocket disconnected');
        // Yeniden bağlanma denemesi - sadece manuel kapatma değilse
        setTimeout(() => {
          if (wsRef.current?.readyState !== WebSocket.OPEN && wsRef.current?.readyState !== WebSocket.CONNECTING) {
            connect();
          }
        }, 3000);
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [roomId, userId, onPlaySound, onStopSound]);

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

  useEffect(() => {
    connect();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    sendPlaySoundCommand,
    sendStopSoundCommand
  };
} 