import { useEffect, useRef, useCallback } from 'react';

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
}

export function useMusicSync({ roomId, userId, onPlay, onPause, onAddToQueue, onShuffle, onRepeat }: UseMusicSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Production'da doğru URL kullan, development'ta localhost
    const wsUrl = window.location.hostname !== 'localhost'
      ? `wss://feched.onrender.com/ws`
      : 'ws://localhost:5050/ws';
    
    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('Music sync WebSocket connected');
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
          
          if (data.type === 'music_control') {
            const message: MusicControlMessage = data;
            
            // Kendi gönderdiğimiz mesajları işleme
            if (message.userId === userId) return;
            
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
      };

      wsRef.current.onclose = () => {
        console.log('Music sync WebSocket disconnected');
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
  }, [roomId, userId, onPlay, onPause, onAddToQueue, onShuffle, onRepeat]);

  const sendPlayCommand = useCallback(async (videoId: string) => {
    try {
      await fetch('/api/music/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, videoId, userId })
      });
    } catch (error) {
      console.error('Error sending play command:', error);
    }
  }, [roomId, userId]);

  const sendPauseCommand = useCallback(async () => {
    try {
      await fetch('/api/music/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId })
      });
    } catch (error) {
      console.error('Error sending pause command:', error);
    }
  }, [roomId, userId]);

  const sendAddToQueueCommand = useCallback(async (song: any) => {
    try {
      await fetch('/api/music/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, song, userId })
      });
    } catch (error) {
      console.error('Error sending add to queue command:', error);
    }
  }, [roomId, userId]);

  const sendShuffleCommand = useCallback(async (isShuffled: boolean) => {
    try {
      await fetch('/api/music/shuffle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, isShuffled, userId })
      });
    } catch (error) {
      console.error('Error sending shuffle command:', error);
    }
  }, [roomId, userId]);

  const sendRepeatCommand = useCallback(async (repeatMode: string) => {
    try {
      await fetch('/api/music/repeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, repeatMode, userId })
      });
    } catch (error) {
      console.error('Error sending repeat command:', error);
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
    sendPlayCommand,
    sendPauseCommand,
    sendAddToQueueCommand,
    sendShuffleCommand,
    sendRepeatCommand
  };
} 