import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { Mic, MicOff, Headphones, VolumeX, Wifi, WifiOff, Radio, ChevronDown, Keyboard } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from '../lib/queryClient';

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface VoiceControlsProps {
  isMuted: boolean;
  isDeafened: boolean;
  toggleMute: () => void;
  toggleDeafen: () => void;
  pttEnabled?: boolean;
  togglePTT?: () => void;
  isPTTActive?: boolean;
  // Device selection props
  audioDevices?: AudioDevice[];
  audioOutputDevices?: AudioDevice[];
  selectedAudioDevice?: string;
  selectedOutputDevice?: string;
  switchAudioDevice?: (deviceId: string) => void;
  switchOutputDevice?: (deviceId: string) => void;
  // PTT key props
  pttKey?: string;
  setPTTKey?: (key: string) => void;
}

const VoiceControls: React.FC<VoiceControlsProps> = memo(({ 
  isMuted, isDeafened, toggleMute, toggleDeafen, pttEnabled, togglePTT, isPTTActive,
  audioDevices, audioOutputDevices, selectedAudioDevice, selectedOutputDevice,
  switchAudioDevice, switchOutputDevice, pttKey, setPTTKey
}) => {
  const [ping, setPing] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'mic' | 'output' | 'ptt' | null>(null);
  const [pttListening, setPttListening] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const measurePing = useCallback(async () => {
    const startTime = Date.now();
    try {
      await apiRequest('GET', '/api/ping');
      setPing(Date.now() - startTime);
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    measurePing();
    const interval = setInterval(measurePing, 5000);
    return () => clearInterval(interval);
  }, [measurePing]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    if (openDropdown) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdown]);

  const getPingColor = useCallback((v: number) => {
    if (v <= 50) return 'text-green-400';
    if (v <= 100) return 'text-yellow-400';
    if (v <= 200) return 'text-orange-400';
    return 'text-red-400';
  }, []);

  const hasInputDevices = audioDevices && audioDevices.length > 0 && switchAudioDevice;
  const hasOutputDevices = audioOutputDevices && audioOutputDevices.length > 0 && switchOutputDevice;
  const hasPTTKey = pttEnabled && pttKey && setPTTKey;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative" ref={dropdownRef}>
        <div className="flex items-center justify-center gap-1.5 sm:gap-2 p-2 sm:p-2.5 bg-[#101320] rounded-xl border border-[#23253a]">
          {/* Mikrofon + dropdown arrow */}
          <div className="relative flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon" onClick={toggleMute}
                  className={`rounded-full w-9 h-9 transition-all duration-200 ${
                    isMuted ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10' : 'text-[#e5eaff] hover:text-[#2ec8fa] hover:bg-[#2ec8fa22]'
                  }`}
                  disabled={pttEnabled}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
                <p>{pttEnabled ? 'PTT Aktif' : isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}</p>
              </TooltipContent>
            </Tooltip>
            {hasInputDevices && (
              <button 
                onClick={() => setOpenDropdown(openDropdown === 'mic' ? null : 'mic')}
                className={`w-4 h-4 flex items-center justify-center rounded-full transition-all -ml-1.5 ${openDropdown === 'mic' ? 'text-[#2ec8fa] bg-[#2ec8fa22]' : 'text-[#7c8dbb] hover:text-[#aab7e7]'}`}
              >
                <ChevronDown size={10} />
              </button>
            )}
          </div>

          {/* Kulaklık + dropdown arrow */}
          <div className="relative flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon" onClick={toggleDeafen}
                  className={`rounded-full w-9 h-9 transition-all duration-200 ${
                    isDeafened ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10' : 'text-[#e5eaff] hover:text-[#2ec8fa] hover:bg-[#2ec8fa22]'
                  }`}
                >
                  {isDeafened ? <VolumeX size={18} /> : <Headphones size={18} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
                <p>{isDeafened ? 'Sesi Aç' : 'Sessize Al'}</p>
              </TooltipContent>
            </Tooltip>
            {hasOutputDevices && (
              <button 
                onClick={() => setOpenDropdown(openDropdown === 'output' ? null : 'output')}
                className={`w-4 h-4 flex items-center justify-center rounded-full transition-all -ml-1.5 ${openDropdown === 'output' ? 'text-[#2ec8fa] bg-[#2ec8fa22]' : 'text-[#7c8dbb] hover:text-[#aab7e7]'}`}
              >
                <ChevronDown size={10} />
              </button>
            )}
          </div>

          {/* Push-to-Talk + dropdown arrow for key binding */}
          {togglePTT && (
            <div className="relative flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="icon" onClick={togglePTT}
                    className={`rounded-full w-9 h-9 transition-all duration-200 ${
                      pttEnabled 
                        ? isPTTActive 
                          ? 'text-green-400 bg-green-400/20 ring-2 ring-green-400/50' 
                          : 'text-[#eac073] hover:text-[#ffb300] bg-[#eac07322]'
                        : 'text-[#7c8dbb] hover:text-[#aab7e7] hover:bg-[#2ec8fa22]'
                    }`}
                  >
                    <Radio size={18} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
                  <p>{pttEnabled ? 'PTT Kapat' : 'PTT Aç (Baskonuş)'}</p>
                </TooltipContent>
              </Tooltip>
              {hasPTTKey && (
                <button 
                  onClick={() => setOpenDropdown(openDropdown === 'ptt' ? null : 'ptt')}
                  className={`w-4 h-4 flex items-center justify-center rounded-full transition-all -ml-1.5 ${openDropdown === 'ptt' ? 'text-[#2ec8fa] bg-[#2ec8fa22]' : 'text-[#7c8dbb] hover:text-[#aab7e7]'}`}
                >
                  <ChevronDown size={10} />
                </button>
              )}
            </div>
          )}
          
          {/* Ping */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-[#0f1422aa] border border-[#4dc9fa22]">
                {isConnected ? (
                  <>
                    <Wifi className="h-3 w-3" />
                    <span className={`text-[10px] font-mono ${getPingColor(ping || 0)}`}>
                      {ping ? `${ping}ms` : '...'}
                    </span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3 text-red-400" />
                    <span className="text-[10px] text-red-400">Yok</span>
                  </>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
              <p>Bağlantı Durumu</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Dropdown Popups */}
        {openDropdown === 'mic' && hasInputDevices && (
          <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#101320] border border-[#23253a] rounded-xl shadow-2xl p-2 z-50 animate-fadeUp">
            <p className="text-[10px] text-[#7c8dbb] px-2 py-1 uppercase tracking-wider font-semibold">Giriş Aygıtı</p>
            {audioDevices.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => { switchAudioDevice(d.deviceId); setOpenDropdown(null); }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition-all ${
                  d.deviceId === selectedAudioDevice 
                    ? 'bg-[#2ec8fa15] text-[#2ec8fa]'
                    : 'text-[#e5eaff] hover:bg-[#ffffff08]'
                }`}
              >
                {d.label || `Mikrofon ${d.deviceId.slice(0, 6)}`}
              </button>
            ))}
          </div>
        )}

        {openDropdown === 'output' && hasOutputDevices && (
          <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#101320] border border-[#23253a] rounded-xl shadow-2xl p-2 z-50 animate-fadeUp">
            <p className="text-[10px] text-[#7c8dbb] px-2 py-1 uppercase tracking-wider font-semibold">Çıkış Aygıtı</p>
            {audioOutputDevices.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => { switchOutputDevice(d.deviceId); setOpenDropdown(null); }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] transition-all ${
                  d.deviceId === selectedOutputDevice 
                    ? 'bg-[#2ec8fa15] text-[#2ec8fa]'
                    : 'text-[#e5eaff] hover:bg-[#ffffff08]'
                }`}
              >
                {d.label || `Hoparlör ${d.deviceId.slice(0, 6)}`}
              </button>
            ))}
          </div>
        )}

        {openDropdown === 'ptt' && hasPTTKey && (
          <div className="absolute bottom-full left-0 mb-2 w-56 bg-[#101320] border border-[#23253a] rounded-xl shadow-2xl p-3 z-50 animate-fadeUp">
            <p className="text-[10px] text-[#7c8dbb] uppercase tracking-wider font-semibold mb-2">PTT Tuşu</p>
            {pttListening ? (
              <div className="text-xs text-[#eac073] text-center py-3 animate-pulse border border-dashed border-[#eac07344] rounded-lg">
                Bir tuşa bas...
              </div>
            ) : (
              <button
                onClick={() => {
                  setPttListening(true);
                  const handler = (e: KeyboardEvent) => {
                    e.preventDefault();
                    setPTTKey(e.code);
                    setPttListening(false);
                    setOpenDropdown(null);
                    document.removeEventListener('keydown', handler);
                  };
                  document.addEventListener('keydown', handler);
                }}
                className="w-full py-2.5 rounded-lg text-xs text-[#e5eaff] bg-[#15182a] border border-[#23253a] hover:border-[#4dc9fa33] transition-all text-center flex items-center justify-center gap-2"
              >
                <Keyboard size={12} className="text-[#7c8dbb]" />
                <span>{pttKey.replace('Key', '').replace('Space', 'Boşluk')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
});

VoiceControls.displayName = "VoiceControls";

export default VoiceControls;