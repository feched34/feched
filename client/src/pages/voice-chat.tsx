import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { LocalParticipant, RemoteParticipant } from 'livekit-client';
import { useVoiceChat } from '@/hooks/use-voice-chat';
import ParticlesLoader from '@/components/particles-loader';
import ChatBox from '@/components/ChatBox';
import MusicPlayer from '@/components/music/MusicPlayer';
import SoundManager from '@/components/SoundManager';
import VoiceControls from '@/components/VoiceControls';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { ErrorModal } from '@/components/ui/error-modal';
import { Volume2, Mic, MicOff, VolumeX, LogOut, MessageCircle, Music, Users, Radio, Server, X, ChevronRight, ChevronDown } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

// localStorage helper
const STORAGE_KEY = 'goccord_user';

interface SavedUser {
  nickname: string;
  lastRoom: string;
  rooms: string[];
}

function getSavedUser(): SavedUser | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveUser(nickname: string, room: string) {
  try {
    const normalizedRoom = room.trim().toLowerCase();
    const existing = getSavedUser();
    const rooms = existing?.rooms || [];
    // Kayıtta lowercase kullan
    if (!rooms.some(r => r.toLowerCase() === normalizedRoom)) rooms.push(normalizedRoom);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nickname, lastRoom: normalizedRoom, rooms }));
  } catch {}
}

// identity'den _timestamp kısmını kaldır: "Feched_1234567890" → "Feched"
function displayName(identity: string | undefined): string {
  if (!identity) return 'Anonim';
  const idx = identity.lastIndexOf('_');
  if (idx > 0) return identity.substring(0, idx);
  return identity;
}

function clearSavedUser() {
  localStorage.removeItem(STORAGE_KEY);
}

export default function VoiceChat() {
  const [currentScreen, setCurrentScreen] = useState<'join' | 'returning' | 'chat'>('join');
  const [nickname, setNickname] = useState('');
  const [serverName, setServerName] = useState('');
  const [showError, setShowError] = useState(false);
  const [savedUser, setSavedUser] = useState<SavedUser | null>(null);
  const [mobileTab, setMobileTab] = useState<'chat' | 'participants' | 'music'>('chat');
  const [pendingConnect, setPendingConnect] = useState(false);
  const [showServerPanel, setShowServerPanel] = useState(false);
  const [pttKeyBinding, setPttKeyBinding] = useState(false);

  const {
    isConnecting,
    isConnected,
    isReconnecting,
    participants,
    isMuted,
    isDeafened,
    isPTTActive,
    pttEnabled,
    pttKey,
    connectionError,
    audioDevices,
    audioOutputDevices,
    selectedAudioDevice,
    selectedOutputDevice,
    connect,
    disconnect,
    toggleMute,
    toggleDeafen,
    togglePTT,
    setPTTKey,
    switchAudioDevice,
    switchOutputDevice,
    setParticipantVolume,
  } = useVoiceChat({ nickname, roomName: serverName || 'default-room' });

  // Sayfa yüklendiğinde kayıtlı kullanıcıyı kontrol et
  useEffect(() => {
    const saved = getSavedUser();
    if (saved) {
      setSavedUser(saved);
      setNickname(saved.nickname);
      if (saved.lastRoom) {
        setServerName(saved.lastRoom);
        setPendingConnect(true);
      } else {
        setCurrentScreen('returning');
      }
    }
  }, []);

  const particlesComponent = useMemo(() => <ParticlesLoader />, []);

  // Yeni sunucuya giriş
  const handleJoinRoom = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim() || !serverName.trim()) return;
    const normalizedServer = serverName.trim().toLowerCase();
    setServerName(normalizedServer);
    saveUser(nickname, normalizedServer);
    await connect();
  }, [nickname, serverName, connect]);

  // Geri dönen kullanıcı - mevcut sunucuya giriş
  const handleReturnToRoom = useCallback((room: string) => {
    setServerName(room);
    saveUser(nickname, room);
    setPendingConnect(true);
  }, [nickname]);

  // pendingConnect flag'i true olduğunda React re-render sonrası connect çağır
  useEffect(() => {
    if (pendingConnect && serverName) {
      setPendingConnect(false);
      connect();
    }
  }, [pendingConnect, serverName, connect]);

  // Geri dönen kullanıcı - yeni sunucu
  const handleNewRoom = useCallback(() => {
    setCurrentScreen('join');
  }, []);

  // Odadan çıkış
  const handleLeaveRoom = useCallback(async () => {
    await disconnect();
    setCurrentScreen('join');
    setServerName('');
  }, [disconnect]);

  // Tamamen çıkış (localStorage temizle)
  const handleFullLogout = useCallback(async () => {
    await disconnect();
    clearSavedUser();
    setSavedUser(null);
    setNickname('');
    setServerName('');
    setCurrentScreen('join');
  }, [disconnect]);

  useEffect(() => {
    if (connectionError) setShowError(true);
  }, [connectionError]);

  useEffect(() => {
    if (isConnected) setCurrentScreen('chat');
  }, [isConnected]);

  const { localParticipant, remoteParticipants } = useMemo(() => {
    const local = participants.find(p => p instanceof LocalParticipant);
    const remote = participants.filter(p => p instanceof RemoteParticipant);
    return { localParticipant: local, remoteParticipants: remote };
  }, [participants]);

  const handleRetry = useCallback(() => {
    setShowError(false);
    connect();
  }, [connect]);

  const handleCloseError = useCallback(() => setShowError(false), []);

  const currentUser = useMemo(() => ({
    id: localParticipant?.identity || '0',
    name: displayName(localParticipant?.identity),
    avatar: '/logo.png'
  }), [localParticipant?.identity]);

  const users = useMemo(() => 
    participants.map(p => ({ id: p.identity, name: displayName(p.identity), avatar: '/logo.png' })), 
    [participants]
  );

  const musicPlayerUser = useMemo(() => 
    localParticipant ? { full_name: localParticipant.identity } : null, 
    [localParticipant?.identity]
  );

  // ========== GERİ DÖNEN KULLANICI EKRANI ==========
  if (currentScreen === 'returning' && savedUser) {
    return (
      <>
        <div style={{position:'fixed', inset:0, zIndex:0, background:'#141628'}} />
        {particlesComponent}
        <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
          <main className="glass max-w-md w-full flex flex-col relative border-[#23253a] border p-8 shadow-2xl items-center" style={{background:'#101320', borderRadius: '22px'}}>
            <div className="fade-in fade-in-1 flex w-24 h-24 border-[#23305b33] logo-emoji bg-gradient-to-tr from-[#eac073aa] to-[#4dc9fa88] border rounded-full mb-5 items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="Logo" className="w-24 h-24 object-cover scale-125" />
            </div>
            
            <h2 className="fade-in fade-in-2 text-2xl font-bold text-[#e5eaff] mb-1">Tekrar hoşgeldin!</h2>
            <p className="fade-in fade-in-2 text-[#eac073] text-lg font-semibold mb-6">{savedUser.nickname}</p>
            
            {savedUser.rooms.length > 0 && (
              <div className="fade-in fade-in-3 w-full mb-4">
                <p className="text-sm text-[#aab7e7] mb-1 font-semibold">📡 Sunucularına Katıl</p>
                <p className="text-xs text-[#7c8dbb] mb-3">Bir sunucuya tıkla ve anında sesli sohbete gir.</p>
                <div className="space-y-2">
                  {savedUser.rooms.map((room) => (
                    <button
                      key={room}
                      onClick={() => {
                        setServerName(room);
                        handleReturnToRoom(room);
                      }}
                      className="w-full p-3 bg-[#15182a] border border-[#23253a] rounded-xl text-left hover:border-[#4dc9fa] hover:bg-[#1a1f3a] transition-all group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#6a7bfd] to-[#2ec8fa] flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                          {room.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[#e5eaff] font-semibold group-hover:text-[#4dc9fa] transition-colors truncate">{room}</span>
                            {room === savedUser.lastRoom && (
                              <span className="text-xs text-[#2ec8fa] bg-[#2ec8fa22] px-2 py-0.5 rounded-full flex-shrink-0">Son</span>
                            )}
                          </div>
                          <p className="text-xs text-[#7c8dbb] group-hover:text-[#4dc9fa55] transition-colors">Sesli sohbete katıl</p>
                        </div>
                        <ChevronRight size={16} className="text-[#7c8dbb] group-hover:text-[#4dc9fa] transition-colors flex-shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <div className="fade-in fade-in-3 w-full flex gap-3">
              <button onClick={handleNewRoom} className="flex-1 py-3 rounded-xl text-[#aab7e7] border border-[#23253a] hover:border-[#4dc9fa] hover:text-[#4dc9fa] transition-all duration-300 font-medium">
                Yeni Sunucu
              </button>
              <button onClick={handleFullLogout} className="py-3 px-4 rounded-xl text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all duration-300">
                Çıkış
              </button>
            </div>
          </main>
        </div>
        <LoadingOverlay isVisible={isConnecting} />
        <ErrorModal isVisible={showError} message={connectionError || ""} onRetry={handleRetry} onClose={handleCloseError} />
        <style>{baseStyles}</style>
      </>
    );
  }

  // ========== GİRİŞ EKRANI ==========
  if (currentScreen === 'join') {
    return (
      <>
        <div style={{position:'fixed', inset:0, zIndex:0, background:'#141628'}} />
        {particlesComponent}
        <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
          <main className="glass max-w-md w-full flex flex-col relative border-[#23253a] border p-8 shadow-2xl items-center" style={{background:'#101320', borderRadius: '22px'}}>
            <div className="fade-in fade-in-1 flex w-32 h-32 border-[#23305b33] logo-emoji bg-gradient-to-tr from-[#eac073aa] to-[#4dc9fa88] border rounded-full mb-7 items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="Logo" className="w-32 h-32 object-cover scale-125" />
            </div>
            <h2 className="main-title fade-in fade-in-2 text-white font-semibold tracking-tight text-center leading-tight mb-2 select-none">Goccord</h2>
            <p className="fade-in fade-in-2 text-[#aab7e7] text-sm mb-6">Sesli sohbet topluluğuna katıl</p>
            <div className="divider" style={{height:1, background:'linear-gradient(90deg, transparent, #23305b 35%, #2ec8fa66 65%, transparent)', opacity:0.3, margin:'0 0 24px 0', width:'100%'}}></div>
            
            <form className="fade-in fade-in-3 w-full flex flex-col gap-4" autoComplete="off" onSubmit={handleJoinRoom}>
              <label className="w-full">
                <span className="block text-sm font-medium text-[#aab7e7] mb-2 pl-1">Takma Ad</span>
                <input
                  required spellCheck={false} name="nickname" maxLength={22}
                  placeholder="Nickini gir"
                  className="input-glow w-full bg-[#15182a] text-base placeholder-[#7c8dbb] transition focus:ring-0 outline-none font-medium text-[#e5eaff] border-[#23253a] border rounded-lg p-3"
                  autoComplete="off" value={nickname} onChange={e => setNickname(e.target.value)} id="nickname"
                />
              </label>
              
              <label className="w-full">
                <span className="block text-sm font-medium text-[#aab7e7] mb-2 pl-1">Sunucu Adı</span>
                <input
                  required spellCheck={false} name="serverName" maxLength={30}
                  placeholder="Sunucu adını gir (örn: Arkadaşlar)"
                  className="input-glow w-full bg-[#15182a] text-base placeholder-[#7c8dbb] transition focus:ring-0 outline-none font-medium text-[#e5eaff] border-[#23253a] border rounded-lg p-3"
                  autoComplete="off" value={serverName} onChange={e => setServerName(e.target.value)} id="serverName"
                />
              </label>
              
              <button type="submit" className="btn-shine w-full py-3 rounded-xl flex items-center justify-center gap-2 text-lg font-semibold tracking-tight text-[#e4eaff] shadow-lg transition cursor-pointer select-none" disabled={!nickname.trim() || !serverName.trim()}>
                <span>Giriş Yap</span>
              </button>
            </form>
          </main>
        </div>
        <LoadingOverlay isVisible={isConnecting} />
        <ErrorModal isVisible={showError} message={connectionError || ""} onRetry={handleRetry} onClose={handleCloseError} />
        <style>{baseStyles}</style>
      </>
    );
  }

  // ========== SOHBET EKRANI ==========
  return (
    <>
      <div style={{position:'fixed', inset:0, zIndex:0, background:'#141628'}} />
      {particlesComponent}
      <div className="min-h-screen flex flex-col relative z-10">
        {/* Header */}
        <header className="glass-header flex items-center justify-between px-4 sm:px-8 py-3 border-b border-[#23253a] shadow-lg" style={{background:'rgba(16,19,32,0.95)', backdropFilter: 'blur(18px)'}}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 border-2 border-[#23305b33] rounded-full bg-gradient-to-tr from-[#eac073aa] to-[#4dc9fa88] overflow-hidden flex-shrink-0">
              <img src="/logo.png" alt="Logo" className="w-full h-full object-cover scale-110" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-xl font-bold text-[#e5eaff] tracking-tight select-none">Goccord</h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center px-2 sm:px-3 py-1 bg-[#2ec8fa22] text-[#2ec8fa] rounded-full text-xs font-medium border border-[#2ec8fa33]">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full mr-1.5 animate-pulse"></div>
                <span className="hidden sm:inline">{serverName}</span>
                <span className="sm:hidden">{serverName.slice(0, 8)}{serverName.length > 8 ? '…' : ''}</span>
              </div>
              {isReconnecting && (
                <div className="flex items-center px-2 py-1 bg-[#eac07322] text-[#eac073] rounded-full text-xs font-medium border border-[#eac07333] animate-pulse">
                  Yeniden bağlanıyor...
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden sm:block text-[#aab7e7] text-sm">
              <span className="font-semibold text-[#eac073]">{nickname}</span>
            </span>
            <button 
              onClick={() => setShowServerPanel(!showServerPanel)} 
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#6a7bfd22] to-[#2ec8fa22] border border-[#6a7bfd44] hover:border-[#4dc9fa] text-[#e5eaff] hover:text-[#4dc9fa] transition-all duration-300 rounded-lg text-xs font-medium"
            >
              <Server size={14} />
              <span className="hidden sm:inline">Sunucular</span>
              <ChevronDown size={12} className="text-[#7c8dbb]" />
            </button>
            <button onClick={handleLeaveRoom} className="text-[#eac073] hover:text-[#ffb300] transition-all duration-300 p-2 hover:bg-[#eac07322] rounded-lg" title="Odadan çık">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Sunucu Paneli Overlay */}
        {showServerPanel && (
          <>
            <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowServerPanel(false)} />
            <div className="fixed right-0 top-0 bottom-0 z-50 w-72 bg-[#101320] border-l border-[#23253a] shadow-2xl flex flex-col animate-slideIn">
              <div className="flex items-center justify-between p-4 border-b border-[#23253a]">
                <h3 className="text-sm font-semibold text-[#e5eaff] flex items-center gap-2"><Server size={14} /> Sunucularım</h3>
                <button onClick={() => setShowServerPanel(false)} className="text-[#7c8dbb] hover:text-[#e5eaff] transition-colors"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {(getSavedUser()?.rooms || []).map((room: string) => (
                  <button
                    key={room}
                    onClick={async () => {
                      if (room !== serverName) {
                        await disconnect();
                        setServerName(room);
                        saveUser(nickname, room);
                        setPendingConnect(true);
                      }
                      setShowServerPanel(false);
                    }}
                    className={`w-full p-3 rounded-xl text-left transition-all duration-300 group ${
                      room === serverName
                        ? 'bg-gradient-to-r from-[#2ec8fa22] to-[#eac07322] border border-[#2ec8fa33]'
                        : 'bg-[#15182a] border border-[#23253a] hover:border-[#4dc9fa33]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#6a7bfd] to-[#2ec8fa] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {room.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className={`font-medium text-sm truncate ${room === serverName ? 'text-[#2ec8fa]' : 'text-[#e5eaff] group-hover:text-[#4dc9fa]'}`}>{room}</span>
                        {room === serverName && <span className="text-[10px] text-green-400">● Bağlı</span>}
                      </div>
                      {room !== serverName && <ChevronRight size={14} className="ml-auto text-[#7c8dbb] opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </div>
                  </button>
                ))}
              </div>
              <div className="p-3 border-t border-[#23253a]">
                <button 
                  onClick={() => { setShowServerPanel(false); handleLeaveRoom(); }}
                  className="w-full py-2 rounded-lg text-sm text-[#aab7e7] border border-[#23253a] hover:border-[#4dc9fa] hover:text-[#4dc9fa] transition-all"
                >
                  Yeni Sunucu
                </button>
              </div>
            </div>
          </>
        )}

        {/* Mobil Tab Bar */}
        <div className="lg:hidden flex border-b border-[#23253a] bg-[#101320ee]">
          <button onClick={() => setMobileTab('chat')} className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-all ${mobileTab === 'chat' ? 'text-[#4dc9fa] border-b-2 border-[#4dc9fa]' : 'text-[#7c8dbb]'}`}>
            <MessageCircle size={16} /> Sohbet
          </button>
          <button onClick={() => setMobileTab('participants')} className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-all ${mobileTab === 'participants' ? 'text-[#4dc9fa] border-b-2 border-[#4dc9fa]' : 'text-[#7c8dbb]'}`}>
            <Users size={16} /> Kişiler ({participants.length})
          </button>
          <button onClick={() => setMobileTab('music')} className={`flex-1 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-all ${mobileTab === 'music' ? 'text-[#4dc9fa] border-b-2 border-[#4dc9fa]' : 'text-[#7c8dbb]'}`}>
            <Music size={16} /> Müzik
          </button>
        </div>

        <main className="flex-1 flex flex-col lg:items-center lg:justify-center px-2 sm:px-4 py-2 sm:py-6 overflow-hidden">
          <div className="w-full max-w-7xl flex flex-col lg:grid lg:grid-cols-12 lg:gap-4 flex-1 lg:flex-initial">
            
            {/* Sol Sütun - Katılımcılar + Kontroller */}
            <div className={`lg:col-span-3 flex flex-col gap-2 ${mobileTab !== 'participants' ? 'hidden lg:flex' : 'flex'}`} style={{minHeight: 0}}>
              <div className="glass bg-gradient-to-br from-[#101320ee] to-[#23305b99] rounded-2xl shadow-2xl border border-[#23253a] p-3 flex-1 flex flex-col backdrop-blur-xl overflow-hidden" style={{minHeight: 0}}>
                <h3 className="text-sm font-semibold text-[#e5eaff] mb-2 tracking-tight select-none flex items-center gap-2 flex-shrink-0">
                  <Users size={14} />
                  <span>Katılımcılar</span>
                  <span className="text-[#2ec8fa] bg-[#2ec8fa22] px-2 py-0.5 rounded-full text-xs">{participants.length}</span>
                </h3>
                <div className="space-y-2 flex-1 overflow-y-auto scrollbar-thin" style={{minHeight: 0}}>
                  {/* Mevcut kullanıcı */}
                  {localParticipant && (
                    <div className="flex items-center justify-between p-2 bg-gradient-to-r from-[#2ec8fa22] to-[#eac07322] rounded-lg border border-[#2ec8fa33]">
                      <div className="flex items-center gap-2">
                        <div className={`relative w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm text-white shadow-lg bg-[#6a7bfd] transition-all duration-500 ${
                          localParticipant.isSpeaking ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-[#101320] scale-105' : ''
                        }`}>
                          {displayName(localParticipant.identity)?.charAt(0).toUpperCase()}
                          {localParticipant.isSpeaking && <div className="absolute inset-0 rounded-full bg-green-400 opacity-30 animate-pulse"></div>}
                          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center">
                            {isMuted ? (
                              <div className="w-full h-full bg-red-500 rounded-full flex items-center justify-center shadow-lg"><MicOff size={8} className="text-white" /></div>
                            ) : (
                              <div className={`w-full h-full rounded-full flex items-center justify-center shadow-lg ${localParticipant.isSpeaking ? 'bg-green-400' : 'bg-green-500'}`}><Mic size={8} className="text-white" /></div>
                            )}
                          </div>
                          {isDeafened && (
                            <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center shadow-lg"><VolumeX size={8} className="text-white" /></div>
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-[#eac073] text-xs">{displayName(localParticipant.identity)}</span>
                          {isPTTActive && <span className="text-[10px] text-green-400">🎙️ PTT Aktif</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-[#2ec8fa] font-medium bg-[#2ec8fa22] px-1.5 py-0.5 rounded-full">Sen</span>
                    </div>
                  )}
                  
                  {/* Diğer katılımcılar */}
                  {remoteParticipants.map((p) => {
                    const isRemoteMuted = !p.isMicrophoneEnabled;
                    return (
                    <div key={p.sid} className="flex flex-col gap-1 p-2 bg-[#15182a] rounded-lg border border-[#23253a] hover:border-[#4dc9fa33] transition-all duration-300 group">
                      <div className="flex items-center gap-2">
                        <div className={`relative w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm text-white shadow-lg bg-[#23305b] transition-all duration-500 ${
                          p.isSpeaking ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-[#101320] scale-105' : ''
                        }`}>
                          {displayName(p.identity)?.charAt(0).toUpperCase()}
                          {p.isSpeaking && <div className="absolute inset-0 rounded-full bg-green-400 opacity-30 animate-pulse"></div>}
                          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center">
                            {isRemoteMuted ? (
                              <div className="w-full h-full bg-red-500 rounded-full flex items-center justify-center shadow-lg"><MicOff size={8} className="text-white" /></div>
                            ) : (
                              <div className={`w-full h-full rounded-full flex items-center justify-center shadow-lg ${p.isSpeaking ? 'bg-green-400' : 'bg-green-500'}`}><Mic size={8} className="text-white" /></div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium text-[#e5eaff] group-hover:text-[#4dc9fa] transition-colors text-xs">{displayName(p.identity)}</span>
                          {isRemoteMuted && <span className="text-[10px] text-red-400">Mikrofon Kapalı</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-8">
                        <Volume2 size={10} className="text-[#aab7e7]" />
                        <Slider defaultValue={[100]} max={100} step={1} className="w-full" onValueChange={(value) => setParticipantVolume(p.identity, value[0])} />
                      </div>
                    </div>
                    );
                  })}
                </div>
                
                {/* Kontroller - inline dropdownlar VoiceControls içinde */}
                <div className="mt-3 flex-shrink-0">
                  <VoiceControls 
                    isMuted={isMuted} 
                    isDeafened={isDeafened} 
                    toggleMute={toggleMute} 
                    toggleDeafen={toggleDeafen}
                    pttEnabled={pttEnabled}
                    togglePTT={togglePTT}
                    isPTTActive={isPTTActive}
                    audioDevices={audioDevices}
                    audioOutputDevices={audioOutputDevices}
                    selectedAudioDevice={selectedAudioDevice}
                    selectedOutputDevice={selectedOutputDevice}
                    switchAudioDevice={switchAudioDevice}
                    switchOutputDevice={switchOutputDevice}
                    pttKey={pttKey}
                    setPTTKey={setPTTKey}
                  />
                </div>
              </div>

              {/* Ses Paneli */}
              <div className="flex-shrink-0">
                <SoundManager 
                  currentUser={musicPlayerUser}
                  roomId={serverName || 'default-room'}
                  userId={localParticipant?.identity || 'anonymous'}
                  isDeafened={isDeafened}
                />
              </div>
            </div>
            
            {/* Orta Sütun - Chat */}
            <div className={`lg:col-span-6 flex flex-col flex-1 ${mobileTab !== 'chat' ? 'hidden lg:flex' : 'flex'}`} style={{minHeight: 0}}>
              <ChatBox
                currentUser={currentUser}
                users={users}
                roomId={serverName || 'default-room'}
              />
            </div>
            
            {/* Sağ Sütun - Müzik */}
            <div className={`lg:col-span-3 flex flex-col gap-3 ${mobileTab !== 'music' ? 'hidden lg:flex' : 'flex'}`}>
              <MusicPlayer 
                currentUser={musicPlayerUser} 
                isMuted={isMuted}
                isDeafened={isDeafened}
                roomId={serverName || 'default-room'}
                userId={localParticipant?.identity || 'anonymous'}
              />
            </div>
          </div>
        </main>
      </div>
      
      <style>{`${baseStyles}${chatStyles}`}</style>
    </>
  );
}

// ========== STILLER ==========
const baseStyles = `
  .glass {
    background: rgba(22, 24, 40, 0.85);
    backdrop-filter: blur(18px) saturate(140%);
    box-shadow: 0 8px 32px 0 rgba(0,0,0,0.25);
    border-radius: 22px;
    border: 1.5px solid rgba(160, 160, 255, 0.12);
  }
  /* Animasyonlar kaldırıldı — sade görünüm */
  .fade-in { opacity: 1; }
  .fade-in-1, .fade-in-2, .fade-in-3 {}
  .logo-emoji { filter: drop-shadow(0 2px 24px #2ec8fa55); }
  .main-title { font-size: 2.5rem; font-weight: 600; letter-spacing: -0.04em; line-height: 1.13; }
  .btn-shine { border: 2px solid transparent; background: linear-gradient(#161828, #161828) padding-box, linear-gradient(90deg, #6a7bfd, #2ec8fa 80%) border-box; border-radius: 12px; transition: background 0.2s, box-shadow 0.2s; }
  .btn-shine:hover { background: linear-gradient(90deg,#556bff 20%,#2ec8fa 90%); box-shadow: 0 4px 24px 0 #3c5ddf44; color: #fff; }
  .btn-shine:disabled { opacity: 0.5; cursor: not-allowed; }
  .input-glow:focus { box-shadow: 0 0 0 2.5px #8fa7ff80, 0 0 8px 0 #2ec8fa55; border-color: #6a7bfd; outline: none; background: rgba(34,38,64,0.98); }
  @media (max-width: 500px) { .glass { max-width: 94vw; padding: 1.4rem 1rem; } .main-title { font-size: 2rem !important;} }
`;

const chatStyles = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  .animate-slideIn { animation: slideIn 0.3s ease-out; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .animate-fadeUp { animation: fadeUp 0.15s ease-out; }
  .scrollbar-thin { scrollbar-width: thin; }
  .scrollbar-thin::-webkit-scrollbar { width: 4px; }
  .scrollbar-thin::-webkit-scrollbar-thumb { background-color: #4dc9fa44; border-radius: 10px; }
  .scrollbar-thin::-webkit-scrollbar-track { background-color: transparent; }
`;
