import React, { memo, useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Mic, MicOff, Headphones, VolumeX, Wifi, WifiOff, Radio } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from '../lib/queryClient';

interface VoiceControlsProps {
  isMuted: boolean;
  isDeafened: boolean;
  toggleMute: () => void;
  toggleDeafen: () => void;
  pttEnabled?: boolean;
  togglePTT?: () => void;
  isPTTActive?: boolean;
}

const VoiceControls: React.FC<VoiceControlsProps> = memo(({ isMuted, isDeafened, toggleMute, toggleDeafen, pttEnabled, togglePTT, isPTTActive }) => {
  const [ping, setPing] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

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

  const getPingColor = useCallback((v: number) => {
    if (v <= 50) return 'text-green-400';
    if (v <= 100) return 'text-yellow-400';
    if (v <= 200) return 'text-orange-400';
    return 'text-red-400';
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center justify-center gap-2 sm:gap-3 p-2 sm:p-3 bg-[#101320] rounded-xl border border-[#23253a]">
        {/* Mikrofon */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon" onClick={toggleMute}
              className={`rounded-full w-10 h-10 transition-all duration-200 ${
                isMuted ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10' : 'text-[#e5eaff] hover:text-[#2ec8fa] hover:bg-[#2ec8fa22]'
              }`}
              disabled={pttEnabled}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
            <p>{pttEnabled ? 'PTT Aktif' : isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}</p>
          </TooltipContent>
        </Tooltip>
        
        {/* Sağırlaşma */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon" onClick={toggleDeafen}
              className={`rounded-full w-10 h-10 transition-all duration-200 ${
                isDeafened ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10' : 'text-[#e5eaff] hover:text-[#2ec8fa] hover:bg-[#2ec8fa22]'
              }`}
            >
              {isDeafened ? <VolumeX size={20} /> : <Headphones size={20} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
            <p>{isDeafened ? 'Sesi Aç' : 'Sessize Al'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Push-to-Talk */}
        {togglePTT && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="icon" onClick={togglePTT}
                className={`rounded-full w-10 h-10 transition-all duration-200 ${
                  pttEnabled 
                    ? isPTTActive 
                      ? 'text-green-400 bg-green-400/20 ring-2 ring-green-400/50' 
                      : 'text-[#eac073] hover:text-[#ffb300] bg-[#eac07322]'
                    : 'text-[#7c8dbb] hover:text-[#aab7e7] hover:bg-[#2ec8fa22]'
                }`}
              >
                <Radio size={20} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
              <p>{pttEnabled ? 'PTT Kapat (Space ile konuş)' : 'PTT Aç (Baskonuş)'}</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        {/* Ping */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0f1422aa] border border-[#4dc9fa22]">
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
    </TooltipProvider>
  );
});

VoiceControls.displayName = "VoiceControls";

export default VoiceControls;