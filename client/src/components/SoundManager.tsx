import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { toast } from '../hooks/use-toast';
import { useSoundSync } from '../hooks/use-sound-sync';
import { 
  FileAudio, Upload, Play, Pause, Trash2, Keyboard, Volume2, Loader2, ChevronDown, ChevronUp
} from 'lucide-react';

// Ses tipi
export type Sound = {
  id: string;
  name: string;
  file?: File;
  url: string;
  assignedKey?: string;
  duration?: number;
  volume?: number;
};

// IndexedDB helpers
const DB_NAME = 'goccord_sounds';
const DB_VERSION = 1;
const STORE_NAME = 'sounds';

function openSoundDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSoundToDB(sound: { id: string; name: string; data: ArrayBuffer; assignedKey?: string; volume?: number }) {
  const db = await openSoundDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(sound);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllSoundsFromDB(): Promise<{ id: string; name: string; data: ArrayBuffer; assignedKey?: string; volume?: number }[]> {
  const db = await openSoundDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteSoundFromDB(id: string) {
  const db = await openSoundDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateSoundMetaInDB(id: string, meta: { assignedKey?: string; volume?: number }) {
  const db = await openSoundDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, ...meta });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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
  const [expanded, setExpanded] = useState(false);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playSoundRef = useRef<(soundId: string, sync?: boolean) => void>(() => {});
  const stopSoundRef = useRef<(soundId: string, sync?: boolean) => void>(() => {});

  // Load sounds from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await getAllSoundsFromDB();
        const loaded: Sound[] = [];
        for (const s of stored) {
          const blob = new Blob([s.data]);
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.addEventListener('ended', () => {
            setPlayingSounds(prev => { const n = new Set(prev); n.delete(s.id); return n; });
          });
          audioRefs.current[s.id] = audio;
          const duration = await new Promise<number>(res => {
            audio.addEventListener('loadedmetadata', () => res(audio.duration));
            audio.addEventListener('error', () => res(0));
          });
          loaded.push({ id: s.id, name: s.name, url, duration, volume: s.volume ?? 100, assignedKey: s.assignedKey });
        }
        if (loaded.length > 0) setSounds(loaded);
      } catch (e) { console.error('IndexedDB load error:', e); }
    })();
  }, []);

  // Sound sync hook
  const { sendPlaySoundCommand, sendStopSoundCommand, uploadSoundFile } = useSoundSync({
    roomId: roomId || 'default-room',
    userId: userId || 'anonymous',
    onPlaySound: (soundId) => { playSoundRef.current(soundId, false); },
    onStopSound: (soundId) => { stopSoundRef.current(soundId, false); },
    onStateUpdate: (state) => {
      if (state?.sounds && Array.isArray(state.sounds)) {
        const serverSounds: Sound[] = state.sounds.map((s: any) => {
          const soundUrl = s.path || s.url;
          if (!audioRefs.current[s.id]) {
            const audio = new Audio(soundUrl);
            audio.addEventListener('loadedmetadata', () => {
              setSounds(prev => prev.map(sound => sound.id === s.id ? { ...sound, duration: audio.duration } : sound));
            });
            audio.addEventListener('ended', () => {
              setPlayingSounds(prev => { const n = new Set(prev); n.delete(s.id); return n; });
            });
            audioRefs.current[s.id] = audio;
          }
          return { id: s.id, name: s.name || s.filename || 'Unknown', url: soundUrl, duration: s.duration, volume: s.volume || 100 };
        });
        setSounds(prev => {
          const ids = new Set(prev.map(s => s.id));
          const newOnes = serverSounds.filter(s => !ids.has(s.id));
          return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
        });
      }
    }
  });

  // Keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isListening && e.code === 'Escape') { e.preventDefault(); setIsListening(false); setSoundToAssign(null); return; }
      if (isListening && soundToAssign) {
        e.preventDefault();
        assignKeyToSound(soundToAssign.id, e.code);
        setIsListening(false);
        setSoundToAssign(null);
        return;
      }
      const sound = sounds.find(s => s.assignedKey === e.code);
      if (sound) { e.preventDefault(); playSoundRef.current(sound.id); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isListening, soundToAssign, sounds]);

  // File upload — save to IndexedDB + server
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('audio/')) { toast({ title: "Geçersiz dosya", description: `${file.name} bir ses dosyası değil`, variant: "destructive" }); continue; }
      if (file.size > 10 * 1024 * 1024) { toast({ title: "Dosya çok büyük", description: `${file.name} 10MB limit`, variant: "destructive" }); continue; }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: file.type });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const duration = await new Promise<number>(res => {
          audio.addEventListener('loadedmetadata', () => res(audio.duration));
          audio.addEventListener('error', () => res(0));
        });
        audio.addEventListener('ended', () => {
          setPlayingSounds(prev => { const n = new Set(prev); n.delete(soundId); return n; });
        });

        const soundId = `local_${Date.now()}_${i}`;
        audioRefs.current[soundId] = audio;

        const soundName = file.name.replace(/\.[^/.]+$/, "");
        const sound: Sound = { id: soundId, name: soundName, url, duration, volume: 100 };
        setSounds(prev => [...prev, sound]);

        // Save to IndexedDB
        await saveSoundToDB({ id: soundId, name: soundName, data: arrayBuffer, volume: 100 });

        // Also upload to server for sync
        try { await uploadSoundFile(file); } catch {}

        toast({ title: "Ses yüklendi", description: `${soundName} kaydedildi` });
      } catch (error) {
        console.error('Upload error:', error);
        toast({ title: "Hata", description: `${file.name} yüklenemedi`, variant: "destructive" });
      }
    }
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadSoundFile]);

  // Play sound
  const playSound = useCallback((soundId: string, sync: boolean = true) => {
    const audio = audioRefs.current[soundId];
    if (!audio || isDeafened) return;

    if (playingSounds.has(soundId)) {
      audio.pause(); audio.currentTime = 0;
      setPlayingSounds(prev => { const n = new Set(prev); n.delete(soundId); return n; });
      if (sync && roomId && userId) sendStopSoundCommand(soundId);
    } else {
      const sound = sounds.find(s => s.id === soundId);
      audio.volume = (sound?.volume ?? 100) / 100;
      audio.play().then(() => {
        setPlayingSounds(prev => new Set(prev).add(soundId));
        if (sync && roomId && userId) sendPlaySoundCommand(soundId);
      }).catch(() => toast({ title: "Çalma hatası", variant: "destructive" }));
    }
  }, [playingSounds, roomId, userId, sendPlaySoundCommand, sendStopSoundCommand, isDeafened, sounds]);

  const stopSound = useCallback((soundId: string, sync: boolean = true) => {
    const audio = audioRefs.current[soundId];
    if (!audio) return;
    audio.pause(); audio.currentTime = 0;
    setPlayingSounds(prev => { const n = new Set(prev); n.delete(soundId); return n; });
    if (sync && roomId && userId) sendStopSoundCommand(soundId);
  }, [roomId, userId, sendStopSoundCommand]);

  useEffect(() => { playSoundRef.current = playSound; }, [playSound]);
  useEffect(() => { stopSoundRef.current = stopSound; }, [stopSound]);

  // Delete sound
  const deleteSound = useCallback(async (soundId: string) => {
    const sound = sounds.find(s => s.id === soundId);
    if (!sound) return;
    stopSound(soundId, false);
    if (audioRefs.current[soundId]) { audioRefs.current[soundId].src = ''; delete audioRefs.current[soundId]; }
    if (sound.url.startsWith('blob:')) URL.revokeObjectURL(sound.url);
    setSounds(prev => prev.filter(s => s.id !== soundId));
    try { await deleteSoundFromDB(soundId); } catch {}
    toast({ title: "Ses silindi", description: `${sound.name} silindi` });
  }, [sounds, stopSound]);

  const assignKeyToSound = useCallback((soundId: string, keyCode: string) => {
    setSounds(prev => prev.map(s => s.id === soundId ? { ...s, assignedKey: keyCode } : s));
    updateSoundMetaInDB(soundId, { assignedKey: keyCode }).catch(() => {});
    toast({ title: "Tuş atandı", description: `${formatKey(keyCode)} atandı` });
  }, []);

  const removeKeyAssignment = useCallback((soundId: string) => {
    setSounds(prev => prev.map(s => s.id === soundId ? { ...s, assignedKey: undefined } : s));
    updateSoundMetaInDB(soundId, { assignedKey: undefined }).catch(() => {});
  }, []);

  const setSoundVolume = useCallback((soundId: string, volume: number) => {
    setSounds(prev => prev.map(s => s.id === soundId ? { ...s, volume } : s));
    const audio = audioRefs.current[soundId];
    if (audio) audio.volume = volume / 100;
    updateSoundMetaInDB(soundId, { volume }).catch(() => {});
  }, []);

  const formatKey = (code: string): string => {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    const map: Record<string, string> = { Space: 'Boşluk', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc' };
    return map[code] || code;
  };

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  // ============ COMPACT UI ============
  return (
    <div className="rounded-xl border border-[#23253a] bg-[#101320ee] backdrop-blur-xl overflow-hidden">
      {/* Compact Header — always visible */}
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#ffffff06] transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileAudio size={13} className="text-[#4dc9fa]" />
          <span className="text-xs font-semibold text-[#e5eaff]">Ses Paneli</span>
          {sounds.length > 0 && (
            <span className="text-[10px] text-[#4dc9fa] bg-[#4dc9fa15] px-1.5 py-0.5 rounded-full">{sounds.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Quick play buttons for first 3 sounds when collapsed */}
          {!expanded && sounds.slice(0, 3).map(s => (
            <button
              key={s.id}
              onClick={(e) => { e.stopPropagation(); playSound(s.id); }}
              className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold transition-all ${
                playingSounds.has(s.id) ? 'bg-[#4dc9fa33] text-[#4dc9fa] ring-1 ring-[#4dc9fa]' : 'bg-[#15182a] text-[#aab7e7] hover:text-[#4dc9fa] hover:bg-[#4dc9fa15]'
              }`}
              title={s.name}
            >
              {s.assignedKey ? formatKey(s.assignedKey) : s.name.charAt(0).toUpperCase()}
            </button>
          ))}
          {expanded ? <ChevronUp size={12} className="text-[#7c8dbb]" /> : <ChevronDown size={12} className="text-[#7c8dbb]" />}
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-[#ffffff08]">
          {/* Key listening indicator */}
          {isListening && (
            <div className="mt-2 py-2 text-center bg-[#4dc9fa15] border border-[#4dc9fa33] rounded-lg animate-pulse">
              <span className="text-xs text-[#4dc9fa]">Bir tuşa bas... (ESC iptal)</span>
            </div>
          )}

          {/* Upload button */}
          <div className="mt-2">
            <input ref={fileInputRef} type="file" multiple accept="audio/*" onChange={handleFileUpload} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full py-1.5 rounded-lg text-xs font-medium bg-[#4dc9fa15] text-[#4dc9fa] border border-dashed border-[#4dc9fa33] hover:bg-[#4dc9fa22] hover:border-[#4dc9fa] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isUploading ? <><Loader2 size={11} className="animate-spin" /> Yükleniyor...</> : <><Upload size={11} /> Ses Yükle</>}
            </button>
          </div>

          {/* Sound list — compact rows */}
          {sounds.length === 0 ? (
            <p className="text-[10px] text-[#7c8dbb] text-center py-3">Henüz ses yüklenmedi</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
              {sounds.map(sound => (
                <div
                  key={sound.id}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all text-[11px] group ${
                    playingSounds.has(sound.id)
                      ? 'bg-[#4dc9fa15] border border-[#4dc9fa44]'
                      : 'bg-[#15182a] border border-[#23253a] hover:border-[#4dc9fa22]'
                  }`}
                >
                  {/* Play/Pause */}
                  <button onClick={() => playSound(sound.id)} className="w-5 h-5 rounded flex items-center justify-center text-[#e5eaff] hover:text-[#4dc9fa] transition-colors flex-shrink-0">
                    {playingSounds.has(sound.id) ? <Pause size={10} /> : <Play size={10} className="ml-0.5" />}
                  </button>

                  {/* Name + duration */}
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="text-[#e5eaff] truncate font-medium leading-tight">{sound.name}</span>
                    {sound.duration ? <span className="text-[9px] text-[#7c8dbb] flex-shrink-0">{fmtDur(sound.duration)}</span> : null}
                    {sound.assignedKey && (
                      <span className="text-[9px] text-[#4dc9fa] bg-[#4dc9fa15] px-1 py-0.5 rounded font-mono flex-shrink-0">{formatKey(sound.assignedKey)}</span>
                    )}
                  </div>

                  {/* Volume slider — visible on hover */}
                  <div className="hidden group-hover:flex items-center gap-1 w-16 flex-shrink-0">
                    <Slider defaultValue={[sound.volume || 100]} max={100} step={1} className="w-full" onValueChange={(v) => setSoundVolume(sound.id, v[0])} />
                  </div>

                  {/* Actions — visible on hover */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={() => sound.assignedKey ? removeKeyAssignment(sound.id) : (setIsListening(true), setSoundToAssign(sound))}
                      className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${sound.assignedKey ? 'text-red-400 hover:text-red-300' : 'text-[#7c8dbb] hover:text-[#4dc9fa]'}`}>
                      <Keyboard size={10} />
                    </button>
                    <button onClick={() => deleteSound(sound.id)} className="w-5 h-5 rounded flex items-center justify-center text-red-400/60 hover:text-red-400 transition-colors">
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

SoundManager.displayName = "SoundManager";

export default SoundManager;