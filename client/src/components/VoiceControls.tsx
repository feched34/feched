import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { Mic, MicOff, Headphones, VolumeX, Wifi, WifiOff, ChevronDown, Keyboard } from 'lucide-react';
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
  audioDevices?: AudioDevice[];
  audioOutputDevices?: AudioDevice[];
  selectedAudioDevice?: string;
  selectedOutputDevice?: string;
  switchAudioDevice?: (deviceId: string) => void;
  switchOutputDevice?: (deviceId: string) => void;
  pttKey?: string;
  setPTTKey?: (key: string) => void;
}

function formatKeyCode(code: string): string {
  return code
    .replace('Key', '')
    .replace('Digit', '')
    .replace('Space', 'Boşluk')
    .replace('Backquote', '`')
    .replace('Minus', '-')
    .replace('Equal', '=')
    .replace('BracketLeft', '[')
    .replace('BracketRight', ']')
    .replace('Semicolon', ';')
    .replace('Quote', "'")
    .replace('Comma', ',')
    .replace('Period', '.')
    .replace('Slash', '/')
    .replace('Backslash', '\\')
    .replace('Control', 'Ctrl')
    .replace('Alt', 'Alt')
    .replace('Shift', 'Shift')
    .replace('Arrow', '↑↓←→'.charAt(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(code)));
}

const VoiceControls: React.FC<VoiceControlsProps> = memo(({
  isMuted, isDeafened, toggleMute, toggleDeafen, pttEnabled = false, togglePTT, isPTTActive = false,
  audioDevices, audioOutputDevices, selectedAudioDevice, selectedOutputDevice,
  switchAudioDevice, switchOutputDevice, pttKey = 'Space', setPTTKey
}) => {
  const [ping, setPing] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'mic' | 'output' | null>(null);
  // PTT panel: 'key' = tuş atama paneli, 'off' = kapalı
  const [pttPanel, setPttPanel] = useState<'key' | null>(null);
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

  // Dışarı tıklamada kapat
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        setPttPanel(null);
        if (pttListening) {
          setPttListening(false);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pttListening]);

  const getPingColor = (v: number) => {
    if (v <= 50) return 'text-green-400';
    if (v <= 100) return 'text-yellow-400';
    if (v <= 200) return 'text-orange-400';
    return 'text-red-400';
  };

  // PTT tuşu atama
  const startListening = useCallback(() => {
    if (!setPTTKey) return;
    setPttListening(true);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Modifier tuşları tek başına kabul etme
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      setPTTKey(e.code);
      setPttListening(false);
      document.removeEventListener('keydown', handler, true);
    };
    document.addEventListener('keydown', handler, true);
  }, [setPTTKey]);

  // PTT tuşuna tıklama (PTT'yi aç/kapat + panel aç)
  const handlePTTButtonClick = useCallback(() => {
    if (!togglePTT) return;
    if (!pttEnabled) {
      // PTT kapalıyken tıklanınca aç + tuş atama panelini göster
      togglePTT();
      setPttPanel('key');
    } else {
      // PTT açıkken tıklanınca kapat
      togglePTT();
      setPttPanel(null);
    }
  }, [pttEnabled, togglePTT]);

  const hasInputDevices = audioDevices && audioDevices.length > 0 && switchAudioDevice;
  const hasOutputDevices = audioOutputDevices && audioOutputDevices.length > 0 && switchOutputDevice;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative" ref={dropdownRef}>

        {/* ── Ana kontrol çubuğu ── */}
        <div className="flex items-center justify-center gap-1.5 p-2 bg-[#101320] rounded-xl border border-[#23253a]">

          {/* Mikrofon */}
          <div className="relative flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon" onClick={toggleMute}
                  className={`rounded-full w-9 h-9 transition-all duration-200 ${
                    pttEnabled
                      ? 'text-[#7c8dbb] opacity-40 cursor-default'
                      : isMuted
                        ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10'
                        : 'text-[#e5eaff] hover:text-[#2ec8fa] hover:bg-[#2ec8fa22]'
                  }`}
                  disabled={pttEnabled}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a]">
                <p>{pttEnabled ? 'PTT aktifken mikrofon PTT tuşuyla kontrol edilir' : isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}</p>
              </TooltipContent>
            </Tooltip>
            {hasInputDevices && (
              <button
                onClick={() => { setOpenDropdown(openDropdown === 'mic' ? null : 'mic'); setPttPanel(null); }}
                className={`w-4 h-4 flex items-center justify-center rounded-full transition-all -ml-1.5 ${openDropdown === 'mic' ? 'text-[#2ec8fa] bg-[#2ec8fa22]' : 'text-[#7c8dbb] hover:text-[#aab7e7]'}`}
              >
                <ChevronDown size={10} />
              </button>
            )}
          </div>

          {/* Kulaklık */}
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
                onClick={() => { setOpenDropdown(openDropdown === 'output' ? null : 'output'); setPttPanel(null); }}
                className={`w-4 h-4 flex items-center justify-center rounded-full transition-all -ml-1.5 ${openDropdown === 'output' ? 'text-[#2ec8fa] bg-[#2ec8fa22]' : 'text-[#7c8dbb] hover:text-[#aab7e7]'}`}
              >
                <ChevronDown size={10} />
              </button>
            )}
          </div>

          {/* ── Bas-Konuş (PTT) Butonu ── */}
          {togglePTT && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handlePTTButtonClick}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200 select-none border ${
                    pttEnabled
                      ? isPTTActive
                        // Tuşa basılıyken: parlak yeşil, canlı
                        ? 'bg-green-500/20 border-green-400 text-green-300 shadow-[0_0_10px_rgba(74,222,128,0.3)] scale-[1.03]'
                        // PTT açık ama tuş basılı değil: altın/sarı, bekleme hali
                        : 'bg-[#eac07318] border-[#eac073] text-[#eac073] hover:bg-[#eac07328]'
                      // PTT kapalı: soluk, davet edici
                      : 'bg-[#15182a] border-[#23253a] text-[#7c8dbb] hover:border-[#4dc9fa55] hover:text-[#aab7e7]'
                  }`}
                >
                  {/* Mikrofon ikonu */}
                  <span className={`transition-all duration-150 ${isPTTActive && pttEnabled ? 'text-green-400' : ''}`}>
                    {pttEnabled ? (isPTTActive ? <Mic size={13} /> : <Mic size={13} />) : <Mic size={13} />}
                  </span>

                  {/* Etiket */}
                  <span>
                    {pttEnabled
                      ? isPTTActive
                        ? '🎙 Yayında'
                        : `Bas-Konuş · ${formatKeyCode(pttKey)}`
                      : 'Bas-Konuş'}
                  </span>

                  {/* PTT aktifken titreşim halkası */}
                  {isPTTActive && pttEnabled && (
                    <span className="absolute inset-0 rounded-lg ring-2 ring-green-400/40 animate-ping pointer-events-none" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-[#101320] text-[#e5eaff] border-[#23253a] max-w-xs text-center">
                {pttEnabled
                  ? <p>PTT açık · <span className="text-[#eac073] font-mono">{formatKeyCode(pttKey)}</span> tuşuna basılı tut ve konuş.<br /><span className="text-[10px] text-[#7c8dbb]">Kapatmak için tıkla</span></p>
                  : <p>Bas-Konuş modunu aç<br /><span className="text-[10px] text-[#7c8dbb]">Mikrofon yalnızca tuşa basılıyken çalışır</span></p>
                }
              </TooltipContent>
            </Tooltip>
          )}

          {/* Ping */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-[#0f1422aa] border border-[#4dc9fa22] ml-0.5">
                {isConnected ? (
                  <>
                    <Wifi className="h-3 w-3 text-[#4dc9fa]" />
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
              <p>Sunucu Gecikmesi</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ── PTT Tuş Atama Paneli ── */}
        {pttPanel === 'key' && pttEnabled && setPTTKey && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#101320] border border-[#eac07344] rounded-xl shadow-2xl p-4 z-50 animate-fadeUp">
            {/* Başlık */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-[#eac07322] flex items-center justify-center">
                <Keyboard size={12} className="text-[#eac073]" />
              </div>
              <p className="text-xs font-semibold text-[#eac073]">Bas-Konuş Tuşu</p>
            </div>

            {/* Açıklama */}
            <p className="text-[10px] text-[#7c8dbb] mb-3 leading-relaxed">
              Konuşmak için <span className="text-[#aab7e7]">tuşa basılı tut</span>, bırakınca mikrofon kapanır. Aşağıdan tuşu değiştirebilirsin.
            </p>

            {/* Mevcut tuş gösterimi */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-[#7c8dbb]">Atanmış tuş:</span>
              <kbd className="px-2 py-0.5 bg-[#1a1f3a] border border-[#4dc9fa44] rounded text-[11px] font-mono text-[#4dc9fa] font-bold">
                {formatKeyCode(pttKey)}
              </kbd>
            </div>

            {/* Değiştir butonu */}
            {pttListening ? (
              <div className="w-full py-3 rounded-lg border-2 border-dashed border-[#eac07366] bg-[#eac07308] text-center">
                <div className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#eac073] animate-pulse inline-block" />
                  <span className="text-xs text-[#eac073] font-medium">Bir tuşa bas...</span>
                </div>
                <p className="text-[10px] text-[#7c8dbb] mt-1">Modifier tuşlar (Ctrl, Alt, Shift) tek başına kabul edilmez</p>
              </div>
            ) : (
              <button
                onClick={startListening}
                className="w-full py-2.5 rounded-lg text-xs text-[#e5eaff] bg-[#15182a] border border-[#23253a] hover:border-[#eac07366] hover:bg-[#eac07308] hover:text-[#eac073] transition-all flex items-center justify-center gap-2"
              >
                <Keyboard size={12} />
                <span>Tuşu Değiştir</span>
              </button>
            )}

            {/* Panel kapat */}
            <button
              onClick={() => setPttPanel(null)}
              className="w-full mt-2 py-1.5 rounded-lg text-[10px] text-[#7c8dbb] hover:text-[#aab7e7] transition-colors"
            >
              Kapat
            </button>
          </div>
        )}

        {/* ── PTT Açıkken Tuş Göster Butonu ── */}
        {pttEnabled && !pttPanel && setPTTKey && (
          <button
            onClick={() => setPttPanel('key')}
            className="w-full mt-1.5 flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg text-[10px] text-[#7c8dbb] hover:text-[#eac073] hover:bg-[#eac07310] border border-transparent hover:border-[#eac07322] transition-all"
          >
            <Keyboard size={10} />
            <span>Tuşu değiştir</span>
            <kbd className="ml-1 px-1.5 py-0 bg-[#1a1f3a] border border-[#4dc9fa33] rounded text-[9px] font-mono text-[#4dc9fa]">
              {formatKeyCode(pttKey)}
            </kbd>
          </button>
        )}

        {/* ── Mikrofon Giriş Cihazı Dropdown ── */}
        {openDropdown === 'mic' && hasInputDevices && (
          <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#101320] border border-[#23253a] rounded-xl shadow-2xl p-2 z-50 animate-fadeUp">
            <p className="text-[10px] text-[#7c8dbb] px-2 py-1 uppercase tracking-wider font-semibold">Giriş Aygıtı</p>
            {audioDevices!.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => { switchAudioDevice!(d.deviceId); setOpenDropdown(null); }}
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

        {/* ── Ses Çıkış Cihazı Dropdown ── */}
        {openDropdown === 'output' && hasOutputDevices && (
          <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#101320] border border-[#23253a] rounded-xl shadow-2xl p-2 z-50 animate-fadeUp">
            <p className="text-[10px] text-[#7c8dbb] px-2 py-1 uppercase tracking-wider font-semibold">Çıkış Aygıtı</p>
            {audioOutputDevices!.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => { switchOutputDevice!(d.deviceId); setOpenDropdown(null); }}
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
      </div>
    </TooltipProvider>
  );
});

VoiceControls.displayName = 'VoiceControls';
export default VoiceControls;