import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertParticipantSchema, type LiveKitTokenRequest, type LiveKitTokenResponse } from "@shared/schema";
import { AccessToken } from "livekit-server-sdk";
import multer from "multer";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";

interface ExtendedWebSocket extends WebSocket {
  roomId?: string;
  isAlive?: boolean;
  lastPing?: number;
  reconnectAttempts?: number;
}

// Oda bazlı soundboard state'ini memory'de tutmak için
type SoundboardState = { sounds: any[] };

// Video state'ini daha detaylı tutmak için
type VideoState = {
  isPlaying: boolean;
  currentVideoId: string | null;
  currentTime: number;
  duration: number;
  lastUpdate: number;
};

const roomSoundboardState: Record<string, SoundboardState> = {};
const roomVideoState: Record<string, VideoState> = {};

// Multer konfigürasyonu
const storageConfig = multer.diskStorage({
  destination: (req: any, file: Express.Multer.File, cb: any) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'sounds');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req: any, file: Express.Multer.File, cb: any) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storageConfig,
  fileFilter: (req: any, file: Express.Multer.File, cb: any) => {
    // Sadece ses dosyalarını kabul et
    const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/m4a'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Sadece ses dosyaları yüklenebilir'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Render.com için WebSocket proxy ayarları
  app.use('/ws', (req, res, next) => {
    // Render.com'da WebSocket upgrade'ini handle et
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      console.log('🎯 WebSocket upgrade request detected');
      // WebSocket upgrade'i için özel header'lar
      res.setHeader('Upgrade', 'websocket');
      res.setHeader('Connection', 'Upgrade');
      res.setHeader('Sec-WebSocket-Accept', 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    }
    next();
  });

  // WebSocket server for real-time participant updates - Render.com için optimize edildi
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws',
    // Render.com için ek ayarlar
    perMessageDeflate: false, // Compression'ı kapat
    maxPayload: 1024 * 1024, // 1MB max payload
    skipUTF8Validation: true, // UTF8 validation'ı atla
    // Render.com proxy ayarları
    handleProtocols: () => 'websocket',
    clientTracking: true
  });

  // LiveKit configuration
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
  const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL;

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
    console.warn("⚠️  Missing required LiveKit environment variables");
    console.warn("LIVEKIT_API_KEY:", !!LIVEKIT_API_KEY);
    console.warn("LIVEKIT_API_SECRET:", !!LIVEKIT_API_SECRET);
    console.warn("LIVEKIT_WS_URL:", LIVEKIT_WS_URL);
    console.warn("Available env vars:", Object.keys(process.env).filter(key => key.includes('LIVEKIT')));
    console.warn("Voice chat features will be disabled until LiveKit is configured.");
  }

  // Oda bazlı müzik state'ini memory'de tutmak için
  const roomMusicState: Record<string, any> = {};

  // Ses dosyası yükleme endpoint'i
  app.post("/api/sound/upload", upload.single('sound'), async (req, res) => {
    try {
      const { roomId, userId } = req.body;
      const file = req.file;

      if (!roomId || !userId || !file) {
        return res.status(400).json({ message: "Room ID, user ID and sound file are required" });
      }

      // Ses dosyası bilgilerini oluştur
      const soundData = {
        id: `sound_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: file.originalname,
        filename: file.filename,
        path: `/uploads/sounds/${file.filename}`,
        uploadedBy: userId,
        uploadedAt: new Date().toISOString(),
        size: file.size,
        mimetype: file.mimetype
      };

      // Oda soundboard state'ini güncelle
      if (!roomSoundboardState[roomId]) {
        roomSoundboardState[roomId] = { sounds: [] };
      }
      roomSoundboardState[roomId].sounds.push(soundData);

      // WebSocket ile yeni ses dosyasını odadaki herkese bildir
      wss.clients.forEach((client: ExtendedWebSocket) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
          client.send(JSON.stringify({
            type: 'soundboard_state_broadcast',
            state: roomSoundboardState[roomId]
          }));
        }
      });

      res.json({ 
        success: true, 
        sound: soundData,
        message: "Ses dosyası başarıyla yüklendi"
      });
    } catch (error) {
      console.error("Sound upload error:", error);
      res.status(500).json({ message: "Failed to upload sound file" });
    }
  });

  // Ses dosyalarını serve etmek için static endpoint
  app.use('/uploads/sounds', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.use('/uploads/sounds', (req, res) => {
    const filePath = path.join(process.cwd(), 'uploads', 'sounds', req.path);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "Sound file not found" });
    }
  });

  // Generate LiveKit token
  app.post("/api/auth", async (req, res) => {
    try {
      // LiveKit yapılandırması kontrol et
      if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
        return res.status(503).json({ 
          message: "Voice chat service is temporarily unavailable. Please try again later.",
          error: "LIVEKIT_NOT_CONFIGURED"
        });
      }

      const { nickname, roomName }: LiveKitTokenRequest = req.body;

      if (!nickname || !roomName) {
        return res.status(400).json({ message: "Nickname and room name are required" });
      }

      const timestamp = Date.now();
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: `${nickname}_${timestamp}`,
        ttl: '4h',
      });

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const jwt = await token.toJwt();
      console.log(`Generated token for ${nickname} (identity: ${nickname}_${timestamp}): ${jwt.substring(0, 50)}...`);

      // Add participant to storage
      await storage.createParticipant({
        nickname,
        roomId: roomName,
      });

      // Broadcast participant update
      broadcastParticipantUpdate(roomName);

      const response: LiveKitTokenResponse = {
        token: jwt,
        wsUrl: LIVEKIT_WS_URL!,
      };

      res.json(response);
    } catch (error) {
      console.error("Error generating token:", error);
      res.status(500).json({ message: "Failed to generate token" });
    }
  });

  // Get participants for a room
  app.get("/api/rooms/:roomId/participants", async (req, res) => {
    try {
      const { roomId } = req.params;
      const participants = await storage.getParticipantsByRoom(roomId);
      res.json(participants);
    } catch (error) {
      console.error("Error fetching participants:", error);
      res.status(500).json({ message: "Failed to fetch participants" });
    }
  });

  // Update participant mute status
  app.patch("/api/participants/:id/mute", async (req, res) => {
    try {
      const { id } = req.params;
      const { isMuted } = req.body;

      await storage.updateParticipantMute(parseInt(id), isMuted);

      const participant = await storage.getParticipant(parseInt(id));
      if (participant) {
        broadcastParticipantUpdate(participant.roomId);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating participant:", error);
      res.status(500).json({ message: "Failed to update participant" });
    }
  });

  // Remove participant
  app.delete("/api/participants/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const participant = await storage.getParticipant(parseInt(id));
      
      if (participant) {
        await storage.removeParticipant(parseInt(id));
        broadcastParticipantUpdate(participant.roomId);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing participant:", error);
      res.status(500).json({ message: "Failed to remove participant" });
    }
  });

  // YouTube arama endpoint - Invidious API kullanır (API key gerektirmez)
  app.get("/api/youtube/search", async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Query parameter 'q' is required" });
      }

      console.log(`🎵 Searching YouTube (via Invidious) for: ${q}`);

      // Birden fazla Invidious instance - failover için
      const invidiousInstances = [
        'https://vid.puffyan.us',
        'https://invidious.fdn.fr',
        'https://invidious.privacyredirect.com',
        'https://iv.ggtyler.dev',
        'https://invidious.protokolla.fi',
      ];

      let lastError: any = null;

      for (const instance of invidiousInstances) {
        try {
          const url = `${instance}/api/v1/search?q=${encodeURIComponent(q)}&type=video&sort_by=relevance`;
          console.log(`🎵 Trying Invidious instance: ${instance}`);
          
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000); // 8 saniye timeout
          
          const response = await fetch(url, { 
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
            }
          });
          clearTimeout(timeout);
          
          if (!response.ok) {
            throw new Error(`Invidious API error: ${response.status}`);
          }
          
          const results = await response.json();
          
          if (results && Array.isArray(results) && results.length > 0) {
            // İlk video sonucunu bul
            const video = results.find((r: any) => r.type === 'video');
            if (!video) {
              throw new Error('No video results found');
            }

            // YouTube Data API formatına dönüştür (client uyumu için)
            const formattedData = {
              items: [{
                id: { videoId: video.videoId },
                snippet: {
                  title: video.title,
                  channelTitle: video.author || 'Bilinmeyen Sanatçı',
                  thumbnails: {
                    medium: {
                      url: video.videoThumbnails?.[0]?.url || 
                           `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`
                    }
                  }
                }
              }]
            };
            
            console.log(`🎵 Found video: ${video.title} (${video.videoId})`);
            return res.json(formattedData);
          }
        } catch (instanceError: any) {
          console.warn(`🎵 Invidious instance ${instance} failed:`, instanceError.message);
          lastError = instanceError;
          continue; // Sonraki instance'ı dene
        }
      }

      // Hiçbir instance çalışmadıysa, YouTube Data API'yi yedek olarak dene
      const YOUTUBE_API_KEY = process.env.VITE_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
      if (YOUTUBE_API_KEY) {
        try {
          const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(q)}&type=video&key=${YOUTUBE_API_KEY}`;
          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();
            console.log(`🎵 YouTube Data API fallback returned ${data.items?.length || 0} results`);
            return res.json(data);
          }
        } catch (ytError) {
          console.warn('🎵 YouTube Data API fallback also failed');
        }
      }

      throw lastError || new Error('All search instances failed');
    } catch (error: any) {
      console.error("YouTube search error:", error);
      res.status(500).json({ message: "Failed to search YouTube", error: error.message });
    }
  });

  // Ping endpoint
  app.get("/api/ping", async (req, res) => {
    try {
      res.json({ 
        success: true, 
        timestamp: Date.now(),
        message: "pong" 
      });
    } catch (error) {
      console.error("Ping error:", error);
      res.status(500).json({ message: "Failed to ping" });
    }
  });

  // Müzik kontrol endpoint'leri
  app.post("/api/music/play", async (req, res) => {
    try {
      const { roomId, videoId, userId, currentTime = 0 } = req.body;
      
      if (!roomId || !videoId || !userId) {
        console.error('❌ Music Play 400 Error - Missing fields:', { roomId, videoId, userId });
        return res.status(400).json({ message: "Room ID, video ID and user ID are required", details: { roomId, videoId, userId } });
      }

      console.log(`🎵 Play command from ${userId} for video ${videoId} in room ${roomId}`);

      // Video state'ini güncelle
      if (!roomVideoState[roomId]) {
        roomVideoState[roomId] = {
          isPlaying: false,
          currentVideoId: null,
          currentTime: 0,
          duration: 0,
          lastUpdate: Date.now()
        };
      }
      
      roomVideoState[roomId].isPlaying = true;
      roomVideoState[roomId].currentVideoId = videoId;
      roomVideoState[roomId].currentTime = currentTime;
      roomVideoState[roomId].lastUpdate = Date.now();

      // WebSocket ile video state'ini yayınla
      broadcastVideoState(roomId, roomVideoState[roomId]);

      // WebSocket ile müzik çalma komutunu yayınla
      broadcastMusicControl(roomId, {
        type: 'play',
        videoId,
        userId,
        currentTime,
        timestamp: Date.now()
      });

      // State'i güncelle
      if (!roomMusicState[roomId]) {
        roomMusicState[roomId] = { isPlaying: false, currentVideoId: null };
      }
      roomMusicState[roomId].isPlaying = true;
      roomMusicState[roomId].currentVideoId = videoId;

      res.json({ success: true });
    } catch (error) {
      console.error("Music play error:", error);
      res.status(500).json({ message: "Failed to play music" });
    }
  });

  app.post("/api/music/pause", async (req, res) => {
    try {
      const { roomId, userId, currentTime = 0 } = req.body;
      
      if (!roomId || !userId) {
        return res.status(400).json({ message: "Room ID and user ID are required" });
      }

      console.log(`🎵 Pause command from ${userId} in room ${roomId}`);

      // Video state'ini güncelle
      if (roomVideoState[roomId]) {
        roomVideoState[roomId].isPlaying = false;
        roomVideoState[roomId].currentTime = currentTime;
        roomVideoState[roomId].lastUpdate = Date.now();

        // WebSocket ile video state'ini yayınla
        broadcastVideoState(roomId, roomVideoState[roomId]);
      }

      // WebSocket ile müzik duraklatma komutunu yayınla
      broadcastMusicControl(roomId, {
        type: 'pause',
        userId,
        currentTime,
        timestamp: Date.now()
      });

      // State'i güncelle
      if (roomMusicState[roomId]) {
        roomMusicState[roomId].isPlaying = false;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Music pause error:", error);
      res.status(500).json({ message: "Failed to pause music" });
    }
  });

  app.post("/api/music/queue", async (req, res) => {
    try {
      const { roomId, song, userId } = req.body;
      
      if (!roomId || !song || !userId) {
        return res.status(400).json({ message: "Room ID, song and user ID are required" });
      }

      // WebSocket ile kuyruk ekleme komutunu yayınla
      broadcastMusicControl(roomId, {
        type: 'add_to_queue',
        song,
        userId,
        timestamp: Date.now()
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Music queue error:", error);
      res.status(500).json({ message: "Failed to add to queue" });
    }
  });

  app.post("/api/music/shuffle", async (req, res) => {
    try {
      const { roomId, userId, isShuffled } = req.body;
      
      if (!roomId || !userId || typeof isShuffled !== 'boolean') {
        return res.status(400).json({ message: "Room ID, user ID and shuffle state are required" });
      }

      // WebSocket ile shuffle komutunu yayınla
      broadcastMusicControl(roomId, {
        type: 'shuffle',
        isShuffled,
        userId,
        timestamp: Date.now()
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Music shuffle error:", error);
      res.status(500).json({ message: "Failed to toggle shuffle" });
    }
  });

  app.post("/api/music/repeat", async (req, res) => {
    try {
      const { roomId, userId, repeatMode } = req.body;
      
      if (!roomId || !userId || !repeatMode) {
        return res.status(400).json({ message: "Room ID, user ID and repeat mode are required" });
      }

      // WebSocket ile repeat komutunu yayınla
      broadcastMusicControl(roomId, {
        type: 'repeat',
        repeatMode,
        userId,
        timestamp: Date.now()
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Music repeat error:", error);
      res.status(500).json({ message: "Failed to set repeat mode" });
    }
  });

  // Ses kontrol endpoint'leri
  app.post("/api/sound/play", async (req, res) => {
    try {
      const { roomId, soundId, userId } = req.body;
      
      if (!roomId || !soundId || !userId) {
        return res.status(400).json({ message: "Room ID, sound ID and user ID are required" });
      }

      // WebSocket ile ses çalma komutunu yayınla
      broadcastSoundControl(roomId, {
        type: 'play_sound',
        soundId,
        userId,
        timestamp: Date.now()
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Sound play error:", error);
      res.status(500).json({ message: "Failed to play sound" });
    }
  });

  app.post("/api/sound/stop", async (req, res) => {
    try {
      const { roomId, soundId, userId } = req.body;
      
      if (!roomId || !soundId || !userId) {
        return res.status(400).json({ message: "Room ID, sound ID and user ID are required" });
      }

      // WebSocket ile ses durdurma komutunu yayınla
      broadcastSoundControl(roomId, {
        type: 'stop_sound',
        soundId,
        userId,
        timestamp: Date.now()
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Sound stop error:", error);
      res.status(500).json({ message: "Failed to stop sound" });
    }
  });

  // Video state güncelleme endpoint'i
  app.post("/api/video/state", async (req, res) => {
    try {
      const { roomId, userId, isPlaying, currentTime, duration, videoId } = req.body;
      
      if (!roomId || !userId) {
        return res.status(400).json({ message: "Room ID and user ID are required" });
      }

      console.log(`🎬 Video state update from ${userId} in room ${roomId}:`, { isPlaying, currentTime, duration, videoId });

      // Video state'ini güncelle
      if (!roomVideoState[roomId]) {
        roomVideoState[roomId] = {
          isPlaying: false,
          currentVideoId: null,
          currentTime: 0,
          duration: 0,
          lastUpdate: Date.now()
        };
      }
      
      roomVideoState[roomId].isPlaying = isPlaying;
      roomVideoState[roomId].currentTime = currentTime || 0;
      roomVideoState[roomId].duration = duration || 0;
      roomVideoState[roomId].currentVideoId = videoId;
      roomVideoState[roomId].lastUpdate = Date.now();

      // WebSocket ile video state'ini yayınla
      broadcastVideoState(roomId, roomVideoState[roomId]);

      res.json({ success: true });
    } catch (error) {
      console.error("Video state update error:", error);
      res.status(500).json({ message: "Failed to update video state" });
    }
  });

  // Chat messages endpoint'leri
  app.get("/api/chat/:roomId/messages", async (req, res) => {
    try {
      const { roomId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const messages = await storage.getChatMessagesByRoom(roomId, limit);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ message: "Failed to fetch chat messages" });
    }
  });

  app.post("/api/chat/:roomId/messages", async (req, res) => {
    try {
      const { roomId } = req.params;
      const { userId, userName, userAvatar, content, messageType = 'text', mediaUrl } = req.body;
      
      if (!userId || !userName || !content) {
        return res.status(400).json({ message: "User ID, user name and content are required" });
      }

      console.log('💬 Received chat message from:', userName, 'in room:', roomId);

      const message = await storage.createChatMessage({
        roomId,
        userId,
        userName,
        userAvatar,
        content,
        messageType,
        mediaUrl
      });

      // WebSocket üzerinden broadcast et (SSE değil — çift gönderimi engelle)
      const chatMessage = {
        id: 'm' + message.id,
        user: {
          id: message.userId,
          name: message.userName,
          avatar: message.userAvatar || '/logo.png'
        },
        content: message.content,
        time: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: message.messageType as 'text' | 'image' | 'video',
        mediaUrl: message.mediaUrl
      };
      wss.clients.forEach((client: any) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
          client.send(JSON.stringify({ type: 'chat_message', message: chatMessage }));
        }
      });
      
      console.log('💬 Broadcasted chat message via WebSocket to room:', roomId);

      res.json({ success: true, message });
    } catch (error) {
      console.error("Error creating chat message:", error);
      res.status(500).json({ message: "Failed to create chat message" });
    }
  });

  app.delete("/api/chat/:roomId/messages", async (req, res) => {
    try {
      const { roomId } = req.params;
      
      await storage.deleteChatMessagesByRoom(roomId);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting chat messages:", error);
      res.status(500).json({ message: "Failed to delete chat messages" });
    }
  });

  // Server-Sent Events endpoint for chat messages
  app.get('/api/chat/:roomId/events', (req, res) => {
    const { roomId } = req.params;
    const { userId } = req.query;
    
    console.log('📡 SSE connection request for room:', roomId, 'user:', userId);
    
    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no' // Nginx için
    });
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', roomId, userId })}\n\n`);
    
    // Store the response object for broadcasting
    const clientId = `${roomId}-${userId}-${Date.now()}`;
    if (!sseClients[roomId]) {
      sseClients[roomId] = new Map();
    }
    sseClients[roomId].set(clientId, res);
    
    console.log('📡 SSE client connected:', clientId, 'Total clients in room:', sseClients[roomId].size);
    
    // Send existing messages
    storage.getChatMessagesByRoom(roomId, 50).then(messages => {
      if (messages.length > 0) {
        const formattedMessages = messages.map(msg => ({
          id: 'm' + msg.id,
          user: {
            id: msg.userId,
            name: msg.userName,
            avatar: msg.userAvatar || '/logo.png'
          },
          content: msg.content,
          time: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: msg.messageType as 'text' | 'image' | 'video',
          mediaUrl: msg.mediaUrl
        }));
        
        res.write(`data: ${JSON.stringify({ type: 'chat_history', messages: formattedMessages })}\n\n`);
      }
    }).catch(error => {
      console.error('Error fetching chat history for SSE:', error);
    });
    
    // Handle client disconnect
    req.on('close', () => {
      console.log('📡 SSE client disconnected:', clientId);
      if (sseClients[roomId]) {
        sseClients[roomId].delete(clientId);
        if (sseClients[roomId].size === 0) {
          delete sseClients[roomId];
        }
      }
      clearInterval(keepAlive);
    });
    
    // Handle client error
    req.on('error', (error) => {
      console.error('📡 SSE client error:', error);
      if (sseClients[roomId]) {
        sseClients[roomId].delete(clientId);
        if (sseClients[roomId].size === 0) {
          delete sseClients[roomId];
        }
      }
      clearInterval(keepAlive);
    });
    
    // Keep connection alive - daha sık ping
    const keepAlive = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(keepAlive);
        return;
      }
      try {
        res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
      } catch (error) {
        console.error('Error sending SSE ping:', error);
        clearInterval(keepAlive);
      }
    }, 15000); // 15 saniyede bir ping - daha sık
  });
  
  // SSE clients storage
  const sseClients: Record<string, Map<string, any>> = {};
  
  // Broadcast function for SSE
  function broadcastToSSE(roomId: string, data: any) {
    if (sseClients[roomId]) {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      sseClients[roomId].forEach((res, clientId) => {
        if (!res.writableEnded) {
          res.write(message);
        } else {
          // Remove dead connections
          sseClients[roomId].delete(clientId);
        }
      });
      
      // Clean up empty rooms
      if (sseClients[roomId].size === 0) {
        delete sseClients[roomId];
      }
    }
  }

  // WebSocket connection handling
  wss.on('connection', (ws: ExtendedWebSocket, request) => {
    console.log('🎯 WebSocket client connected');
    console.log('🎯 Request URL:', request.url);
    console.log('🎯 Headers:', request.headers);

    // URL'den roomId ve userId'yi al
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const roomId = url.searchParams.get('roomId');
    const userId = url.searchParams.get('userId');
    const token = url.searchParams.get('token');
    
    console.log('🎯 Parsed URL params - roomId:', roomId, 'userId:', userId, 'token:', token);
    console.log('🎯 Full URL:', request.url);
    console.log('🎯 Search params:', url.searchParams.toString());
    
    if (roomId) {
      ws.roomId = roomId;
      console.log('🎯 Client joined room:', roomId, 'User:', userId);
    } else {
      console.log('🎯 Warning: No roomId found in URL');
      // Fallback: default-room kullan
      ws.roomId = 'default-room';
      console.log('🎯 Using fallback roomId: default-room');
    }

    // Heartbeat için ping-pong mekanizması
    ws.isAlive = true;
    ws.lastPing = Date.now();
    ws.reconnectAttempts = 0;
    
    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastPing = Date.now();
    });

    // Render.com için özel error handling
    ws.on('error', (error) => {
      console.error('🎯 WebSocket error:', error);
      // Render.com'da bağlantı hatalarını logla
      if (error.message.includes('ECONNRESET') || error.message.includes('EPIPE')) {
        console.log('🎯 Render.com connection reset detected');
      }
    });

    ws.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Heartbeat mesajı
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }
        
        if (data.type === 'join_room') {
          // #4 Güvenlik: roomId yoksa bağlantıyı reddet
          if (!data.roomId || typeof data.roomId !== 'string' || data.roomId.trim() === '') {
            console.warn('🚫 WS join_room: geçersiz roomId, bağlantı kapatıldı');
            ws.close(1008, 'Geçersiz roomId');
            return;
          }
          ws.roomId = data.roomId;
          console.log('🎯 Client joined room via message:', data.roomId);
          
          // Odaya yeni katılan kullanıcıya mevcut müzik state'ini gönder
          if (roomMusicState[data.roomId]) {
            ws.send(JSON.stringify({
              type: 'music_state_broadcast',
              state: roomMusicState[data.roomId]
            }));
          }
          
          // Odaya yeni katılan kullanıcıya mevcut video state'ini gönder
          if (roomVideoState[data.roomId]) {
            ws.send(JSON.stringify({
              type: 'video_state_broadcast',
              state: roomVideoState[data.roomId]
            }));
          }
          
          // Odaya yeni katılan kullanıcıya mevcut soundboard state'ini gönder
          if (roomSoundboardState[data.roomId]) {
            ws.send(JSON.stringify({
              type: 'soundboard_state_broadcast',
              state: roomSoundboardState[data.roomId]
            }));
          }
          
          // Odaya yeni katılan kullanıcıya mevcut sohbet mesajlarını gönder
          try {
            const existingMessages = await storage.getChatMessagesByRoom(data.roomId, 50);
            if (existingMessages.length > 0) {
              const formattedMessages = existingMessages.map(msg => ({
                id: 'm' + msg.id,
                user: {
                  id: msg.userId,
                  name: msg.userName,
                  avatar: msg.userAvatar || '/logo.png'
                },
                content: msg.content,
                time: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: msg.messageType as 'text' | 'image' | 'video',
                mediaUrl: msg.mediaUrl
              }));
              
              ws.send(JSON.stringify({
                type: 'chat_history',
                messages: formattedMessages
              }));
            }
          } catch (error) {
            console.error('Error fetching chat history:', error);
          }
        }
        
        // Video state güncellemesi
        if (data.type === 'video_state_update' && ws.roomId) {
          console.log('🎬 Received video state update:', data.state);
          const roomId = ws.roomId;
          roomVideoState[roomId] = {
            ...data.state,
            lastUpdate: Date.now()
          };
          
          // Diğer kullanıcılara video state'ini yayınla
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === roomId && client !== ws) {
              client.send(JSON.stringify({
                type: 'video_state_broadcast',
                state: roomVideoState[roomId],
                timestamp: Date.now()
              }));
            }
          });
        }
        
        // Müzik state güncellemesi
        if (data.type === 'music_state_update' && ws.roomId) {
          roomMusicState[ws.roomId] = data.state;
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
              client.send(JSON.stringify({
                type: 'music_state_broadcast',
                state: data.state
              }));
            }
          });
        }
        
        // Soundboard state güncellemesi
        if (data.type === 'soundboard_state_update' && ws.roomId) {
          roomSoundboardState[ws.roomId] = data.state;
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
              client.send(JSON.stringify({
                type: 'soundboard_state_broadcast',
                state: data.state
              }));
            }
          });
        }
        
        // Soundboard: sesi odadaki herkese çaldır
        if (data.type === 'play_sound' && ws.roomId && data.soundId) {
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
              client.send(JSON.stringify({
                type: 'play_sound',
                soundId: data.soundId
              }));
            }
          });
        }
        
        // Sohbet mesajı gönderme
        if (data.type === 'chat_message' && ws.roomId && data.message) {
          try {
            console.log('💬 Received chat message from:', data.userName, 'in room:', ws.roomId);
            
            // Mesajı database'e kaydet
            const savedMessage = await storage.createChatMessage({
              roomId: ws.roomId,
              userId: data.userId,
              userName: data.userName,
              userAvatar: data.userAvatar,
              content: data.message,
              messageType: 'text',
              mediaUrl: null
            });

            const chatMessage = {
              id: 'm' + savedMessage.id,
              user: {
                id: data.userId,
                name: data.userName,
                avatar: data.userAvatar || '/logo.png'
              },
              content: data.message,
              time: new Date(savedMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              type: 'text' as const
            };
            
            // Odadaki tüm kullanıcılara mesajı gönder
            let clientCount = 0;
            wss.clients.forEach((client: ExtendedWebSocket) => {
              if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
                clientCount++;
                console.log(`💬 Broadcasting to client ${clientCount} in room ${ws.roomId}`);
                client.send(JSON.stringify({
                  type: 'chat_message',
                  message: chatMessage
                }));
              }
            });
            
            console.log(`💬 Broadcasted chat message to ${clientCount} clients in room ${ws.roomId}`);
          } catch (error) {
            console.error('Error saving chat message:', error);
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected from room:', ws.roomId);
    });
  });

  // Heartbeat interval - Render.com için optimize edildi
  const heartbeatInterval = setInterval(() => {
    let activeConnections = 0;
    let terminatedConnections = 0;
    
    wss.clients.forEach((ws: ExtendedWebSocket) => {
      if (ws.isAlive === false) {
        console.log('🎯 Terminating inactive WebSocket connection');
        terminatedConnections++;
        return ws.terminate();
      }
      
      activeConnections++;
      ws.isAlive = false;
      ws.ping();
    });
    
    // Render.com'da bağlantı durumunu logla
    if (activeConnections > 0 || terminatedConnections > 0) {
      console.log(`🎯 WebSocket stats - Active: ${activeConnections}, Terminated: ${terminatedConnections}`);
    }
  }, 30000); // 30 saniyede bir ping

  // Cleanup on server close
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  // Broadcast participant updates to WebSocket clients — tek DB sorgusu (N+1 fix)
  async function broadcastParticipantUpdate(roomId: string) {
    const participants = await storage.getParticipantsByRoom(roomId); // 1 sorgu
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
        client.send(JSON.stringify({
          type: 'participants_update',
          participants
        }));
      }
    });
  }

  // Broadcast music control to WebSocket clients
  function broadcastMusicControl(roomId: string, musicControl: any) {
    console.log(`🎵 Broadcasting music control to room ${roomId}:`, musicControl);
    
    let clientCount = 0;
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
        clientCount++;
        console.log(`🎵 Sending to client ${clientCount}`);
        client.send(JSON.stringify({
          type: 'music_control',
          ...musicControl
        }));
      }
    });
    
    console.log(`🎵 Broadcasted to ${clientCount} clients in room ${roomId}`);
  }

  // Broadcast sound control to WebSocket clients
  function broadcastSoundControl(roomId: string, soundControl: any) {
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
        client.send(JSON.stringify({
          type: 'sound_control',
          ...soundControl
        }));
      }
    });
  }

  // Video state broadcast fonksiyonu
  function broadcastVideoState(roomId: string, videoState: VideoState) {
    console.log(`🎬 Broadcasting video state to room ${roomId}:`, videoState);
    
    let clientCount = 0;
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
        clientCount++;
        client.send(JSON.stringify({
          type: 'video_state_broadcast',
          state: videoState,
          timestamp: Date.now()
        }));
      }
    });
    
    console.log(`🎬 Video state broadcasted to ${clientCount} clients in room ${roomId}`);
  }

  // Video control broadcast fonksiyonu
  function broadcastVideoControl(roomId: string, control: any) {
    console.log(`🎬 Broadcasting video control to room ${roomId}:`, control);
    
    let clientCount = 0;
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
        clientCount++;
        client.send(JSON.stringify({
          type: 'video_control',
          ...control,
          timestamp: Date.now()
        }));
      }
    });
    
    console.log(`🎬 Video control broadcasted to ${clientCount} clients in room ${roomId}`);
  }

  return httpServer;
}
