import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { toast } from '../../hooks/use-toast';
import { useMusicSync } from '../../hooks/use-music-sync';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  Shuffle, 
  Repeat, 
  Repeat1, 
  Search,
  Loader2,
  Music,
  X,
  Plus
} from 'lucide-react';
import { apiRequest } from '../../lib/queryClient';

// YouTube Iframe API yükleyici - komponentin dışında tanımla
const loadYouTubeIframeAPI = () => {
  if ((window as any).YT) return Promise.resolve((window as any).YT);
  return new Promise(resolve => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    (window as any).onYouTubeIframeAPIReady = () => resolve((window as any).YT);
    document.body.appendChild(tag);
  });
};

// Şarkı tipi
export type Song = {
  id: string;
  title: string;
  artist: string;
  video_id: string;
  thumbnail: string;
  duration: string;
  queue_position: number;
};

interface MusicPlayerProps {
  currentUser: { full_name: string } | null;
  isMuted?: boolean;
  isDeafened?: boolean;
  roomId?: string;
  userId?: string;
}

const MusicPlayer: React.FC<MusicPlayerProps> = memo(({ currentUser, isMuted = false, isDeafened = false, roomId, userId }) => {
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(60);
  const [isReady, setIsReady] = useState(false);
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'none' | 'all' | 'one'>('none');
  const [isShuffled, setIsShuffled] = useState(false);
  const playerRef = useRef<any>(null);
  const ytPlayer = useRef<any>(null);

  // Müzik senkronizasyonu
  const { sendPlayCommand, sendPauseCommand, sendAddToQueueCommand, sendShuffleCommand, sendRepeatCommand, sendStateUpdate, sendVideoStateUpdate } = useMusicSync({
    roomId: roomId || 'default-room',
    userId: userId || 'anonymous',
    onPlay: (videoId, userId, currentTime) => {
      console.log(`🎬 Remote play command from ${userId}:`, videoId, 'at time:', currentTime);
      // Remote play komutunu işle
      const song = queue.find(s => s.video_id === videoId);
      if (song) {
        setCurrentSong(song);
        setIsPlaying(true);
        if (ytPlayer.current && isReady) {
          // Video'yu belirtilen zamana ayarla ve oynat
          if (currentTime && currentTime > 0) {
            ytPlayer.current.seekTo(currentTime, true);
          }
          ytPlayer.current.playVideo();
        }
      }
    },
    onPause: (userId, currentTime) => {
      console.log(`🎬 Remote pause command from ${userId} at time:`, currentTime);
      setIsPlaying(false);
      if (ytPlayer.current && isReady) {
        ytPlayer.current.pauseVideo();
        // Video'yu belirtilen zamana ayarla
        if (currentTime && currentTime > 0) {
          ytPlayer.current.seekTo(currentTime, true);
        }
      }
    },
    onAddToQueue: (song, userId) => {
      console.log(`Remote add to queue from ${userId}:`, song);
      // Kendi gönderdiğimiz mesajları işleme
      if (userId === (userId || 'anonymous')) return;
      addSong(song);
      toast({
        title: "Şarkı eklendi",
        description: `${song.title} - ${userId} tarafından eklendi`,
      });
    },
    onShuffle: (isShuffled, userId) => {
      console.log(`Remote shuffle command from ${userId}:`, isShuffled);
      // Kendi gönderdiğimiz mesajları işleme
      if (userId === (userId || 'anonymous')) return;
      setIsShuffled(isShuffled);
    },
    onRepeat: (repeatMode, userId) => {
      console.log(`Remote repeat command from ${userId}:`, repeatMode);
      // Kendi gönderdiğimiz mesajları işleme
      if (userId === (userId || 'anonymous')) return;
      setRepeatMode(repeatMode as 'none' | 'all' | 'one');
    },
    onStateUpdate: (state) => {
      console.log('Received music state update:', state);
      // State'i güncelle - sadece gerçekten değişiklik varsa
      if (state.queue && JSON.stringify(state.queue) !== JSON.stringify(queue)) {
        setQueue(state.queue);
      }
      if (state.currentSong && (!currentSong || state.currentSong.id !== currentSong.id)) {
        setCurrentSong(state.currentSong);
      }
      if (state.isPlaying !== undefined && state.isPlaying !== isPlaying) {
        setIsPlaying(state.isPlaying);
      }
      if (state.repeatMode && state.repeatMode !== repeatMode) {
        setRepeatMode(state.repeatMode);
      }
      if (state.isShuffled !== undefined && state.isShuffled !== isShuffled) {
        setIsShuffled(state.isShuffled);
      }
    },
    onVideoStateUpdate: (videoState) => {
      console.log('🎬 Received video state update:', videoState);
      
      // Video state'ini zorla güncelle
      if (videoState.currentVideoId && videoState.currentVideoId !== currentSong?.video_id) {
        const song = queue.find(s => s.video_id === videoState.currentVideoId);
        if (song) {
          setCurrentSong(song);
        }
      }
      
      // Video durumunu zorla güncelle
      if (ytPlayer.current && isReady) {
        if (videoState.isPlaying) {
          ytPlayer.current.playVideo();
          setIsPlaying(true);
        } else {
          ytPlayer.current.pauseVideo();
          setIsPlaying(false);
        }
        
        // Video zamanını senkronize et
        if (videoState.currentTime > 0) {
          const currentPlayerTime = ytPlayer.current.getCurrentTime();
          const timeDifference = Math.abs(currentPlayerTime - videoState.currentTime);
          
          // Eğer zaman farkı 2 saniyeden fazlaysa senkronize et
          if (timeDifference > 2) {
            console.log(`🎬 Syncing video time from ${currentPlayerTime} to ${videoState.currentTime}`);
            ytPlayer.current.seekTo(videoState.currentTime, true);
          }
        }
      }
    }
  });

  // YouTube player'ı başlat - useCallback ile optimize et
  const initializePlayer = useCallback(async () => {
    if (ytPlayer.current) return;
    
    try {
      const YT = await loadYouTubeIframeAPI();
      ytPlayer.current = new YT.Player(playerRef.current, {
        height: '180',
        width: '320',
        playerVars: {
          playsinline: 1,
          controls: 0,
          showinfo: 0,
          rel: 0,
          origin: window.location.origin,
          enablejsapi: 1,
          fs: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          disablekb: 1,
          autoplay: 0,
        },
        events: {
          onReady: (e: any) => {
            console.log('YouTube player ready');
            e.target.setVolume(volume);
            setIsReady(true);
          },
          onStateChange: (e: any) => {
            console.log('YouTube player state changed:', e.data);
            if (e.data === YT.PlayerState.ENDED) handleSongEnd();
            if (e.data === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              // Video state güncellemesi gönder
              if (roomId && userId && currentSong && ytPlayer.current) {
                const currentTime = ytPlayer.current.getCurrentTime();
                sendVideoStateUpdate({
                  isPlaying: true,
                  currentVideoId: currentSong.video_id || currentSong.id,
                  currentTime,
                  duration: ytPlayer.current.getDuration() || 0,
                  lastUpdate: Date.now()
                });
              }
            }
            if (e.data === YT.PlayerState.PAUSED) {
              setIsPlaying(false);
              // Video state güncellemesi gönder
              if (roomId && userId && currentSong && ytPlayer.current) {
                const currentTime = ytPlayer.current.getCurrentTime();
                sendVideoStateUpdate({
                  isPlaying: false,
                  currentVideoId: currentSong.video_id || currentSong.id,
                  currentTime,
                  duration: ytPlayer.current.getDuration() || 0,
                  lastUpdate: Date.now()
                });
              }
            }
            if (e.data === YT.PlayerState.BUFFERING) { /* do nothing */ }
          },
          onError: (e: any) => {
            console.error('YouTube player error:', e.data);
          }
        },
      });
    } catch (error) {
      console.error('Failed to initialize YouTube player:', error);
    }
  }, []);

  useEffect(() => {
    initializePlayer();

    return () => {
      if (ytPlayer.current) {
        try {
           ytPlayer.current.destroy();
        } catch (e) {
          console.error("Error destroying player", e);
        }
        ytPlayer.current = null;
      }
    };
  }, [initializePlayer]);

  // Şarkı değişince oynat
  useEffect(() => {
    if (ytPlayer.current && isReady && currentSong) {
      console.log('Loading video:', currentSong.video_id);
      // Eğer aynı video zaten yüklüyse sadece oynat
      try {
        const currentVideoId = ytPlayer.current.getVideoData()?.video_id;
        if (currentVideoId === (currentSong.video_id || currentSong.id)) {
          if (isPlaying) {
            ytPlayer.current.playVideo();
          }
        } else {
          ytPlayer.current.loadVideoById({ videoId: currentSong.video_id || currentSong.id });
        }
      } catch (error) {
        console.error('Error checking current video:', error);
        ytPlayer.current.loadVideoById({ videoId: currentSong.video_id || currentSong.id });
      }
    }
  }, [currentSong?.video_id, isReady]); // Sadece video_id değişince tetikle

  // Ses değişince uygula - debounce ile optimize et
  useEffect(() => {
    if (ytPlayer.current && isReady) {
      const timeoutId = setTimeout(() => {
        try {
          ytPlayer.current.setVolume(volume);
          console.log('Volume set to:', volume);
        } catch (error) {
          console.error('Error setting volume:', error);
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [volume, isReady]);

  // Susturma durumunu takip et - sadece deafen için ses kontrolü
  useEffect(() => {
    if (ytPlayer.current && isReady) {
      try {
        // Deafen durumunda sadece sesi kapat
        if (isDeafened) {
          ytPlayer.current.setVolume(0);
        } else {
          ytPlayer.current.setVolume(volume);
        }
      } catch (error) {
        console.error('Error handling deafen state:', error);
      }
    }
  }, [isDeafened, isReady, volume]);

  // Şarkı bitince ne olacak - useCallback ile optimize et
  const handleSongEnd = useCallback(() => {
    if (repeatMode === 'one' && currentSong) {
      ytPlayer.current.seekTo(0);
      ytPlayer.current.playVideo();
      return;
    }
    if (isShuffled) {
      const nextIndex = Math.floor(Math.random() * queue.length);
      setCurrentSong(queue[nextIndex]);
    }
    const idx = queue.findIndex(s => s.id === currentSong?.id);
    if (idx === -1) return;

    if (repeatMode === 'all') {
      const nextIndex = (idx + 1) % queue.length;
      setCurrentSong(queue[nextIndex]);
    } else if (idx < queue.length - 1) {
      setCurrentSong(queue[idx + 1]);
    } else {
      setIsPlaying(false);
      setCurrentSong(null);
    }
  }, [repeatMode, currentSong, queue, isShuffled]);

  // Oynat/duraklat - useCallback ile optimize et
  const togglePlayPause = useCallback(() => {
    if (!currentSong || !isReady || !ytPlayer.current) {
      console.log('Cannot toggle play/pause:', { currentSong: !!currentSong, isReady, player: !!ytPlayer.current });
      return;
    }
    
    try {
      const newIsPlaying = !isPlaying;
      const currentTime = ytPlayer.current.getCurrentTime();
      
      setIsPlaying(newIsPlaying);
      
      if (isPlaying) {
        console.log('🎬 Pausing video at time:', currentTime);
        ytPlayer.current.pauseVideo();
        // Senkronizasyon için pause komutu gönder
        if (roomId && userId) {
          sendPauseCommand(currentTime);
          // Video state güncellemesi gönder
          sendVideoStateUpdate({
            isPlaying: false,
            currentVideoId: currentSong?.video_id || currentSong?.id || '',
            currentTime,
            duration: ytPlayer.current.getDuration() || 0,
            lastUpdate: Date.now()
          });
          // State güncellemesi gönder
          sendStateUpdate({
            queue,
            currentSong,
            isPlaying: false,
            repeatMode,
            isShuffled
          });
        }
      } else {
        console.log('🎬 Playing video at time:', currentTime);
        ytPlayer.current.playVideo();
        // Senkronizasyon için play komutu gönder
        if (roomId && userId && currentSong) {
          const videoIdToPlay = currentSong.video_id || currentSong.id;
          if (videoIdToPlay) {
            sendPlayCommand(videoIdToPlay, currentTime);
            // Video state güncellemesi gönder
            sendVideoStateUpdate({
              isPlaying: true,
              currentVideoId: videoIdToPlay,
              currentTime,
              duration: ytPlayer.current.getDuration() || 0,
              lastUpdate: Date.now()
            });
            // State güncellemesi gönder
            sendStateUpdate({
              queue,
              currentSong,
              isPlaying: true,
              repeatMode,
              isShuffled
            });
          }
        }
      }
    } catch (error: any) {
      console.error('Error toggling play/pause:', error);
    }
  }, [currentSong, isReady, isPlaying, roomId, userId, sendPlayCommand, sendPauseCommand, sendStateUpdate, sendVideoStateUpdate, queue, repeatMode, isShuffled]);

  // Kuyrukta ileri/geri - useCallback ile optimize et
  const nextSong = useCallback(() => {
    if (!currentSong) return;
    const idx = queue.findIndex(s => s.id === currentSong.id);
    let nextSong: Song | null = null;
    
    if (isShuffled) {
        const nextIndex = Math.floor(Math.random() * queue.length);
        nextSong = queue[nextIndex];
    } else if (idx < queue.length - 1) {
      nextSong = queue[idx + 1];
    } else if (repeatMode === 'all') {
        nextSong = queue[0];
    }
    
    if (nextSong) {
      setCurrentSong(nextSong);
      // Senkronizasyon için play komutu gönder
      if (roomId && userId) {
        const videoIdToPlay = nextSong.video_id || nextSong.id;
        if (videoIdToPlay) sendPlayCommand(videoIdToPlay);
        // State güncellemesi gönder
        sendStateUpdate({
          queue,
          currentSong: nextSong,
          isPlaying: true,
          repeatMode,
          isShuffled
        });
      }
    }
  }, [currentSong, queue, isShuffled, repeatMode, roomId, userId, sendPlayCommand, sendStateUpdate, isPlaying]);

  const prevSong = useCallback(() => {
    if (!currentSong) return;
    const idx = queue.findIndex(s => s.id === currentSong.id);
    let prevSong: Song | null = null;
    
    if (idx > 0) {
      prevSong = queue[idx - 1];
    } else if (repeatMode === 'all') {
        prevSong = queue[queue.length - 1];
    }
    
    if (prevSong) {
      setCurrentSong(prevSong);
      // Senkronizasyon için play komutu gönder
      if (roomId && userId) {
        const videoIdToPlay = prevSong.video_id || prevSong.id;
        if (videoIdToPlay) sendPlayCommand(videoIdToPlay);
        // State güncellemesi gönder
        sendStateUpdate({
          queue,
          currentSong: prevSong,
          isPlaying: true,
          repeatMode,
          isShuffled
        });
      }
    }
  }, [currentSong, queue, repeatMode, roomId, userId, sendPlayCommand, sendStateUpdate, isPlaying]);

  // Kuyruğa şarkı ekle - useCallback ile optimize et
  const addSong = useCallback((song: Song) => {
    if (queue.find(s => s.id === song.id)) return;
    const newQueue = [...queue, { ...song, queue_position: queue.length }];
    setQueue(newQueue);
    if (!currentSong) setCurrentSong(song);
    
    // Senkronizasyon için kuyruk ekleme komutu gönder
    if (roomId && userId) {
      sendAddToQueueCommand(song);
      // State güncellemesi gönder - sadece önemli değişikliklerde
      sendStateUpdate({
        queue: newQueue,
        currentSong: currentSong || song,
        isPlaying,
        repeatMode,
        isShuffled
      });
    }
  }, [queue, currentSong, roomId, userId, sendAddToQueueCommand, sendStateUpdate, isPlaying, repeatMode, isShuffled]);

  // Kuyruktan şarkı sil - useCallback ile optimize et
  const removeSong = useCallback((id: string) => {
    const songToRemove = queue.find(s => s.id === id);
    if (!songToRemove) return;

    const newQueue = queue.filter(s => s.id !== id);
    setQueue(newQueue);
    
    let newCurrentSong = currentSong;
    if (currentSong?.id === id) {
      const nextSongInQueue = newQueue.find(s => s.queue_position > songToRemove.queue_position);
      newCurrentSong = nextSongInQueue || newQueue[0] || null;
      setCurrentSong(newCurrentSong);
    }

    // State güncellemesi gönder - sadece önemli değişikliklerde
    if (roomId && userId) {
      sendStateUpdate({
        queue: newQueue,
        currentSong: newCurrentSong,
        isPlaying,
        repeatMode,
        isShuffled
      });
    }
  }, [queue, currentSong, roomId, userId, sendStateUpdate, isPlaying, repeatMode, isShuffled]);

  // YouTube arama - useCallback ile optimize et
  const searchYouTube = useCallback(async (query: string) => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await apiRequest('GET', `/api/youtube/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        const video = data.items[0];
        const song: Song = {
          id: video.id.videoId,
          title: video.snippet.title,
          artist: video.snippet.channelTitle,
          video_id: video.id.videoId,
          thumbnail: video.snippet.thumbnails.medium.url,
          duration: 'Unknown',
          queue_position: queue.length,
        };
        addSong(song);
        toast({
          title: "Şarkı eklendi",
          description: `${song.title} - ${song.artist}`,
        });
      }
    } catch (error) {
      console.error('YouTube search error:', error);
      toast({
        title: "Arama hatası",
        description: "Şarkı bulunamadı",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  }, [addSong, queue.length]);

  // Search submit handler - useCallback ile optimize et
  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    searchYouTube(search);
  }, [search, searchYouTube]);

  // Search input change handler - useCallback ile optimize et
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  // Volume change handler - useCallback ile optimize et
  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    console.log('Volume change requested:', newVolume);
    setVolume(newVolume);
  }, []);

  // Repeat mode toggle - useCallback ile optimize et
  const toggleRepeatMode = useCallback(() => {
    setRepeatMode(prev => {
      const newMode = prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none';
      // Senkronizasyon için repeat mode değişikliğini gönder
      if (roomId && userId) {
        sendRepeatCommand(newMode);
        // State güncellemesi gönder
        sendStateUpdate({
          queue,
          currentSong,
          isPlaying,
          repeatMode: newMode,
          isShuffled
        });
      }
      return newMode;
    });
  }, [roomId, userId, sendRepeatCommand, sendStateUpdate, queue, currentSong, isPlaying, isShuffled]);

  // Shuffle toggle - useCallback ile optimize et
  const toggleShuffle = useCallback(() => {
    setIsShuffled(prev => {
      const newShuffle = !prev;
      // Senkronizasyon için shuffle değişikliğini gönder
      if (roomId && userId) {
        sendShuffleCommand(newShuffle);
        // State güncellemesi gönder
        sendStateUpdate({
          queue,
          currentSong,
          isPlaying,
          repeatMode,
          isShuffled: newShuffle
        });
      }
      return newShuffle;
    });
  }, [roomId, userId, sendShuffleCommand, sendStateUpdate, queue, currentSong, isPlaying, repeatMode]);

  // Queue'yu memoize et
  const sortedQueue = useMemo(() => {
    return [...queue].sort((a, b) => a.queue_position - b.queue_position);
  }, [queue]);

  return (
    <Card className="glass bg-gradient-to-br from-[#0a0d1aee] via-[#1a1f3a99] to-[#2a2f5a88] border border-[#4dc9fa22] rounded-2xl shadow-2xl p-6 w-full max-w-md backdrop-blur-xl relative overflow-hidden">
      {/* Arka plan efekti */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#4dc9fa08] via-transparent to-[#4dc9fa04] pointer-events-none"></div>
      
      {/* Header */}
      <div className="relative z-10 mb-4">
        <h3 className="text-lg font-bold bg-gradient-to-r from-[#4dc9fa] to-[#7dd3fc] bg-clip-text text-transparent tracking-tight flex items-center gap-2">
          <Music className="w-5 h-5" />
          Müzik Çalar
        </h3>
      </div>
      
      {/* Arama */}
      <form onSubmit={handleSearchSubmit} className="relative z-10 mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              className="w-full bg-[#0f1422aa] text-[#e5eaff] border-[#4dc9fa33] placeholder-[#7c8dbb] focus:border-[#4dc9fa] focus:ring-[#4dc9fa22] rounded-lg h-9 pl-3 pr-10 backdrop-blur-sm transition-all duration-300 text-sm"
              placeholder="🎵 Şarkı ara..."
              value={search}
              onChange={handleSearchChange}
              disabled={isSearching}
            />
            {isSearching && (
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin text-[#4dc9fa]" />
              </div>
            )}
          </div>
          <Button 
            type="submit" 
            disabled={isSearching || !search.trim()}
            className="bg-gradient-to-r from-[#4dc9fa] to-[#3bb8e9] hover:from-[#3bb8e9] hover:to-[#2aa7d8] text-white font-medium rounded-lg h-9 px-3 transition-all duration-300 shadow-lg hover:shadow-[#4dc9fa33] disabled:opacity-50 text-sm"
          >
            {isSearching ? (
              <div className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Ara</span>
              </div>
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>

      {/* Player */}
      <div className="relative z-10 mb-4">
        {/* YouTube Player Container - gizli, sadece ses çalar */}
        <div className="relative mb-3">
          <div 
            ref={playerRef} 
            style={{ position: 'absolute', opacity: 0, width: '1px', height: '1px', pointerEvents: 'none', zIndex: -1 }}
          ></div>
          
          {/* Görsel: Albüm kapağı stili */}
          {currentSong ? (
            <div className="relative rounded-xl overflow-hidden shadow-lg border border-[#4dc9fa22] bg-[#0f1422] p-4">
              <div className="flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  <img 
                    src={currentSong.thumbnail} 
                    alt={currentSong.title} 
                    className="w-20 h-20 rounded-lg object-cover shadow-md" 
                  />
                  {isPlaying && (
                    <div className="absolute inset-0 bg-[#4dc9fa22] rounded-lg flex items-center justify-center">
                      <div className="flex items-center gap-0.5">
                        <div className="w-1 h-4 bg-[#4dc9fa] rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                        <div className="w-1 h-6 bg-[#4dc9fa] rounded-full animate-pulse" style={{animationDelay: '150ms'}}></div>
                        <div className="w-1 h-3 bg-[#4dc9fa] rounded-full animate-pulse" style={{animationDelay: '300ms'}}></div>
                        <div className="w-1 h-5 bg-[#4dc9fa] rounded-full animate-pulse" style={{animationDelay: '100ms'}}></div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#e5eaff] font-medium text-sm truncate">{currentSong.title}</p>
                  <p className="text-[#aab7e7] text-xs truncate mt-1">{currentSong.artist}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-[#4dc9fa] animate-pulse' : 'bg-[#7c8dbb]'}`}></div>
                    <span className="text-[#7c8dbb] text-xs">{isPlaying ? 'Çalıyor' : 'Duraklatıldı'}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[#4dc9fa22] bg-[#0f1422] p-6 text-center">
              <Music className="h-8 w-8 mx-auto mb-2 text-[#4dc9fa] opacity-50" />
              <p className="text-[#aab7e7] text-sm">Şarkı arayın ve çalmaya başlayın</p>
            </div>
          )}
          
          {!isReady && (
            <div className="absolute inset-0 bg-[#0f1422cc] backdrop-blur-sm rounded-xl flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-[#4dc9fa] mx-auto mb-2" />
                <p className="text-[#aab7e7] text-sm">Yükleniyor...</p>
              </div>
            </div>
          )}
        </div>
        

        
        {/* Kontroller */}
        <div className="flex items-center justify-center gap-4 mb-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={prevSong} 
            className="w-10 h-10 rounded-full bg-[#0f1422aa] text-[#e5eaff] hover:bg-[#4dc9fa22] hover:text-[#4dc9fa] border border-[#4dc9fa22] transition-all duration-300 backdrop-blur-sm"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={togglePlayPause} 
            className="w-12 h-12 rounded-full bg-gradient-to-r from-[#4dc9fa] to-[#3bb8e9] text-white hover:from-[#3bb8e9] hover:to-[#2aa7d8] shadow-lg hover:shadow-[#4dc9fa44] transition-all duration-300"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={nextSong} 
            className="w-10 h-10 rounded-full bg-[#0f1422aa] text-[#e5eaff] hover:bg-[#4dc9fa22] hover:text-[#4dc9fa] border border-[#4dc9fa22] transition-all duration-300 backdrop-blur-sm"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Ses ve Mod Kontrolleri */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-2 flex-1">
            <Volume2 className="h-4 w-4 text-[#4dc9fa]" />
            <Slider 
              value={[volume]} 
              max={100} 
              step={1} 
              className="flex-1" 
              onValueChange={handleVolumeChange}
            />
            <span className="text-[#aab7e7] text-xs font-mono w-8 text-center">{volume}%</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={toggleShuffle}
              className={`w-8 h-8 rounded-full transition-all duration-300 backdrop-blur-sm ${
                isShuffled 
                  ? 'bg-[#4dc9fa22] text-[#4dc9fa] border border-[#4dc9fa]' 
                  : 'bg-[#0f1422aa] text-[#aab7e7] border border-[#4dc9fa22] hover:bg-[#4dc9fa11]'
              }`}
            >
              <Shuffle className="h-3.5 w-3.5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={toggleRepeatMode}
              className={`w-8 h-8 rounded-full transition-all duration-300 backdrop-blur-sm ${
                repeatMode !== 'none' 
                  ? 'bg-[#4dc9fa22] text-[#4dc9fa] border border-[#4dc9fa]' 
                  : 'bg-[#0f1422aa] text-[#aab7e7] border border-[#4dc9fa22] hover:bg-[#4dc9fa11]'
              }`}
            >
              {repeatMode === 'one' ? <Repeat1 className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Kuyruk */}
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold bg-gradient-to-r from-[#4dc9fa] to-[#7dd3fc] bg-clip-text text-transparent flex items-center gap-1">
            <Music className="w-4 h-4" />
            Kuyruk
          </h4>
          <Badge className="bg-[#4dc9fa22] text-[#4dc9fa] border border-[#4dc9fa] rounded-full px-2 py-0.5 text-xs">
            {queue.length}
          </Badge>
        </div>
        
        <ScrollArea className="h-48 rounded-lg border border-[#4dc9fa22] bg-[#0f1422aa] backdrop-blur-sm">
          <div className="p-3 space-y-2">
            {sortedQueue.length === 0 ? (
              <div className="text-center py-6">
                <Music className="h-8 w-8 mx-auto mb-2 text-[#4dc9fa]" />
                <p className="text-[#aab7e7] text-sm">Kuyruk boş</p>
                <p className="text-[#7c8dbb] text-xs">Şarkı arayıp kuyruğa ekleyin</p>
              </div>
            ) : (
              sortedQueue.map((song, index) => (
                <div 
                  key={song.id} 
                  className={`flex items-center gap-3 p-2 rounded-lg border transition-all duration-300 backdrop-blur-sm ${
                    currentSong?.id === song.id 
                      ? 'bg-[#4dc9fa22] border-[#4dc9fa] shadow-[#4dc9fa22]' 
                      : 'bg-[#0f1422aa] border-[#4dc9fa22] hover:bg-[#4dc9fa11] hover:border-[#4dc9fa44]'
                  }`}
                >
                  {/* Thumbnail - Sabit boyut */}
                  <div className="relative flex-shrink-0">
                    <img 
                      src={song.thumbnail} 
                      alt={song.title} 
                      className="w-10 h-10 rounded-lg object-cover shadow-md" 
                    />
                    {currentSong?.id === song.id && (
                      <div className="absolute inset-0 bg-[#4dc9fa22] rounded-lg flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#4dc9fa] animate-pulse"></div>
                      </div>
                    )}
                  </div>
                  
                  {/* Şarkı Bilgileri - Responsive */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className="text-[#e5eaff] font-medium text-sm leading-tight break-words line-clamp-2">
                      {song.title}
                    </p>
                    <p className="text-[#aab7e7] text-xs leading-tight break-words line-clamp-1 mt-0.5">
                      {song.artist}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[#7c8dbb] text-xs flex-shrink-0">#{song.queue_position + 1}</span>
                      {currentSong?.id === song.id && (
                        <span className="text-[#4dc9fa] text-xs font-medium flex-shrink-0">Çalıyor</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Silme Butonu - Sabit boyut */}
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeSong(song.id)}
                    className="w-6 h-6 rounded-full bg-[#ff475722] text-red-400 hover:bg-[#ff475744] hover:text-red-300 transition-all duration-300 flex-shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
});

MusicPlayer.displayName = "MusicPlayer";

export default MusicPlayer; 
