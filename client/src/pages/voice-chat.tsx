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
import { Volume2, Mic, MicOff, VolumeX } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export default function VoiceChat() {
  const [currentScreen, setCurrentScreen] = useState<'join' | 'chat'>('join');
  const [nickname, setNickname] = useState('');
  const [showError, setShowError] = useState(false);

  const {
    isConnecting,
    isConnected,
    participants,
    isMuted,
    isDeafened,
    connectionError,
    roomDuration,
    connect,
    disconnect,
    toggleMute,
    toggleDeafen,
    setParticipantVolume,
  } = useVoiceChat({ nickname });

  // ParticlesLoader'ı memoize et
  const particlesComponent = useMemo(() => <ParticlesLoader />, []);

  // Handle form submission - useCallback ile optimize et
  const handleJoinRoom = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('=== HANDLE JOIN ROOM START ===');
    console.log('Nickname:', nickname);
    
    if (!nickname.trim()) {
      console.log('Nickname is empty, returning');
      return;
    }
    
    console.log('Calling connect()...');
    await connect();
    console.log('=== HANDLE JOIN ROOM END ===');
  }, [nickname, connect]);

  // Handle leaving room - useCallback ile optimize et
  const handleLeaveRoom = useCallback(async () => {
    await disconnect();
    setCurrentScreen('join');
    setNickname('');
  }, [disconnect]);

  // Show error modal when there's a connection error
  useEffect(() => {
    console.log('Connection error changed:', connectionError);
    if (connectionError) {
      setShowError(true);
    }
  }, [connectionError]);

  // Switch to chat screen when connected
  useEffect(() => {
    console.log('isConnected changed:', isConnected);
    if (isConnected) {
      console.log('Switching to chat screen');
      setCurrentScreen('chat');
    }
  }, [isConnected]);

  // Get current user from participants - memoize et
  const { localParticipant, remoteParticipants } = useMemo(() => {
    const local = participants.find(p => p instanceof LocalParticipant);
    const remote = participants.filter(p => p instanceof RemoteParticipant);
    return { localParticipant: local, remoteParticipants: remote };
  }, [participants]);

  // Generate participant avatar color - memoize et
  const getAvatarColor = useCallback((name: string) => {
    const colors = ['bg-purple-500', 'bg-green-500', 'bg-orange-500', 'bg-blue-500', 'bg-red-500', 'bg-yellow-500'];
    const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return colors[index];
  }, []);

  // Error modal handlers - useCallback ile optimize et
  const handleRetry = useCallback(() => {
    setShowError(false);
    connect();
  }, [connect]);

  const handleCloseError = useCallback(() => {
    setShowError(false);
  }, []);

  // Current user for ChatBox - memoize et
  const currentUser = useMemo(() => ({
    id: localParticipant?.identity || '0',
    name: localParticipant?.identity || 'Anonim',
    avatar: '/logo.png'
  }), [localParticipant?.identity]);

  // Users for ChatBox - memoize et
  const users = useMemo(() => 
    participants.map(p => ({ 
      id: p.identity, 
      name: p.identity, 
      avatar: '/logo.png' 
    })), [participants]
  );

  // Current user for MusicPlayer - memoize et
  const musicPlayerUser = useMemo(() => 
    localParticipant ? { full_name: localParticipant.identity } : null, 
    [localParticipant?.identity]
  );

  if (currentScreen === 'join') {
    return (
      <>
        {/* Arka plan rengi */}
        <div style={{position:'fixed', inset:0, zIndex:0, background:'#141628'}} />
        {particlesComponent}
        <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
          <main className="glass max-w-md w-full flex flex-col relative border-[#23253a] border pt-10 pr-10 pb-10 pl-10 shadow-2xl items-center" style={{background:'#101320'}}>
            {/* Logo (büyük, daire içinde, yakınlaştırılmış) */}
            <div className="fade-in fade-in-1 flex w-32 h-32 border-[#23305b33] logo-emoji bg-gradient-to-tr from-[#eac073aa] to-[#4dc9fa88] border rounded-full mb-7 items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="Logo" className="w-32 h-32 object-cover scale-125" />
            </div>
            {/* Başlık */}
            <h2 className="main-title fade-in fade-in-2 text-white font-semibold tracking-tight text-center leading-tight mb-2 select-none text-[2.5rem]" style={{letterSpacing:'-0.04em',lineHeight:'1.13'}}>Gocccuuum Hoşgeldin</h2>
            <div className="divider" style={{height:1, background:'linear-gradient(90deg, transparent, #23305b 35%, #2ec8fa66 65%, transparent)', opacity:0.3, margin:'28px 0'}}></div>
            {/* Form */}
            <form className="fade-in fade-in-3 w-full flex flex-col gap-6" autoComplete="off" onSubmit={handleJoinRoom}>
              <label className="w-full">
                <span className="block text-sm font-medium text-[#aab7e7] mb-2 pl-1">Takma Ad (Nickname)</span>
                <input
                  required
                  spellCheck={false}
                  name="nickname"
                  maxLength={22}
                  placeholder="Nickini giriver gocum buraya"
                  className="input-glow w-full bg-[#15182a] text-[1.15rem] placeholder-[#7c8dbb] transition focus:ring-0 outline-none font-medium text-[#e5eaff] border-[#23253a] border rounded-lg pt-3 pr-5 pb-3 pl-5"
                  autoComplete="off"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  id="nickname"
                  style={{boxShadow: 'none'}}
                />
              </label>
              <button type="submit" className="btn-shine w-full py-3 rounded-xl flex items-center justify-center gap-2 text-lg font-semibold tracking-tight text-[#e4eaff] shadow-lg transition cursor-pointer select-none group relative overflow-hidden" disabled={!nickname.trim()}>
                <span>Giriş Yap</span>
              </button>
            </form>
          </main>
        </div>
        <LoadingOverlay isVisible={isConnecting} />
        <ErrorModal 
          isVisible={showError}
          message={connectionError || ""}
          onRetry={handleRetry}
          onClose={handleCloseError}
        />
        {/* Stil ve animasyonlar için ek CSS */}
        <style>{`
          .glass {
            background: rgba(22, 24, 40, 0.85);
            backdrop-filter: blur(18px) saturate(140%);
            box-shadow: 0 8px 32px 0 rgba(0,0,0,0.25);
            border-radius: 22px;
            border: 1.5px solid rgba(160, 160, 255, 0.12);
          }
          .fade-in { opacity: 0; transform: translateY(20px) scale(0.98); animation: fadeInUp 0.8s forwards; }
          .fade-in-1 { animation-delay: 0.15s; }
          .fade-in-2 { animation-delay: 0.3s; }
          .fade-in-3 { animation-delay: 0.45s; }
          @keyframes fadeInUp { to { opacity: 1; transform: translateY(0) scale(1); } }
          .logo-emoji { animation: popIn 0.9s cubic-bezier(.21,1.5,.39,1) both; filter: drop-shadow(0 2px 24px #2ec8fa55); }
          @keyframes popIn { 0% { opacity: 0; transform: scale(0.7) rotate(-22deg); } 80% { opacity: 1; transform: scale(1.08) rotate(5deg);} 100% { opacity: 1; transform: scale(1) rotate(0);} }
          .main-title { font-size: 2.5rem; font-weight: 600; letter-spacing: -0.04em; line-height: 1.13; }
          .btn-shine { border: 2px solid transparent; background: linear-gradient(#161828, #161828) padding-box, linear-gradient(90deg, #6a7bfd, #2ec8fa 80%) border-box; border-radius: 12px; transition: background 0.24s, box-shadow 0.24s; }
          .btn-shine:hover { background: linear-gradient(90deg,#556bff 20%,#2ec8fa 90%); box-shadow: 0 4px 24px 0 #3c5ddf44; color: #fff; outline: 2px solid #2ec8fa80; }
          .input-glow:focus { box-shadow: 0 0 0 2.5px #8fa7ff80, 0 0 8px 0 #2ec8fa55; border-color: #6a7bfd; outline: none; background: rgba(34,38,64,0.98); transition: box-shadow 0.25s, background 0.25s; }
          @media (max-width: 500px) { .glass { max-width: 94vw; padding: 1.6rem 1.1rem; } .main-title { font-size: 2rem !important;} }
        `}</style>
      </>
    );
  }

  // GİRİŞ EKRANI TEMASINA UYGUN SOHBET EKRANI
  return (
    <>
      {/* Koyu arka plan ve particles animasyonu */}
      <div style={{position:'fixed', inset:0, zIndex:0, background:'#141628'}} />
      {particlesComponent}
      <div className="min-h-screen flex flex-col relative z-10">
        {/* Header */}
        <header className="glass flex items-center justify-between px-8 py-4 border-b border-[#23253a] shadow-lg backdrop-blur-xl" style={{background:'rgba(16,19,32,0.95)'}}>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 border-2 border-[#23305b33] rounded-full bg-gradient-to-tr from-[#eac073aa] to-[#4dc9fa88] items-center justify-center overflow-hidden animate-pulse">
              <img src="/logo.png" alt="Logo" className="w-12 h-12 object-cover scale-110" />
            </div>
            <h1 className="text-2xl font-bold text-[#e5eaff] tracking-tight select-none drop-shadow animate-fade-in">Goccord</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center px-4 py-1 bg-[#2ec8fa22] text-[#2ec8fa] rounded-full text-sm font-medium shadow-sm border border-[#2ec8fa33] animate-pulse">
              <div className="w-2 h-2 bg-success rounded-full mr-2 animate-pulse"></div>
              Bağlı
            </div>
            <span className="text-[#aab7e7] text-base animate-fade-in">Merhaba, <span className="font-semibold text-[#eac073]">{nickname}</span></span>
            <button 
              onClick={handleLeaveRoom}
              className="text-[#eac073] hover:text-[#ffb300] transition-all duration-300 text-xl hover:scale-110 transform"
              title="Odadan çık"
            >
              <i className="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
          <div className="w-full max-w-7xl grid grid-cols-12 gap-8 animate-fade-in-up">
            {/* Katılımcı Listesi - Sol sütun */}
            <div className="col-span-12 lg:col-span-3 flex flex-col gap-6">
              {/* Katılımcılar Paneli - Üst */}
              <div className="glass bg-gradient-to-br from-[#101320ee] to-[#23305b99] rounded-2xl shadow-2xl border border-[#23253a] p-3 flex-1 flex flex-col backdrop-blur-xl hover:shadow-[#4dc9fa22] transition-all duration-500">
                <h3 className="text-base font-semibold text-[#e5eaff] mb-3 tracking-tight select-none flex items-center gap-2">
                  <span>Katılımcılar</span>
                  <span className="text-[#2ec8fa] bg-[#2ec8fa22] px-2 py-0.5 rounded-full text-xs">({participants.length})</span>
                </h3>
                <div className="space-y-2 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4dc9fa] scrollbar-track-[#15182a]">
                  {/* Mevcut kullanıcı */}
                  {localParticipant && (
                    <div className="flex items-center justify-between p-2 bg-gradient-to-r from-[#2ec8fa22] to-[#eac07322] rounded-lg border border-[#2ec8fa33] hover:border-[#2ec8fa66] transition-all duration-300 hover:shadow-lg hover:shadow-[#2ec8fa22]">
                      <div className="flex items-center gap-2">
                        <div className={`relative w-8 h-8 rounded-full flex items-center justify-center font-bold text-base text-white shadow-lg bg-[#6a7bfd] transition-all duration-500 ${
                          localParticipant.isSpeaking 
                            ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-[#101320] speaking-avatar scale-105' 
                            : 'hover:scale-105 ring-2 ring-transparent'
                        }`}>
                          {localParticipant.identity?.charAt(0).toUpperCase()}
                          {/* Konuşma animasyonu */}
                          {localParticipant.isSpeaking && (
                            <div className="absolute inset-0 rounded-full speaking-ping bg-green-400"></div>
                          )}
                          {/* Mikrofon durumu belirteci */}
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs">
                            {isMuted ? (
                              <div className="w-full h-full bg-red-500 rounded-full flex items-center justify-center shadow-lg">
                                <MicOff size={10} className="text-white" />
                              </div>
                            ) : (
                              <div className={`w-full h-full rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
                                localParticipant.isSpeaking 
                                  ? 'bg-green-400 scale-105 speaking-mic' 
                                  : 'bg-green-500'
                              }`}>
                                <Mic size={10} className="text-white" />
                              </div>
                            )}
                          </div>
                          {/* Deafen durumu belirteci */}
                          {isDeafened && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center shadow-lg">
                              <VolumeX size={10} className="text-white" />
                            </div>
                          )}
                        </div>
                        <span className="font-semibold text-[#eac073] text-sm">{localParticipant.identity}</span>
                      </div>
                      <span className="text-xs text-[#2ec8fa] font-medium bg-[#2ec8fa22] px-1.5 py-0.5 rounded-full">Sen</span>
                    </div>
                  )}
                  {/* Diğer katılımcılar */}
                  {remoteParticipants.map((p) => (
                    <div key={p.sid} className="flex flex-col gap-1 p-2 bg-[#15182a] rounded-lg border border-[#23253a] hover:border-[#4dc9fa33] transition-all duration-300 hover:shadow-lg hover:shadow-[#4dc9fa22] group">
                      <div className="flex items-center gap-2">
                        <div className={`relative w-8 h-8 rounded-full flex items-center justify-center font-bold text-base text-white shadow-lg bg-[#23305b] transition-all duration-500 ${
                          p.isSpeaking 
                            ? 'ring-2 ring-green-400 ring-offset-1 ring-offset-[#101320] speaking-avatar scale-105' 
                            : 'group-hover:scale-105 ring-2 ring-transparent'
                        }`}>
                          {p.identity?.charAt(0).toUpperCase()}
                          {/* Konuşma animasyonu */}
                          {p.isSpeaking && (
                            <div className="absolute inset-0 rounded-full speaking-ping bg-green-400"></div>
                          )}
                          {/* Mikrofon durumu belirteci - varsayılan olarak açık */}
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs">
                            <div className={`w-full h-full rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
                              p.isSpeaking 
                                ? 'bg-green-400 scale-105 speaking-mic' 
                                : 'bg-green-500'
                            }`}>
                              <Mic size={10} className="text-white" />
                            </div>
                          </div>
                        </div>
                        <span className="font-medium text-[#e5eaff] group-hover:text-[#4dc9fa] transition-colors text-sm">{p.identity}</span>
                      </div>
                      <div className="flex items-center gap-2 pl-8">
                        <Volume2 size={12} className="text-[#aab7e7] group-hover:text-[#4dc9fa] transition-colors" />
                        <Slider 
                          defaultValue={[100]} 
                          max={100} 
                          step={1} 
                          className="w-full" 
                          onValueChange={(value) => setParticipantVolume(p.identity, value[0])}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {/* VoiceControls en alta */}
                <div className="mt-4">
                  <VoiceControls isMuted={isMuted} isDeafened={isDeafened} toggleMute={toggleMute} toggleDeafen={toggleDeafen} />
                </div>
              </div>
              
              {/* Ses Paneli - Alt */}
              <SoundManager 
                currentUser={musicPlayerUser}
                roomId="default-room"
                userId={localParticipant?.identity || 'anonymous'}
                isDeafened={isDeafened}
              />
            </div>
            
            {/* ChatBox - Ortada, büyük ve merkezi */}
            <div className="col-span-12 lg:col-span-6 flex flex-col flex-1">
                <ChatBox
                  currentUser={currentUser}
                  users={users}
                  roomId="default-room"
                />
            </div>
            
            {/* Sağ sütun - Müzik Çalar ve Ses Paneli */}
            <div className="col-span-12 lg:col-span-3 flex flex-col gap-6">
                {/* Müzik Çalar - Üst */}
                <MusicPlayer 
                  currentUser={musicPlayerUser} 
                  isMuted={isMuted}
                  isDeafened={isDeafened}
                  roomId="default-room"
                  userId={localParticipant?.identity || 'anonymous'}
                />
            </div>
          </div>
        </main>
      </div>
      {/* Stil ve animasyonlar için ek CSS */}
      <style>{`
        .glass {
          background: rgba(22, 24, 40, 0.85);
          backdrop-filter: blur(18px) saturate(140%);
          box-shadow: 0 8px 32px 0 rgba(0,0,0,0.25);
          border-radius: 22px;
          border: 1.5px solid rgba(160, 160, 255, 0.12);
        }
        
        .animate-fade-in {
          animation: fadeIn 0.8s ease-out;
        }
        
        .animate-fade-in-up {
          animation: fadeInUp 1s ease-out;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes fadeInUp {
          from { 
            opacity: 0; 
            transform: translateY(30px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }
        
        /* Smooth konuşma animasyonları */
        @keyframes speakingGlow {
          0% {
            box-shadow: 0 0 20px rgba(34, 197, 94, 0.6);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 0 30px rgba(34, 197, 94, 0.8);
            transform: scale(1.05);
          }
          100% {
            box-shadow: 0 0 20px rgba(34, 197, 94, 0.6);
            transform: scale(1);
          }
        }
        
        @keyframes speakingPulse {
          0% {
            opacity: 0.2;
            transform: scale(1);
          }
          50% {
            opacity: 0.4;
            transform: scale(1.1);
          }
          100% {
            opacity: 0.2;
            transform: scale(1);
          }
        }
        
        @keyframes micGlow {
          0% {
            box-shadow: 0 0 8px rgba(34, 197, 94, 0.8);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 0 12px rgba(34, 197, 94, 1);
            transform: scale(1.1);
          }
          100% {
            box-shadow: 0 0 8px rgba(34, 197, 94, 0.8);
            transform: scale(1);
          }
        }
        
        .speaking-avatar {
          animation: speakingGlow 2s ease-in-out infinite;
        }
        
        .speaking-ping {
          animation: speakingPulse 1.5s ease-in-out infinite;
        }
        
        .speaking-mic {
          animation: micGlow 1.5s ease-in-out infinite;
        }
        
        .scrollbar-thin {
          scrollbar-width: thin;
        }
        
        .scrollbar-thumb-[#4dc9fa]::-webkit-scrollbar-thumb {
          background-color: #4dc9fa;
          border-radius: 10px;
        }
        
        .scrollbar-track-[#15182a]::-webkit-scrollbar-track {
          background-color: #15182a;
          border-radius: 10px;
        }
        
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }
      `}</style>
    </>
  );
}
