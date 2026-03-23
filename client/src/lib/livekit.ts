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
      this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          track.attach();
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
  
  /**
   * Publish audio with enhanced noise suppression.
   * Pipeline: Mic → High-pass filter (85Hz) → Compressor (noise gate) → LiveKit
   * This aggressively filters keyboard clicks, eating sounds, background video, etc.
   */
  async publishAudio(deviceId?: string): Promise<void> {
    try {
      if (!this.localParticipant) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (!this.localParticipant) {
          console.error('Cannot publish audio: localParticipant is null');
          return;
        }
      }

      // Get raw mic stream with maximum browser-level noise suppression
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        }
      };

      const rawStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Set up Web Audio API noise gate pipeline
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      const source = this.audioContext.createMediaStreamSource(rawStream);

      // 1. High-pass filter — removes low rumble, fan noise, vibrations
      const highpass = this.audioContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85;   // Cut everything below 85Hz
      highpass.Q.value = 0.7;

      // 2. Second high-pass at slightly higher freq for extra rumble removal
      const highpass2 = this.audioContext.createBiquadFilter();
      highpass2.type = 'highpass';
      highpass2.frequency.value = 120;
      highpass2.Q.value = 0.5;

      // 3. Compressor acting as noise gate
      // Low threshold + high ratio = aggressive gating of quiet sounds
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.value = -50;   // Sounds below -50dB get compressed hard
      compressor.knee.value = 5;          // Sharp transition
      compressor.ratio.value = 12;        // 12:1 aggressive compression
      compressor.attack.value = 0.003;    // Fast attack (3ms) catches transients
      compressor.release.value = 0.25;    // 250ms release - natural speech decay

      // 4. Low-pass filter — removes high-freq hiss/buzz above voice range
      const lowpass = this.audioContext.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 8000;   // Human speech rarely above 8kHz
      lowpass.Q.value = 0.7;

      // 5. Gain to compensate for compression
      const makeupGain = this.audioContext.createGain();
      makeupGain.gain.value = 1.4;  // Boost back slightly after compression

      // Chain: source → highpass → highpass2 → compressor → lowpass → gain → destination
      const dest = this.audioContext.createMediaStreamDestination();
      source.connect(highpass);
      highpass.connect(highpass2);
      highpass2.connect(compressor);
      compressor.connect(lowpass);
      lowpass.connect(makeupGain);
      makeupGain.connect(dest);

      this.noiseGateStream = dest.stream;

      // Create LiveKit track from the processed stream
      const processedTrack = dest.stream.getAudioTracks()[0];
      this.audioTrack = new LocalAudioTrack(processedTrack, undefined, false);
      await this.localParticipant.publishTrack(this.audioTrack);
    } catch (error) {
      console.error('Failed to publish audio:', error);
      throw error;
    }
  }

  async switchAudioDevice(deviceId: string): Promise<void> {
    // Clean up existing audio pipeline
    if (this.audioTrack) {
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
    if (this.localParticipant) {
      await this.localParticipant.setMicrophoneEnabled(enabled);
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
