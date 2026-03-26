import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { VoiceChatService } from '@/lib/livekit';
import { apiRequest } from '@/lib/queryClient';
import type { LiveKitTokenResponse } from '@shared/schema';
import { RemoteParticipant, LocalParticipant } from 'livekit-client';

export interface UseVoiceChatOptions {
  nickname: string;
  roomName?: string;
}

export interface VoiceChatState {
  isConnecting: boolean;
  isConnected: boolean;
  isReconnecting: boolean;
  participants: Array<LocalParticipant | RemoteParticipant>;
  isMuted: boolean;
  isDeafened: boolean;
  isPTTActive: boolean;
  pttEnabled: boolean;
  pttKey: string;
  connectionError: string | null;
  roomDuration: string;
  audioDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedAudioDevice: string;
  selectedOutputDevice: string;
}

export function useVoiceChat({ nickname, roomName = 'default-room' }: UseVoiceChatOptions) {
  const [state, setState] = useState<VoiceChatState>({
    isConnecting: false,
    isConnected: false,
    isReconnecting: false,
    participants: [],
    isMuted: false,
    isDeafened: false,
    isPTTActive: false,
    pttEnabled: false,
    pttKey: localStorage.getItem('goccord_ptt_key') || 'Space',
    connectionError: null,
    roomDuration: '00:00',
    audioDevices: [],
    audioOutputDevices: [],
    selectedAudioDevice: '',
    selectedOutputDevice: '',
  });

  const voiceChatRef = useRef<VoiceChatService | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pttKeyRef = useRef<string>(localStorage.getItem('goccord_ptt_key') || 'Space');
  const isPTTKeyDownRef = useRef<boolean>(false);

  const updateParticipants = useCallback(() => {
    if (voiceChatRef.current) {
      const participants = voiceChatRef.current.getParticipants();
      setState(prev => ({ ...prev, participants: [...participants] }));

      // Speaking event listener'larını düzgün ayarla
      voiceChatRef.current.setupSpeakingListeners(() => {
        const updatedParticipants = voiceChatRef.current?.getParticipants() || [];
        setState(prev => ({ ...prev, participants: [...updatedParticipants] }));
      });
    }
  }, []);

  const startDurationTimer = useCallback(() => {
    startTimeRef.current = new Date();
    durationIntervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const elapsed = Date.now() - startTimeRef.current.getTime();
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        setState(prev => ({
          ...prev,
          roomDuration: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        }));
      }
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    startTimeRef.current = null;
  }, []);

  // Ses cihazlarını yükle
  const loadAudioDevices = useCallback(async () => {
    try {
      const inputDevices = await VoiceChatService.getAudioDevices();
      const outputDevices = await VoiceChatService.getAudioOutputDevices();
      setState(prev => ({
        ...prev,
        audioDevices: inputDevices,
        audioOutputDevices: outputDevices,
        selectedAudioDevice: prev.selectedAudioDevice || (inputDevices[0]?.deviceId || ''),
        selectedOutputDevice: prev.selectedOutputDevice || (outputDevices[0]?.deviceId || ''),
      }));
    } catch (error) {
      console.error('Error loading audio devices:', error);
    }
  }, []);

  const connect = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;
    
    setState(prev => ({ ...prev, isConnecting: true, connectionError: null }));

    try {
      const response = await apiRequest('POST', '/api/auth', { nickname, roomName });
      const { token, wsUrl }: LiveKitTokenResponse = await response.json();

      voiceChatRef.current = new VoiceChatService();

      await voiceChatRef.current.connect({
        token,
        wsUrl,
        onParticipantConnected: () => updateParticipants(),
        onParticipantDisconnected: () => updateParticipants(),
        onConnectionStateChanged: (connectionState) => {
          const isConnected = connectionState === 'connected';
          setState(prev => ({ ...prev, isConnected }));
          if (isConnected) {
            startDurationTimer();
            updateParticipants();
          }
        },
        onReconnecting: () => {
          setState(prev => ({ ...prev, isReconnecting: true }));
        },
        onReconnected: () => {
          setState(prev => ({ ...prev, isReconnecting: false }));
          updateParticipants();
        },
        onTrackMuteChanged: () => {
          // Diger kisiler mic actığında/kapattığında katılımcı listesini güncelle
          updateParticipants();
        },
        onError: (error) => {
          setState(prev => ({ ...prev, connectionError: `Bağlantı hatası: ${error.message}`, isConnecting: false }));
        },
      });

      if (voiceChatRef.current) {
        await voiceChatRef.current.publishAudio(state.selectedAudioDevice || undefined);
        updateParticipants();
      }

      // Ses cihazlarını yükle
      await loadAudioDevices();

      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        isMuted: voiceChatRef.current?.isMuted() || false,
      }));

    } catch (error) {
      let errorMessage = 'Bağlantı başarısız';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      setState(prev => ({ ...prev, isConnecting: false, connectionError: errorMessage }));
    }
  }, [nickname, roomName, state.isConnecting, state.isConnected, state.selectedAudioDevice, updateParticipants, startDurationTimer, loadAudioDevices]);

  const disconnect = useCallback(async () => {
    if (voiceChatRef.current) {
      try {
        await voiceChatRef.current.disconnect();
      } catch (error) {
        console.error('Error disconnecting:', error);
      }
      voiceChatRef.current = null;
    }

    stopDurationTimer();
    
    setState(prev => ({ 
      ...prev, 
      isConnected: false, 
      isConnecting: false,
      isReconnecting: false,
      participants: [],
      connectionError: null 
    }));
  }, [stopDurationTimer]);

  const toggleMute = useCallback(async () => {
    if (!voiceChatRef.current) return;

    try {
      const newMutedState = !voiceChatRef.current.isMuted();
      await voiceChatRef.current.setMicrophoneEnabled(!newMutedState);
      setState(prev => ({ ...prev, isMuted: newMutedState }));
    } catch (error) {
      console.error('Error toggling mute:', error);
    }
  }, []);

  const toggleDeafen = useCallback(async () => {
    if (!voiceChatRef.current) return;

    try {
      const newDeafenedState = !state.isDeafened;
      voiceChatRef.current.setAllParticipantsMuted(newDeafenedState);
      
      if (newDeafenedState) {
        await voiceChatRef.current.setMicrophoneEnabled(false);
        setState(prev => ({ ...prev, isMuted: true, isDeafened: true }));
      } else {
        setState(prev => ({ ...prev, isDeafened: false }));
      }
    } catch (error) {
      console.error('Error toggling deafen:', error);
    }
  }, [state.isDeafened]);

  // Push-to-Talk
  const togglePTT = useCallback(() => {
    setState(prev => {
      const newPTTEnabled = !prev.pttEnabled;
      // PTT açıldığında mikrofonu kapat, kullanıcı tuşa basınca açılacak
      if (newPTTEnabled && voiceChatRef.current) {
        voiceChatRef.current.setMicrophoneEnabled(false);
      }
      return { ...prev, pttEnabled: newPTTEnabled, isMuted: newPTTEnabled };
    });
  }, []);

  // PTT tuş dinleyicileri
  useEffect(() => {
    if (!state.pttEnabled || !state.isConnected) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.code === pttKeyRef.current && !isPTTKeyDownRef.current) {
        e.preventDefault();
        isPTTKeyDownRef.current = true;
        if (voiceChatRef.current) {
          await voiceChatRef.current.setMicrophoneEnabled(true);
          setState(prev => ({ ...prev, isMuted: false, isPTTActive: true }));
        }
      }
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      if (e.code === pttKeyRef.current && isPTTKeyDownRef.current) {
        e.preventDefault();
        isPTTKeyDownRef.current = false;
        if (voiceChatRef.current) {
          await voiceChatRef.current.setMicrophoneEnabled(false);
          setState(prev => ({ ...prev, isMuted: true, isPTTActive: false }));
        }
      }
    };

    // Pencere odağı kaybedince PTT'yi otomatik bırak
    // (tarayıcı dışındayken keyup event'i gelmez, mikrofon takılı kalabilir)
    const releasePTT = async () => {
      if (isPTTKeyDownRef.current) {
        isPTTKeyDownRef.current = false;
        if (voiceChatRef.current) {
          await voiceChatRef.current.setMicrophoneEnabled(false);
          setState(prev => ({ ...prev, isMuted: true, isPTTActive: false }));
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);
    
    // Pencere odağı kaybı — alt+tab, başka uygulama vb.
    window.addEventListener('blur', releasePTT);
    // Sekme gizlenince (minimize, sekme değiştirme)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') releasePTT();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', releasePTT);
    };
  }, [state.pttEnabled, state.isConnected]);

  // Ses cihazı değiştirme
  const switchAudioDevice = useCallback(async (deviceId: string) => {
    setState(prev => ({ ...prev, selectedAudioDevice: deviceId }));
    if (voiceChatRef.current) {
      try {
        await voiceChatRef.current.switchAudioDevice(deviceId);
      } catch (error) {
        console.error('Error switching audio device:', error);
      }
    }
  }, []);

  // Çıkış cihazı değiştirme
  const switchOutputDevice = useCallback(async (deviceId: string) => {
    setState(prev => ({ ...prev, selectedOutputDevice: deviceId }));
    // TODO: LiveKit Room.switchActiveDevice ile entegre edilebilir
    // Şimdilik tüm audio element'lerin sinkId'sini değiştir
    try {
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach((el: any) => {
        if (el.setSinkId) {
          el.setSinkId(deviceId);
        }
      });
    } catch (error) {
      console.error('Error switching output device:', error);
    }
  }, []);

  // PTT tuşu değiştirme
  const setPTTKey = useCallback((keyCode: string) => {
    pttKeyRef.current = keyCode;
    localStorage.setItem('goccord_ptt_key', keyCode);
    setState(prev => ({ ...prev, pttKey: keyCode }));
  }, []);

  const setParticipantVolume = useCallback((participantIdentity: string, volume: number) => {
    if (voiceChatRef.current) {
      voiceChatRef.current.setParticipantVolume(participantIdentity, volume);
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Cihaz değişikliklerini dinle
  useEffect(() => {
    const handler = () => loadAudioDevices();
    navigator.mediaDevices?.addEventListener('devicechange', handler);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handler);
    };
  }, [loadAudioDevices]);

  const returnValue = useMemo(() => ({
    ...state,
    connect,
    disconnect,
    toggleMute,
    toggleDeafen,
    togglePTT,
    setPTTKey,
    switchAudioDevice,
    switchOutputDevice,
    setParticipantVolume,
    loadAudioDevices,
  }), [state, connect, disconnect, toggleMute, toggleDeafen, togglePTT, setPTTKey, switchAudioDevice, switchOutputDevice, setParticipantVolume, loadAudioDevices]);

  return returnValue;
}
