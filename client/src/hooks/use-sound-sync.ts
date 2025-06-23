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
          
          // Soundboard state broadcast mesajını dinle
          if (data.type === 'soundboard_state_broadcast' && onStateUpdate) {
            console.log('Received soundboard state broadcast:', data.state);
            onStateUpdate(data.state);
            return;
          }
          
          // Direkt play_sound mesajını dinle (server'dan gelen)
          if (data.type === 'play_sound' && data.soundId && onPlaySound) {
            console.log('Received play_sound message:', data.soundId);
            onPlaySound(data.soundId, data.userId || 'unknown');
            return;
          }
          
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
  }, [roomId, userId, onPlaySound, onStopSound, onStateUpdate]);

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

  // State güncellemesi gönderme fonksiyonu
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

  // Ses dosyası yükleme fonksiyonu
  const uploadSoundFile = useCallback(async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('sound', file);
      formData.append('roomId', roomId);
      formData.append('userId', userId);

      const response = await fetch('/api/sound/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload sound file');
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error uploading sound file:', error);
      throw error;
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
    sendStopSoundCommand,
    sendStateUpdate,
    uploadSoundFile
  };
} 