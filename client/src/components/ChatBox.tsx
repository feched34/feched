import React, { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { FaSmile, FaPaperclip, FaPaperPlane } from 'react-icons/fa';
import { useChatSync } from '@/hooks/use-chat-sync';

// Basit kullanıcı ve mesaj tipi
interface User {
  id: string;
  name: string;
  avatar: string;
}

interface Message {
  id: string;
  user: User;
  content: string;
  time: string;
  type: 'text' | 'image' | 'video';
  mediaUrl?: string;
  emojis?: { emoji: string; count: number; users: string[] }[];
}

interface ChatBoxProps {
  currentUser: User;
  users: User[];
  roomId: string;
}

// Emoji listesini sabit olarak tanımla
const emojiList = ['🔥', '😂', '😎', '😍', '👍', '🥳', '😭', '😡', '🎉', '❤️', '😊', '🤔', '👏', '💯', '🚀'] as const;

const ChatBox: React.FC<ChatBoxProps> = memo(({ currentUser, users, roomId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // WebSocket ile sohbet senkronizasyonu
  const { sendMessage: sendWebSocketMessage, loadChatHistory } = useChatSync({
    roomId,
    userId: currentUser.id,
    userName: currentUser.name,
    userAvatar: currentUser.avatar,
    onMessageReceived: (message: Message) => {
      // Tüm mesajları al - kendi mesajlarımız da görünsün
      console.log('💬 Received message from:', message.user.name);
      setMessages(prev => [...prev, message]);
    },
    onHistoryReceived: (historyMessages: Message[]) => {
      console.log('💬 Loading chat history:', historyMessages.length, 'messages');
      setMessages(historyMessages);
    }
  });

  // Sayfa yüklendiğinde sohbet geçmişini yükle
  useEffect(() => {
    loadChatHistory();
  }, [loadChatHistory]);

  // Mesaj gönder - useCallback ile optimize et
  const sendMessage = useCallback(() => {
    if (!input.trim()) return;
    
    // Sadece WebSocket ile gönder - yerel ekleme yok
    // Mesaj server'dan geri gelecek ve orada eklenecek
    sendWebSocketMessage(input);
    
    setInput('');
    setShowEmojis(false);
  }, [input, sendWebSocketMessage]);

  // Emoji ekle - useCallback ile optimize et
  const addEmoji = useCallback((emoji: string) => {
    setInput(prev => prev + emoji);
    setShowEmojis(false);
  }, []);

  // Medya yükle - useCallback ile optimize et
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const type = file.type.startsWith('video') ? 'video' : 'image';
      const newMsg: Message = {
        id: 'm' + Date.now(),
        user: currentUser,
        content: '',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type,
        mediaUrl: url,
      };
      setMessages(prev => [...prev, newMsg]);
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }, [currentUser]);

  // Mesaja emoji bırak - useCallback ile optimize et
  const leaveEmoji = useCallback((msgId: string, emoji: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      
      const existingEmoji = m.emojis?.find(e => e.emoji === emoji);
      if (existingEmoji) {
        // Eğer kullanıcı zaten emoji bırakmışsa, kaldır
        if (existingEmoji.users.includes(currentUser.id)) {
          const updatedUsers = existingEmoji.users.filter(id => id !== currentUser.id);
          if (updatedUsers.length === 0) {
            // Hiç kimse kalmamışsa emoji'yi tamamen kaldır
            return { ...m, emojis: m.emojis?.filter(e => e.emoji !== emoji) };
          }
          return {
            ...m,
            emojis: m.emojis?.map(e => 
              e.emoji === emoji 
                ? { ...e, count: e.count - 1, users: updatedUsers }
                : e
            )
          };
        } else {
          // Kullanıcı emoji'yi ekle
          return {
            ...m,
            emojis: m.emojis?.map(e => 
              e.emoji === emoji 
                ? { ...e, count: e.count + 1, users: [...e.users, currentUser.id] }
                : e
            )
          };
        }
      } else {
        // Yeni emoji ekle
        const newEmoji = { emoji, count: 1, users: [currentUser.id] };
        return { ...m, emojis: [...(m.emojis || []), newEmoji] };
      }
    }));
  }, [currentUser.id]);

  // Mesajları kullanıcıya göre grupla - useMemo ile optimize et
  const groupedMessages = useMemo(() => {
    const groups: { user: User; messages: Message[] }[] = [];
    messages.forEach((msg, i) => {
      if (i === 0 || messages[i - 1].user.id !== msg.user.id) {
        groups.push({ user: msg.user, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });
    return groups;
  }, [messages]);

  // Form submit handler - useCallback ile optimize et
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
  }, [sendMessage]);

  // Input change handler - useCallback ile optimize et
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  }, []);

  // Key press handler - useCallback ile optimize et
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  // Emoji toggle handler - useCallback ile optimize et
  const toggleEmojis = useCallback(() => {
    setShowEmojis(v => !v);
  }, []);

  // File input click handler - useCallback ile optimize et
  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Yeni mesaj geldikçe otomatik scroll - useCallback ile optimize et
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  return (
    <Card className="glass bg-gradient-to-br from-[#101320ee] to-[#23305b99] border border-[#23253a] rounded-2xl shadow-2xl p-4 w-full max-w-2xl mx-auto flex flex-col h-full">
      {/* Header */}
      <div className="mb-2 flex-shrink-0">
        <h3 className="text-lg font-bold bg-gradient-to-r from-[#4dc9fa] to-[#7dd3fc] bg-clip-text text-transparent tracking-tight flex items-center gap-2">
          <span>Genel Sohbet</span>
          <span className="text-[#2ec8fa] bg-[#2ec8fa22] px-2 py-0.5 rounded-full text-xs">({messages.length})</span>
        </h3>
      </div>
      
      {/* Mesajlar - Flex-1 ile kalan alanı kapla */}
      <div className="flex-1 pr-1 sm:pr-2 mb-2 overflow-y-auto overflow-x-hidden chat-container-wrap" ref={scrollRef} style={{maxHeight: '60vh', minHeight: '200px'}}>
        <div className="flex flex-col gap-0.5 p-0 m-0 break-words">
          {groupedMessages.map((group, idx) => (
            <div key={group.messages[0].id} className="flex items-start gap-2 mb-1">
              <img src={group.user.avatar} alt={group.user.name} className="w-8 h-8 rounded-full object-cover border border-[#2ec8fa55] mt-1 flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                <div className="font-semibold text-[#eac073] text-md break-words">{group.user.name}</div>
                {group.messages.map((msg, mi) => (
                  <div key={msg.id} className="flex flex-col items-start group relative">
                    <div className={`rounded-xl px-3 py-2 max-w-[85%] sm:max-w-[70%] chat-message-wrap ${msg.user.id === currentUser.id ? 'bg-[#2ec8fa33] text-[#e5eaff]' : 'bg-[#15182a] text-[#e5eaff]'}`}> 
                      {msg.type === 'text' && <span className="chat-text-wrap">{msg.content}</span>}
                      {msg.type === 'image' && msg.mediaUrl && <img src={msg.mediaUrl} alt="img" className="max-w-[180px] max-h-[180px] rounded-lg" />}
                      {msg.type === 'video' && msg.mediaUrl && <video src={msg.mediaUrl} controls className="max-w-[180px] max-h-[180px] rounded-lg" />}
                      {/* Saat etiketi - sadece son mesajda veya farklı dakikada */}
                      {(mi === group.messages.length - 1 || 
                        (mi < group.messages.length - 1 && 
                         group.messages[mi].time !== group.messages[mi + 1].time)) && (
                        <div className="text-xs text-[#aab7e7] mt-1 opacity-70">{msg.time}</div>
                      )}
                      
                      {/* Emoji bırakma butonları - mesaj kutusunun üstünde */}
                      <div className="absolute -top-2 left-0 right-0 flex flex-row gap-0 items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
                        <div className="bg-[#101320cc] backdrop-blur-sm rounded-full px-2 py-1 flex flex-row gap-0 items-center pointer-events-auto">
                          {emojiList.map(e => (
                            <button 
                              key={e} 
                              className="text-lg hover:scale-125 transition-transform duration-150 p-1 rounded-full hover:bg-[#2ec9fa22]" 
                              onClick={() => leaveEmoji(msg.id, e)}
                              title={`${e} bırak`}
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    {/* Emoji reaksiyonları */}
                    {msg.emojis && msg.emojis.length > 0 && (
                      <div className="flex flex-wrap gap-0 ml-1 break-words chat-container-wrap">
                        {msg.emojis.map((emojiData, index) => (
                          <div key={index} className="flex items-center gap-0 bg-[#15182a] rounded-full px-2 py-1 text-xs">
                            <span>{emojiData.emoji}</span>
                            <span className="text-[#aab7e7]">{emojiData.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Mesaj yazma alanı - Alt kısımda, flex-shrink-0 ile sabit */}
      <form className="flex flex-col gap-1 relative flex-shrink-0" onSubmit={handleSubmit}>
        {/* Emoji kutusu */}
        {showEmojis && (
          <div className="w-full bg-[#101320] border border-[#23253a] rounded-xl shadow-xl p-3 flex flex-row flex-wrap gap-2 z-50 mb-2">
            {emojiList.map(e => (
              <button 
                key={e} 
                className="text-2xl p-2 hover:scale-125 transition-transform duration-150 rounded-lg hover:bg-[#2ec9fa22]" 
                onClick={() => addEmoji(e)}
                title={e}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        
        <div className="flex items-center gap-2 w-full">
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            onClick={toggleEmojis} 
            className="text-[#eac073] hover:bg-[#eac07322] transition-colors"
          >
            <FaSmile size={22} />
          </Button>
          
          <Input
            className="flex-1 bg-[#15182a] text-[#e5eaff] border-[#23253a] placeholder-[#7c8dbb] focus:border-[#4dc9fa] transition-colors break-words chat-text-wrap"
            placeholder="Mesaj yaz..."
            value={input}
            onChange={handleInputChange}
            disabled={uploading}
            onKeyPress={handleKeyPress}
          />
          
          <input
            type="file"
            accept="image/*,video/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            onClick={handleFileClick} 
            className="text-[#2ec8fa] hover:bg-[#2ec8fa22] transition-colors"
          >
            <FaPaperclip size={20} />
          </Button>
          
          <Button 
            type="submit" 
            disabled={!input.trim() && !uploading} 
            className="btn-shine px-3 py-2 rounded-lg font-semibold text-[#e4eaff] hover:scale-105 transition-transform"
          >
            <FaPaperPlane size={18} />
          </Button>
        </div>
      </form>
    </Card>
  );
});

ChatBox.displayName = "ChatBox";

export default ChatBox; 