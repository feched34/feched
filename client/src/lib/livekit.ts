import {
  Room,
  RoomEvent,
  RemoteParticipant,
  LocalParticipant,
  LocalAudioTrack,
  createLocalAudioTrack,
  ConnectionState,
  RemoteTrackPublication,
  RemoteTrack,
  Track,
  RemoteAudioTrack,
} from 'livekit-client';
import { KrispNoiseFilter, isKrispNoiseFilterSupported } from '@livekit/krisp-noise-filter';

export interface VoiceChatOptions {
  token: string;
  wsUrl: string;
  onParticipantConnected?: (participant: RemoteParticipant) => void;
  onParticipantDisconnected?: (participant: RemoteParticipant) => void;
  onConnectionStateChanged?: (state: string) => void;
  onError?: (error: Error) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onTrackMuteChanged?: () => void;
}

export class VoiceChatService {
  private room: Room;
  private audioTrack: LocalAudioTrack | null = null;
  private localParticipant: LocalParticipant | null = null;
  private speakingListeners: Map<string, () => void> = new Map();
  private connectOptions: VoiceChatOptions | null = null;
  private audioContext: AudioContext | null = null;
  private noiseGateStream: MediaStream | null = null;

  constructor() {
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
      },
      publishDefaults: {
        dtx: true,      // sessizlikte bandwidth tasarrufu
        red: true,      // paket kaybında ses kalitesi
      },
      reconnectPolicy: {
        nextRetryDelayInMs: (context) => {
          // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
          if (context.retryCount > 7) return null; // 7 denemeden sonra dur
          return Math.min(1000 * Math.pow(2, context.retryCount), 10000);
        }
      }
    });
  }

  async connect(options: VoiceChatOptions): Promise<void> {
    this.connectOptions = options;

    try {
      // Event listener'ları temizle (varsa)
      this.removeAllListeners();

      // Participant connected/disconnected
      if (options.onParticipantConnected) {
        this.room.on(RoomEvent.ParticipantConnected, options.onParticipantConnected);
      }
      if (options.onParticipantDisconnected) {
        this.room.on(RoomEvent.ParticipantDisconnected, options.onParticipantDisconnected);
      }

      // Connection state
      this.room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        options.onConnectionStateChanged?.(state.toString());
        if (state === ConnectionState.Connected) {
          this.localParticipant = this.room.localParticipant;
        }
      });

      // Auto reconnect events
      this.room.on(RoomEvent.Reconnecting, () => {
        console.log('🔄 LiveKit reconnecting...');
        options.onReconnecting?.();
      });

      this.room.on(RoomEvent.Reconnected, () => {
        console.log('✅ LiveKit reconnected');
        this.localParticipant = this.room.localParticipant;
        options.onReconnected?.();
      });

      // Audio track auto-attach
      this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach();
          element.style.display = 'none';
          document.body.appendChild(element);
        }
      });

      this.room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach(el => el.remove());
        }
      });

      // Handle browser autoplay policy
      this.room.on(RoomEvent.AudioPlaybackStatusChanged, (status) => {
        if (!status) {
          console.log('Audio playback is blocked by browser. Waiting for user interaction.');
          const unlockAudio = async () => {
            try {
              await this.room.startAudio();
              console.log('Audio unlocked automatically after interaction');
            } catch (err) {
              console.warn('Failed to unlock audio:', err);
            }
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
          };
          document.addEventListener('click', unlockAudio);
          document.addEventListener('touchstart', unlockAudio);
          document.addEventListener('keydown', unlockAudio);
        }
      });

      // Track mute/unmute - diğer kişiler susturduğunda anlık görünsün
      this.room.on(RoomEvent.TrackMuted, () => {
        options.onTrackMuteChanged?.();
      });
      this.room.on(RoomEvent.TrackUnmuted, () => {
        options.onTrackMuteChanged?.();
      });

      // Disconnected event
      this.room.on(RoomEvent.Disconnected, (reason) => {
        console.log('📴 LiveKit disconnected, reason:', reason);
      });

      await this.room.connect(options.wsUrl, options.token);
      this.localParticipant = this.room.localParticipant;

      // Ensure already subscribed tracks (from participants existing in the room) are attached
      this.room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.isSubscribed && pub.track && pub.track.kind === Track.Kind.Audio) {
            const track = pub.track;
            // Only attach if it's not already attached to avoid playing twice
            if (track.attachedElements.length === 0) {
              const element = track.attach();
              element.style.display = 'none';
              document.body.appendChild(element);
            }
          }
        });
      });
      
      // Try resolving autoplay block immediately if possible
      try {
        await this.room.startAudio();
      } catch (err) {
        console.warn('startAudio failed (autoplay policy):', err);
      }
    } catch (error) {
      console.error('Failed to connect to voice chat:', error);
      options.onError?.(error as Error);
      throw error;
    }
  }

  private removeAllListeners(): void {
    this.room.removeAllListeners();
    // Speaking listener'ları temizle
    this.speakingListeners.clear();
  }
  
  async publishAudio(deviceId?: string): Promise<void> {
    try {
      if (!this.localParticipant) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (!this.localParticipant) {
          console.error('Cannot publish audio: localParticipant is null');
          return;
        }
      }

      // Use browser-native noise suppression + echo cancellation.
      // Web Audio API pipeline breaks Chrome's echo cancellation, so we rely
      // on the browser's built-in processing which handles echo properly.
      const trackOptions: any = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      };

      if (deviceId) {
        trackOptions.deviceId = deviceId;
      }

      this.audioTrack = await createLocalAudioTrack(trackOptions);

      // Krisp'i track'e uygula (pipeline değil, doğrudan track processor olarak)
      if (isKrispNoiseFilterSupported()) {
        try {
          const krispProcessor = KrispNoiseFilter();
          await this.audioTrack.setProcessor(krispProcessor);
          console.log('✅ Krisp aktif');
        } catch (krispError) {
          console.warn('⚠️ Krisp yüklenemedi, browser filtrelerine devam:', krispError);
        }
      } else {
        console.warn('⚠️ Krisp bu tarayıcıda desteklenmiyor');
      }
      
      await this.localParticipant.publishTrack(this.audioTrack);
    } catch (error) {
      console.error('Failed to publish audio:', error);
      throw error;
    }
  }

  async switchAudioDevice(deviceId: string): Promise<void> {
    // Clean up existing audio pipeline
    if (this.audioTrack) {
      // Processor'ı temizle
      await this.audioTrack.setProcessor(null as any).catch(() => {});
      this.audioTrack.stop();
      if (this.localParticipant) {
        await this.localParticipant.unpublishTrack(this.audioTrack);
      }
      this.audioTrack = null;
    }
    this.cleanupAudioPipeline();
    // Rebuild with new device
    await this.publishAudio(deviceId);
  }

  private cleanupAudioPipeline(): void {
    if (this.noiseGateStream) {
      this.noiseGateStream.getTracks().forEach(t => t.stop());
      this.noiseGateStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  async disconnect(): Promise<void> {
    this.removeAllListeners();
    
    if (this.audioTrack) {
      this.audioTrack.stop();
      this.localParticipant?.unpublishTrack(this.audioTrack);
      this.audioTrack = null;
    }
    this.cleanupAudioPipeline();
    await this.room.disconnect();
    this.localParticipant = null;
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    // Hem LocalParticipant (LiveKit signaling) hem track düzeyinde mute/unmute
    if (this.localParticipant) {
      await this.localParticipant.setMicrophoneEnabled(enabled);
    }
    // audioTrack üzerinden de doğrudan kontrol et (PTT için kritik)
    if (this.audioTrack) {
      if (enabled) {
        await this.audioTrack.unmute();
      } else {
        await this.audioTrack.mute();
      }
    }
  }

  setAllParticipantsMuted(muted: boolean): void {
    this.room.remoteParticipants.forEach(p => {
      p.trackPublications.forEach((t: RemoteTrackPublication) => {
        if (t.track && t.kind === Track.Kind.Audio) {
          const audioTrack = t.track as RemoteAudioTrack;
          audioTrack.setVolume(muted ? 0 : 1);
        }
      });
    });
  }

  setParticipantVolume(participantIdentity: string, volume: number): void {
    const participant = this.room.getParticipantByIdentity(participantIdentity);
    if (participant && participant instanceof RemoteParticipant) {
      participant.trackPublications.forEach((t: RemoteTrackPublication) => {
        if (t.track && t.kind === Track.Kind.Audio) {
          const audioTrack = t.track as RemoteAudioTrack;
          audioTrack.setVolume(volume / 100);
        }
      });
    }
  }

  // Speaking event listener'ları düzgün yönet
  setupSpeakingListeners(onSpeakingChanged: () => void): void {
    // Önce eski listener'ları temizle
    this.cleanupSpeakingListeners();

    // Remote participant'lar için listener ekle
    this.room.remoteParticipants.forEach((p) => {
      const handler = () => onSpeakingChanged();
      p.on('isSpeakingChanged' as any, handler);
      this.speakingListeners.set(p.identity, handler);
    });
  }

  cleanupSpeakingListeners(): void {
    this.room.remoteParticipants.forEach((p) => {
      const handler = this.speakingListeners.get(p.identity);
      if (handler) {
        p.off('isSpeakingChanged' as any, handler);
      }
    });
    this.speakingListeners.clear();
  }

  getParticipants(): Array<LocalParticipant | RemoteParticipant> {
    const participants: Array<LocalParticipant | RemoteParticipant> = [];
    
    if (this.localParticipant) {
      participants.push(this.localParticipant);
    } else if (this.room.localParticipant) {
      participants.push(this.room.localParticipant);
    }
    
    participants.push(...Array.from(this.room.remoteParticipants.values()));
    return participants;
  }

  isMuted(): boolean {
    // audioTrack varsa onun durumuna bak, yoksa localParticipant'a bak
    if (this.audioTrack) {
      return this.audioTrack.isMuted;
    }
    return this.localParticipant?.isMicrophoneEnabled === false;
  }

  // Ses cihazlarını listele
  static async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    try {
      // İzin iste (cihaz listesi için gerekli)
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(t => t.stop());
      });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (error) {
      console.error('Error getting audio devices:', error);
      return [];
    }
  }

  // Ses çıkış cihazlarını listele
  static async getAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audiooutput');
    } catch (error) {
      console.error('Error getting audio output devices:', error);
      return [];
    }
  }
}
