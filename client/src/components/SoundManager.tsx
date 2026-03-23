import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Slider } from './ui/slider';
import { toast } from '../hooks/use-toast';
import { useSoundSync } from '../hooks/use-sound-sync';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FileAudio, 
  Upload, 
  Play, 
  Pause, 
  Trash2, 
  Keyboard, 
  Volume2,
  Loader2,
  X
} from 'lucide-react';

// Ses tipi
export type Sound = {
  id: string;
  name: string;
  file?: File; // Lokal yükleme için (opsiyonel - server'dan gelirse olmayabilir)
  url: string;
  assignedKey?: string;
  duration?: number;
  volume?: number;
};

interface SoundManagerProps {
  currentUser: { full_name: string } | null;
  roomId?: string;
  userId?: string;
  isDeafened?: boolean;
}

const SoundManager: React.FC<SoundManagerProps> = memo(({ currentUser, roomId, userId, isDeafened }) => {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [playingSounds, setPlayingSounds] = useState<Set<string>>(new Set());
  const [isListening, setIsListening] = useState(false);
  const [soundToAssign, setSoundToAssign] = useState<Sound | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // playSound/stopSound'u ref ile tut - stale closure sorununu çözer
  const playSoundRef = useRef<(soundId: string, sync?: boolean) => void>(() => {});
  const stopSoundRef = useRef<(soundId: string, sync?: boolean) => void>(() => {});

  // Ses senkronizasyonu
  const { sendPlaySoundCommand, sendStopSoundCommand, uploadSoundFile } = useSoundSync({
    roomId: roomId || 'default-room',
    userId: userId || 'anonymous',
    onPlaySound: (soundId, userId) => {
      console.log(`Remote play sound from ${userId}:`, soundId);
      playSoundRef.current(soundId, false);
    },
    onStopSound: (soundId, userId) => {
      console.log(`Remote stop sound from ${userId}:`, soundId);
      stopSoundRef.current(soundId, false);
    },
    onStateUpdate: (state) => {
      // Server'dan gelen soundboard state - sesleri geri yükle
      if (state && state.sounds && Array.isArray(state.sounds)) {
        console.log('🔊 Loading sounds from server state:', state.sounds.length);
        const serverSounds: Sound[] = state.sounds.map((s: any) => {
          const soundUrl = s.path || s.url;
          
          // Audio referansı oluştur (eğer yoksa)
          if (!audioRefs.current[s.id]) {
            const audio = new Audio(soundUrl);
            audio.addEventListener('loadedmetadata', () => {
              // duration bilgisi geldiğinde state'i güncelle
              setSounds(prev => prev.map(sound => 
                sound.id === s.id ? { ...sound, duration: audio.duration } : sound
              ));
            });
            audio.addEventListener('ended', () => {
              setPlayingSounds(prev => {
                const newSet = new Set(prev);
                newSet.delete(s.id);
                return newSet;
              });
            });
            audioRefs.current[s.id] = audio;
          }
          
          return {
            id: s.id,
            name: s.name || s.filename || 'Bilinmeyen Ses',
            url: soundUrl,
            duration: s.duration,
            volume: s.volume || 100,
          };
        });
        
        setSounds(prev => {
          // Zaten olan sesleri güncelleme, yeni olanları ekle
          const existingIds = new Set(prev.map(s => s.id));
          const newSounds = serverSounds.filter(s => !existingIds.has(s.id));
          if (newSounds.length > 0) {
            return [...prev, ...newSounds];
          }
          return prev;
        });
      }
    }
  });

  // Klavye kısayolu yönetimi
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // ESC ile tuş atamayı iptal et
      if (isListening && event.code === 'Escape') {
        event.preventDefault();
        setIsListening(false);
        setSoundToAssign(null);
        toast({
          title: "İptal edildi",
          description: "Tuş atama iptal edildi",
        });
        return;
      }

      if (isListening && soundToAssign) {
        event.preventDefault();
        const keyName = formatKeyName(event.code);
        assignKeyToSound(soundToAssign.id, event.code);
        setIsListening(false);
        setSoundToAssign(null);
        return;
      }

      // Normal ses çalma modu
      const sound = sounds.find(s => s.assignedKey === event.code);
      if (sound) {
        event.preventDefault();
        playSoundRef.current(sound.id);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isListening, soundToAssign, sounds]);

  // Dosya yükleme - server'a yükle
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Dosya tipi kontrolü
      if (!file.type.startsWith('audio/')) {
        toast({
          title: "Geçersiz dosya",
          description: `${file.name} bir ses dosyası değil`,
          variant: "destructive",
        });
        continue;
      }

      // Dosya boyutu kontrolü (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "Dosya çok büyük",
          description: `${file.name} 10MB'dan küçük olmalı`,
          variant: "destructive",
        });
        continue;
      }

      try {
        // Server'a yükle
        const result = await uploadSoundFile(file);
        
        if (result && result.sound) {
          const serverSound = result.sound;
          const soundUrl = serverSound.path || serverSound.url;
          
          // Audio referansı oluştur
          const audio = new Audio(soundUrl);
          const duration = await new Promise<number>((resolve) => {
            audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
            audio.addEventListener('error', () => resolve(0));
          });
          
          // Ses bittiğinde otomatik olarak çalıyor durumunu kaldır
          audio.addEventListener('ended', () => {
            setPlayingSounds(prev => {
              const newSet = new Set(prev);
              newSet.delete(serverSound.id);
              return newSet;
            });
          });

          const sound: Sound = {
            id: serverSound.id,
            name: file.name.replace(/\.[^/.]+$/, ""),
            file,
            url: soundUrl,
            duration,
            volume: 100,
          };

          audioRefs.current[serverSound.id] = audio;
          setSounds(prev => [...prev, sound]);
          
          toast({
            title: "Ses yüklendi",
            description: `${sound.name} başarıyla eklendi`,
          });
        }
      } catch (error) {
        console.error('Ses yükleme hatası:', error);
        toast({
          title: "Yükleme hatası",
          description: `${file.name} yüklenirken hata oluştu`,
          variant: "destructive",
        });
      }
    }

    setIsUploading(false);
    
    // Input'u temizle
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [uploadSoundFile]);

  // Ses çalma
  const playSound = useCallback((soundId: string, sync: boolean = true) => {
    const audio = audioRefs.current[soundId];
    if (!audio) return;

    if (isDeafened) {
      return;
    }

    if (playingSounds.has(soundId)) {
      audio.pause();
      audio.currentTime = 0;
      setPlayingSounds(prev => {
        const newSet = new Set(prev);
        newSet.delete(soundId);
        return newSet;
      });
      
      if (sync && roomId && userId) {
        sendStopSoundCommand(soundId);
      }
    } else {
      const sound = sounds.find(s => s.id === soundId);
      const volume = sound?.volume !== undefined ? sound.volume / 100 : 1;
      audio.volume = volume;
      
      audio.play().then(() => {
        setPlayingSounds(prev => new Set(prev).add(soundId));
        
        if (sync && roomId && userId) {
          sendPlaySoundCommand(soundId);
        }
      }).catch(error => {
        console.error('Ses çalma hatası:', error);
        toast({
          title: "Çalma hatası",
          description: "Ses çalınırken hata oluştu",
          variant: "destructive",
        });
      });
    }
  }, [playingSounds, roomId, userId, sendPlaySoundCommand, sendStopSoundCommand, isDeafened, sounds]);

  // Ses durdurma
  const stopSound = useCallback((soundId: string, sync: boolean = true) => {
    const audio = audioRefs.current[soundId];
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    setPlayingSounds(prev => {
      const newSet = new Set(prev);
      newSet.delete(soundId);
      return newSet;
    });
    
    if (sync && roomId && userId) {
      sendStopSoundCommand(soundId);
    }
  }, [roomId, userId, sendStopSoundCommand]);

  // Ref'leri güncelle - stale closure sorununu çöz
  useEffect(() => {
    playSoundRef.current = playSound;
  }, [playSound]);

  useEffect(() => {
    stopSoundRef.current = stopSound;
  }, [stopSound]);

  // Ses silme
  const deleteSound = useCallback((soundId: string) => {
    const sound = sounds.find(s => s.id === soundId);
    if (!sound) return;

    stopSound(soundId, false);
    
    if (audioRefs.current[soundId]) {
      audioRefs.current[soundId].src = '';
      delete audioRefs.current[soundId];
    }
    
    if (sound.url.startsWith('blob:')) {
      URL.revokeObjectURL(sound.url);
    }
    
    setSounds(prev => prev.filter(s => s.id !== soundId));
    
    toast({
      title: "Ses silindi",
      description: `${sound.name} başarıyla silindi`,
    });
  }, [sounds, stopSound]);

  // Tuş atama başlatma
  const startKeyAssignment = useCallback((sound: Sound) => {
    setIsListening(true);
    setSoundToAssign(sound);
    toast({
      title: "Tuş atama",
      description: "Bir tuşa basın... (ESC ile iptal)",
    });
  }, []);

  // Tuş atama
  const assignKeyToSound = useCallback((soundId: string, keyCode: string) => {
    setSounds(prev => prev.map(sound => 
      sound.id === soundId 
        ? { ...sound, assignedKey: keyCode }
        : sound
    ));
    
    toast({
      title: "Tuş atandı",
      description: `${formatKeyName(keyCode)} tuşu atandı`,
    });
  }, []);

  // Tuş atamasını kaldırma
  const removeKeyAssignment = useCallback((soundId: string) => {
    setSounds(prev => prev.map(sound => 
      sound.id === soundId 
        ? { ...sound, assignedKey: undefined }
        : sound
    ));
    
    toast({
      title: "Tuş kaldırıldı",
      description: "Tuş ataması kaldırıldı",
    });
  }, []);

  // Klavye kodunu formatla
  const formatKeyName = useCallback((keyCode: string): string => {
    const keyMap: { [key: string]: string } = {
      'Space': 'Boşluk',
      'Enter': 'Enter',
      'Tab': 'Tab',
      'Escape': 'Esc',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'ArrowUp': '↑',
      'ArrowDown': '↓',
      'ArrowLeft': '←',
      'ArrowRight': '→',
      'Home': 'Home',
      'End': 'End',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown',
      'Insert': 'Insert',
      'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
      'F7': 'F7', 'F8': 'F8', 'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
    };

    if (keyMap[keyCode]) {
      return keyMap[keyCode];
    }

    if (keyCode.startsWith('Key')) {
      return keyCode.slice(3);
    }
    if (keyCode.startsWith('Digit')) {
      return keyCode.slice(5);
    }

    return keyCode;
  }, []);

  // Süre formatla
  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Ses seviyesi ayarlama
  const setSoundVolume = useCallback((soundId: string, volume: number) => {
    setSounds(prev => prev.map(sound => 
      sound.id === soundId 
        ? { ...sound, volume }
        : sound
    ));
    
    const audio = audioRefs.current[soundId];
    if (audio) {
      audio.volume = volume / 100;
    }
  }, []);

  return (
    <Card className="glass bg-gradient-to-br from-[#0a0d1aee] via-[#1a1f3a99] to-[#2a2f5a88] border border-[#4dc9fa22] rounded-2xl shadow-2xl p-4 w-full backdrop-blur-xl relative overflow-hidden">
      {/* Arka plan efekti */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#4dc9fa08] via-transparent to-[#4dc9fa04] pointer-events-none"></div>
      
      {/* Header */}
      <div className="relative z-10 mb-3">
        <h3 className="text-base font-bold bg-gradient-to-r from-[#4dc9fa] to-[#7dd3fc] bg-clip-text text-transparent tracking-tight flex items-center gap-2">
          <FileAudio className="w-4 h-4" />
          Ses Paneli
        </h3>
      </div>

      {/* Tuş dinleme göstergesi */}
      <AnimatePresence mode="wait">
        {isListening && (
          <motion.div
            key="listening-indicator"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="relative z-10 mb-3 p-3 bg-[#4dc9fa22] border border-[#4dc9fa] rounded-lg text-center"
          >
            <Keyboard className="w-5 h-5 mx-auto mb-1 text-[#4dc9fa] animate-pulse" />
            <p className="text-[#e5eaff] text-sm font-medium">Bir tuşa basın...</p>
            <p className="text-[#aab7e7] text-xs mt-1">ESC ile iptal edin</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ses yükleme */}
      <div className="relative z-10 mb-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full bg-gradient-to-r from-[#4dc9fa] to-[#3bb8e9] hover:from-[#3bb8e9] hover:to-[#2aa7d8] text-white font-medium rounded-lg h-9 transition-all duration-300 shadow-lg hover:shadow-[#4dc9fa33] disabled:opacity-50"
        >
          {isUploading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-sm">Yükleniyor...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Upload className="h-3 w-3" />
              <span className="text-sm">Ses Yükle</span>
            </div>
          )}
        </Button>
      </div>

      {/* Ses listesi */}
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold bg-gradient-to-r from-[#4dc9fa] to-[#7dd3fc] bg-clip-text text-transparent flex items-center gap-1">
            <Volume2 className="w-3 h-3" />
            Sesler
          </h4>
          <Badge className="bg-[#4dc9fa22] text-[#4dc9fa] border border-[#4dc9fa] rounded-full px-2 py-0.5 text-xs">
            {sounds.length}
          </Badge>
        </div>
        
        <ScrollArea className="h-48 rounded-lg border border-[#4dc9fa22] bg-[#0f1422aa] backdrop-blur-sm">
          <div className="p-2 space-y-2">
            {sounds.length === 0 ? (
              <div className="text-center py-6">
                <FileAudio className="h-8 w-8 mx-auto mb-2 text-[#4dc9fa] opacity-50" />
                <p className="text-[#aab7e7] text-sm mb-1">Henüz ses yüklenmedi</p>
                <p className="text-[#7c8dbb] text-xs">Ses dosyalarınızı yükleyip klavye kısayolları atayın</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {sounds.map((sound, index) => (
                  <motion.div
                    key={sound.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.1 }}
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-all duration-300 backdrop-blur-sm ${
                      playingSounds.has(sound.id)
                        ? 'bg-[#4dc9fa22] border-[#4dc9fa] shadow-[#4dc9fa22]' 
                        : 'bg-[#0f1422aa] border-[#4dc9fa22] hover:bg-[#4dc9fa11] hover:border-[#4dc9fa44]'
                    }`}
                  >
                    {/* Ses bilgileri */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className="text-[#e5eaff] font-medium text-sm leading-tight break-words line-clamp-1">
                        {sound.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {sound.duration && (
                          <span className="text-[#7c8dbb] text-xs">
                            {formatDuration(sound.duration)}
                          </span>
                        )}
                        {sound.assignedKey && (
                          <Badge className="bg-[#4dc9fa22] text-[#4dc9fa] border border-[#4dc9fa] rounded-full px-2 py-0.5 text-xs">
                            {formatKeyName(sound.assignedKey)}
                          </Badge>
                        )}
                        {playingSounds.has(sound.id) && (
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#4dc9fa] animate-pulse"></div>
                            <span className="text-[#4dc9fa] text-xs">Çalıyor</span>
                          </div>
                        )}
                      </div>
                      {/* Ses seviyesi slider'ı */}
                      <div className="flex items-center gap-2 mt-2">
                        <Volume2 size={10} className="text-[#aab7e7]" />
                        <Slider 
                          defaultValue={[sound.volume || 100]} 
                          max={100} 
                          step={1} 
                          className="w-full" 
                          onValueChange={(value) => setSoundVolume(sound.id, value[0])}
                        />
                        <span className="text-[#7c8dbb] text-xs min-w-[2rem] text-right">
                          {sound.volume || 100}%
                        </span>
                      </div>
                    </div>
                    
                    {/* Kontroller */}
                    <div className="flex items-center gap-1">
                      {/* Oynat/Durdur */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => playSound(sound.id)}
                        className="w-7 h-7 rounded-full bg-[#0f1422aa] text-[#e5eaff] hover:bg-[#4dc9fa22] hover:text-[#4dc9fa] border border-[#4dc9fa22] transition-all duration-300"
                      >
                        {playingSounds.has(sound.id) ? (
                          <Pause className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3 ml-0.5" />
                        )}
                      </Button>
                      
                      {/* Tuş ata */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => sound.assignedKey ? removeKeyAssignment(sound.id) : startKeyAssignment(sound)}
                        className={`w-7 h-7 rounded-full transition-all duration-300 ${
                          sound.assignedKey
                            ? 'bg-[#ff475722] text-red-400 hover:bg-[#ff475744] hover:text-red-300 border border-red-400'
                            : 'bg-[#0f1422aa] text-[#aab7e7] hover:bg-[#4dc9fa22] hover:text-[#4dc9fa] border border-[#4dc9fa22]'
                        }`}
                      >
                        <Keyboard className="h-3 w-3" />
                      </Button>
                      
                      {/* Sil */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteSound(sound.id)}
                        className="w-7 h-7 rounded-full bg-[#ff475722] text-red-400 hover:bg-[#ff475744] hover:text-red-300 transition-all duration-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
});

SoundManager.displayName = "SoundManager";

export default SoundManager;