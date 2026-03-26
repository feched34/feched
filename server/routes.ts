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
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

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

// Cloudinary yapılandırması
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Multer — dosyayı diske değil memory'e al (Cloudinary'e stream edeceğiz)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req: any, file: Express.Multer.File, cb: any) => {
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

// Buffer'ı Cloudinary'e stream olarak yükle
function uploadToCloudinary(buffer: Buffer, filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const publicId = `sounds/${Date.now()}-${filename.replace(/\.[^/.]+$/, '')}`;
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video', // Cloudinary ses dosyaları için 'video' kullanır
        public_id: publicId,
        folder: 'soundboard',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result!.secure_url);
      }
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Render.com için WebSocket proxy ayarları
  app.use('/ws', (req, res, next) => {
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      console.log('🎯 WebSocket upgrade request detected');
      res.setHeader('Upgrade', 'websocket');
      res.setHeader('Connection', 'Upgrade');
      res.setHeader('Sec-WebSocket-Accept', 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    }
    next();
  });

  // WebSocket server
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws',
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
    skipUTF8Validation: true,
    handleProtocols: () => 'websocket',
    clientTracking: true
  });

  // LiveKit configuration
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
  const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL;

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
    console.warn("⚠️  Missing required LiveKit environment variables");
  }

  // Oda bazlı müzik state'ini memory'de tutmak için
  const roomMusicState: Record<string, any> = {};

  // Rate limiting
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: { message: "Çok fazla istek. Lütfen bekleyin." }
  });
  const youtubeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { message: "Çok fazla arama isteği. Lütfen bekleyin." }
  });

  // ─── SES DOSYASI YÜKLEME — Cloudinary ───────────────────────────────────────
  app.post("/api/sound/upload", upload.single('sound'), async (req, res) => {
    try {
      const { roomId, userId } = req.body;
      const file = req.file;

      if (!roomId || !userId || !file) {
        return res.status(400).json({ message: "Room ID, user ID and sound file are required" });
      }

      // Cloudinary'e yükle
      let cloudinaryUrl: string;
      try {
        cloudinaryUrl = await uploadToCloudinary(file.buffer, file.originalname);
        console.log(`☁️ Ses dosyası Cloudinary'e yüklendi: ${cloudinaryUrl}`);
      } catch (cloudErr) {
        console.error('Cloudinary upload error:', cloudErr);
        return res.status(500).json({ message: "Ses dosyası yüklenemedi" });
      }

      const soundData = {
        id: `sound_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: file.originalname,
        filename: file.originalname,
        path: cloudinaryUrl, // Artık kalıcı Cloudinary URL'si
        uploadedBy: userId,
        uploadedAt: new Date().toISOString(),
        size: file.size,
        mimetype: file.mimetype
      };

      if (!roomSoundboardState[roomId]) {
        roomSoundboardState[roomId] = { sounds: [] };
      }
      roomSoundboardState[roomId].sounds.push(soundData);

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

  // Artık /uploads/sounds static endpoint'i gerekmez — URL direkt Cloudinary'den gelir

  // Generate LiveKit token
  app.post("/api/auth", authLimiter, async (req, res) => {
    try {
      if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
        return res.status(503).json({ 
          message: "Voice chat service is temporarily unavailable.",
          error: "LIVEKIT_NOT_CONFIGURED"
        });
      }

      const { nickname, roomName }: LiveKitTokenRequest = req.body;

      if (!nickname || !roomName) {
        return res.status(400).json({ message: "Nickname and room name are required" });
      }

      // Oda adını normalize et — büyük/küçük harf duyarsızlığı için lowercase
      const normalizedRoom = roomName.trim().toLowerCase();

      const timestamp = Date.now();
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: `${nickname}_${timestamp}`,
        ttl: '4h',
      });

      token.addGrant({
        room: normalizedRoom,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const jwt = await token.toJwt();
      console.log(`Generated token for ${nickname}_${timestamp}`);

      await storage.createParticipant({ nickname, roomId: normalizedRoom });
      broadcastParticipantUpdate(normalizedRoom);

      res.json({ token: jwt, wsUrl: LIVEKIT_WS_URL! } as LiveKitTokenResponse);
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
      if (participant) broadcastParticipantUpdate(participant.roomId);
      res.json({ success: true });
    } catch (error) {
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
      res.status(500).json({ message: "Failed to remove participant" });
    }
  });

  // YouTube arama endpoint
  app.get("/api/youtube/search", youtubeLimiter, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Query parameter 'q' is required" });
      }

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
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
          clearTimeout(timeout);
          if (!response.ok) throw new Error(`Invidious API error: ${response.status}`);
          const results = await response.json();
          if (results && Array.isArray(results) && results.length > 0) {
            const video = results.find((r: any) => r.type === 'video');
            if (!video) throw new Error('No video results found');
            return res.json({
              items: [{
                id: { videoId: video.videoId },
                snippet: {
                  title: video.title,
                  channelTitle: video.author || 'Bilinmeyen Sanatçı',
                  thumbnails: { medium: { url: video.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg` } }
                }
              }]
            });
          }
        } catch (instanceError: any) {
          lastError = instanceError;
          continue;
        }
      }

      const YOUTUBE_API_KEY = process.env.VITE_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
      if (YOUTUBE_API_KEY) {
        try {
          const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(q)}&type=video&key=${YOUTUBE_API_KEY}`;
          const response = await fetch(url);
          if (response.ok) return res.json(await response.json());
        } catch {}
      }

      throw lastError || new Error('All search instances failed');
    } catch (error: any) {
      res.status(500).json({ message: "Failed to search YouTube", error: error.message });
    }
  });

  // Ping
  app.get("/api/ping", (_req, res) => {
    res.json({ success: true, timestamp: Date.now(), message: "pong" });
  });

  // Müzik kontrol endpoint'leri
  app.post("/api/music/play", async (req, res) => {
    try {
      const { roomId, videoId, userId, currentTime = 0 } = req.body;
      if (!roomId || !videoId || !userId) return res.status(400).json({ message: "Room ID, video ID and user ID are required" });
      if (!roomVideoState[roomId]) roomVideoState[roomId] = { isPlaying: false, currentVideoId: null, currentTime: 0, duration: 0, lastUpdate: Date.now() };
      roomVideoState[roomId] = { ...roomVideoState[roomId], isPlaying: true, currentVideoId: videoId, currentTime, lastUpdate: Date.now() };
      broadcastVideoState(roomId, roomVideoState[roomId]);
      broadcastMusicControl(roomId, { type: 'play', videoId, userId, currentTime, timestamp: Date.now() });
      if (!roomMusicState[roomId]) roomMusicState[roomId] = { isPlaying: false, currentVideoId: null };
      roomMusicState[roomId].isPlaying = true;
      roomMusicState[roomId].currentVideoId = videoId;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to play music" });
    }
  });

  app.post("/api/music/pause", async (req, res) => {
    try {
      const { roomId, userId, currentTime = 0 } = req.body;
      if (!roomId || !userId) return res.status(400).json({ message: "Room ID and user ID are required" });
      if (roomVideoState[roomId]) {
        roomVideoState[roomId].isPlaying = false;
        roomVideoState[roomId].currentTime = currentTime;
        roomVideoState[roomId].lastUpdate = Date.now();
        broadcastVideoState(roomId, roomVideoState[roomId]);
      }
      broadcastMusicControl(roomId, { type: 'pause', userId, currentTime, timestamp: Date.now() });
      if (roomMusicState[roomId]) roomMusicState[roomId].isPlaying = false;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to pause music" });
    }
  });

  app.post("/api/music/stop", async (req, res) => {
    try {
      const { roomId, userId } = req.body;
      if (!roomId || !userId) return res.status(400).json({ message: "Room ID and user ID are required" });
      if (roomVideoState[roomId]) {
        roomVideoState[roomId].isPlaying = false;
        roomVideoState[roomId].currentVideoId = null;
        roomVideoState[roomId].currentTime = 0;
        roomVideoState[roomId].lastUpdate = Date.now();
        broadcastVideoState(roomId, roomVideoState[roomId]);
      }
      broadcastMusicControl(roomId, { type: 'stop', userId, timestamp: Date.now() });
      if (roomMusicState[roomId]) {
        roomMusicState[roomId].isPlaying = false;
        roomMusicState[roomId].currentVideoId = null;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop music" });
    }
  });

  app.post("/api/music/queue", async (req, res) => {
    try {
      const { roomId, song, userId } = req.body;
      if (!roomId || !song || !userId) return res.status(400).json({ message: "Room ID, song and user ID are required" });
      broadcastMusicControl(roomId, { type: 'add_to_queue', song, userId, timestamp: Date.now() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to add to queue" });
    }
  });

  app.post("/api/music/shuffle", async (req, res) => {
    try {
      const { roomId, userId, isShuffled } = req.body;
      if (!roomId || !userId || typeof isShuffled !== 'boolean') return res.status(400).json({ message: "Room ID, user ID and shuffle state are required" });
      broadcastMusicControl(roomId, { type: 'shuffle', isShuffled, userId, timestamp: Date.now() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to toggle shuffle" });
    }
  });

  app.post("/api/music/repeat", async (req, res) => {
    try {
      const { roomId, userId, repeatMode } = req.body;
      if (!roomId || !userId || !repeatMode) return res.status(400).json({ message: "Room ID, user ID and repeat mode are required" });
      broadcastMusicControl(roomId, { type: 'repeat', repeatMode, userId, timestamp: Date.now() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to set repeat mode" });
    }
  });

  // Ses kontrol endpoint'leri
  app.post("/api/sound/play", async (req, res) => {
    try {
      const { roomId, soundId, userId } = req.body;
      if (!roomId || !soundId || !userId) return res.status(400).json({ message: "Room ID, sound ID and user ID are required" });
      broadcastSoundControl(roomId, { type: 'play_sound', soundId, userId, timestamp: Date.now() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to play sound" });
    }
  });

  app.post("/api/sound/stop", async (req, res) => {
    try {
      const { roomId, soundId, userId } = req.body;
      if (!roomId || !soundId || !userId) return res.status(400).json({ message: "Room ID, sound ID and user ID are required" });
      broadcastSoundControl(roomId, { type: 'stop_sound', soundId, userId, timestamp: Date.now() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop sound" });
    }
  });

  // Video state güncelleme
  app.post("/api/video/state", async (req, res) => {
    try {
      const { roomId, userId, isPlaying, currentTime, duration, videoId } = req.body;
      if (!roomId || !userId) return res.status(400).json({ message: "Room ID and user ID are required" });
      if (!roomVideoState[roomId]) roomVideoState[roomId] = { isPlaying: false, currentVideoId: null, currentTime: 0, duration: 0, lastUpdate: Date.now() };
      roomVideoState[roomId] = { isPlaying, currentTime: currentTime || 0, duration: duration || 0, currentVideoId: videoId, lastUpdate: Date.now() };
      broadcastVideoState(roomId, roomVideoState[roomId]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to update video state" });
    }
  });

  // Chat messages
  app.get("/api/chat/:roomId/messages", async (req, res) => {
    try {
      const { roomId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      res.json(await storage.getChatMessagesByRoom(roomId, limit));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch chat messages" });
    }
  });

  app.post("/api/chat/:roomId/messages", async (req, res) => {
    try {
      const { roomId } = req.params;
      const { userId, userName, userAvatar, content, messageType = 'text', mediaUrl } = req.body;
      if (!userId || !userName || !content) return res.status(400).json({ message: "User ID, user name and content are required" });

      const message = await storage.createChatMessage({ roomId, userId, userName, userAvatar, content, messageType, mediaUrl });
      const chatMessage = {
        id: 'm' + message.id,
        user: { id: message.userId, name: message.userName, avatar: message.userAvatar || '/logo.png' },
        content: message.content,
        time: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: message.messageType as 'text' | 'image' | 'video',
        mediaUrl: message.mediaUrl
      };

      // WebSocket üzerinden broadcast
      wss.clients.forEach((client: any) => {
        if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
          client.send(JSON.stringify({ type: 'chat_message', message: chatMessage }));
        }
      });

      res.json({ success: true, message });
    } catch (error) {
      res.status(500).json({ message: "Failed to create chat message" });
    }
  });

  app.delete("/api/chat/:roomId/messages", async (req, res) => {
    try {
      await storage.deleteChatMessagesByRoom(req.params.roomId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete chat messages" });
    }
  });

  // SSE endpoint (sadece history için — yeni mesajlar WebSocket üzerinden geliyor)
  const sseClients: Record<string, Map<string, any>> = {};

  app.get('/api/chat/:roomId/events', (req, res) => {
    const { roomId } = req.params;
    const { userId } = req.query;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', roomId, userId })}\n\n`);
    const clientId = `${roomId}-${userId}-${Date.now()}`;
    if (!sseClients[roomId]) sseClients[roomId] = new Map();
    sseClients[roomId].set(clientId, res);

    storage.getChatMessagesByRoom(roomId, 50).then(messages => {
      if (messages.length > 0) {
        const formatted = messages.map(msg => ({
          id: 'm' + msg.id,
          user: { id: msg.userId, name: msg.userName, avatar: msg.userAvatar || '/logo.png' },
          content: msg.content,
          time: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: msg.messageType as 'text' | 'image' | 'video',
          mediaUrl: msg.mediaUrl
        }));
        res.write(`data: ${JSON.stringify({ type: 'chat_history', messages: formatted })}\n\n`);
      }
    }).catch(console.error);

    const keepAlive = setInterval(() => {
      if (res.writableEnded || res.destroyed) { clearInterval(keepAlive); return; }
      try { res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`); }
      catch { clearInterval(keepAlive); }
    }, 15000);

    const cleanup = () => {
      if (sseClients[roomId]) {
        sseClients[roomId].delete(clientId);
        if (sseClients[roomId].size === 0) delete sseClients[roomId];
      }
      clearInterval(keepAlive);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  // WebSocket connection handling
  wss.on('connection', (ws: ExtendedWebSocket, request) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const roomId = url.searchParams.get('roomId');
    ws.roomId = roomId || 'default-room';
    ws.isAlive = true;
    ws.lastPing = Date.now();
    ws.reconnectAttempts = 0;

    ws.on('pong', () => { ws.isAlive = true; ws.lastPing = Date.now(); });
    ws.on('error', (error) => { console.error('🎯 WebSocket error:', error.message); });

    ws.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }

        if (data.type === 'join_room') {
          if (!data.roomId || typeof data.roomId !== 'string' || !data.roomId.trim()) {
            ws.close(1008, 'Geçersiz roomId');
            return;
          }
          ws.roomId = data.roomId;
          if (roomMusicState[data.roomId]) ws.send(JSON.stringify({ type: 'music_state_broadcast', state: roomMusicState[data.roomId] }));
          if (roomVideoState[data.roomId]) ws.send(JSON.stringify({ type: 'video_state_broadcast', state: roomVideoState[data.roomId] }));
          if (roomSoundboardState[data.roomId]) ws.send(JSON.stringify({ type: 'soundboard_state_broadcast', state: roomSoundboardState[data.roomId] }));
          try {
            const msgs = await storage.getChatMessagesByRoom(data.roomId, 50);
            if (msgs.length > 0) {
              const formatted = msgs.map(msg => ({
                id: 'm' + msg.id,
                user: { id: msg.userId, name: msg.userName, avatar: msg.userAvatar || '/logo.png' },
                content: msg.content,
                time: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: msg.messageType as 'text' | 'image' | 'video',
                mediaUrl: msg.mediaUrl
              }));
              ws.send(JSON.stringify({ type: 'chat_history', messages: formatted }));
            }
          } catch (e) { console.error('Error fetching chat history:', e); }
        }

        if (data.type === 'video_state_update' && ws.roomId) {
          roomVideoState[ws.roomId] = { ...data.state, lastUpdate: Date.now() };
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId && client !== ws)
              client.send(JSON.stringify({ type: 'video_state_broadcast', state: roomVideoState[ws.roomId!], timestamp: Date.now() }));
          });
        }

        if (data.type === 'music_state_update' && ws.roomId) {
          // Queue dahil tüm state'i merge ederek sakla (yeni katılan kullanıcılar için)
          const musicRoomKey = ws.roomId;
          roomMusicState[musicRoomKey] = {
            ...roomMusicState[musicRoomKey],
            ...data.state,
            queue: data.state.queue || roomMusicState[musicRoomKey]?.queue || [],
          };
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === musicRoomKey)
              client.send(JSON.stringify({ type: 'music_state_broadcast', state: roomMusicState[musicRoomKey] }));
          });
        }

        if (data.type === 'soundboard_state_update' && ws.roomId) {
          roomSoundboardState[ws.roomId] = data.state;
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId)
              client.send(JSON.stringify({ type: 'soundboard_state_broadcast', state: data.state }));
          });
        }

        if (data.type === 'play_sound' && ws.roomId && data.soundId) {
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId)
              client.send(JSON.stringify({ type: 'play_sound', soundId: data.soundId }));
          });
        }

        if (data.type === 'chat_message' && ws.roomId && data.message) {
          const savedMessage = await storage.createChatMessage({
            roomId: ws.roomId, userId: data.userId, userName: data.userName,
            userAvatar: data.userAvatar, content: data.message, messageType: 'text', mediaUrl: null
          });
          const chatMessage = {
            id: 'm' + savedMessage.id,
            user: { id: data.userId, name: data.userName, avatar: data.userAvatar || '/logo.png' },
            content: data.message,
            time: new Date(savedMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'text' as const
          };
          wss.clients.forEach((client: ExtendedWebSocket) => {
            if (client.readyState === WebSocket.OPEN && client.roomId === ws.roomId)
              client.send(JSON.stringify({ type: 'chat_message', message: chatMessage }));
          });
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => { console.log('WebSocket client disconnected from room:', ws.roomId); });
  });

  // Heartbeat — 30s
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: ExtendedWebSocket) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeatInterval));

  // Broadcast participant updates — tek DB sorgusu (N+1 fix)
  async function broadcastParticipantUpdate(roomId: string) {
    const participants = await storage.getParticipantsByRoom(roomId);
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId)
        client.send(JSON.stringify({ type: 'participants_update', participants }));
    });
  }

  function broadcastMusicControl(roomId: string, musicControl: any) {
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId)
        client.send(JSON.stringify({ type: 'music_control', ...musicControl }));
    });
  }

  function broadcastSoundControl(roomId: string, soundControl: any) {
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId)
        client.send(JSON.stringify({ type: 'sound_control', ...soundControl }));
    });
  }

  function broadcastVideoState(roomId: string, videoState: VideoState) {
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId)
        client.send(JSON.stringify({ type: 'video_state_broadcast', state: videoState, timestamp: Date.now() }));
    });
  }

  return httpServer;
}
