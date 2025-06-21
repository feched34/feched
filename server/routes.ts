import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertParticipantSchema, type LiveKitTokenRequest, type LiveKitTokenResponse } from "@shared/schema";
import { AccessToken } from "livekit-server-sdk";

interface ExtendedWebSocket extends WebSocket {
  roomId?: string;
}

// Oda bazlı soundboard state'ini memory'de tutmak için
type SoundboardState = { sounds: any[] };
const roomSoundboardState: Record<string, SoundboardState> = {};

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server for real-time participant updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // LiveKit configuration
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
  const LIVEKIT_WS_URL = process.env.LIVEKIT_WS_URL;

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
    console.error("Missing required LiveKit environment variables");
    console.error("LIVEKIT_API_KEY:", !!LIVEKIT_API_KEY);
    console.error("LIVEKIT_API_SECRET:", !!LIVEKIT_API_SECRET);
    console.error("LIVEKIT_WS_URL:", LIVEKIT_WS_URL);
    console.error("Available env vars:", Object.keys(process.env).filter(key => key.includes('LIVEKIT')));
  }

  // Oda bazlı müzik state'ini memory'de tutmak için
  const roomMusicState: Record<string, any> = {};

  // Generate LiveKit token
  app.post("/api/auth", async (req, res) => {
    try {
      const { nickname, roomName }: LiveKitTokenRequest = req.body;

      if (!nickname || !roomName) {
        return res.status(400).json({ message: "Nickname and room name are required" });
      }

      // Create access token
      console.log(`Creating token for user: ${nickname}, room: ${roomName}`);
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: nickname,
        ttl: '1h',
      });

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const jwt = await token.toJwt();
      console.log(`Generated token for ${nickname}: ${jwt.substring(0, 50)}...`);

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

  // YouTube API endpoint
  app.get("/api/youtube/search", async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Query parameter 'q' is required" });
      }

      const YOUTUBE_API_KEY = process.env.VITE_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
      
      if (!YOUTUBE_API_KEY) {
        console.error("YouTube API key not found");
        return res.status(500).json({ message: "YouTube API not configured" });
      }

      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(q)}&type=video&key=${YOUTUBE_API_KEY}`;
      
      console.log(`Searching YouTube for: ${q}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`YouTube search results: ${data.items?.length || 0} items found`);
      
      res.json(data);
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
      const { roomId, videoId, userId } = req.body;
      
      if (!roomId || !videoId || !userId) {
        return res.status(400).json({ message: "Room ID, video ID and user ID are required" });
      }

      // WebSocket ile müzik çalma komutunu yayınla
      broadcastMusicControl(roomId, {
        type: 'play',
        videoId,
        userId,
        timestamp: Date.now()
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Music play error:", error);
      res.status(500).json({ message: "Failed to play music" });
    }
  });

  app.post("/api/music/pause", async (req, res) => {
    try {
      const { roomId, userId } = req.body;
      
      if (!roomId || !userId) {
        return res.status(400).json({ message: "Room ID and user ID are required" });
      }

      // WebSocket ile müzik duraklatma komutunu yayınla
      broadcastMusicControl(roomId, {
        type: 'pause',
        userId,
        timestamp: Date.now()
      });

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

  // WebSocket connection handling
  wss.on('connection', (ws: ExtendedWebSocket) => {
    console.log('WebSocket client connected');

    ws.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'join_room') {
          ws.roomId = data.roomId;
          // Odaya yeni katılan kullanıcıya mevcut müzik state'ini gönder
          if (roomMusicState[data.roomId]) {
            ws.send(JSON.stringify({
              type: 'music_state_broadcast',
              state: roomMusicState[data.roomId]
            }));
          }
          // Odaya yeni katılan kullanıcıya mevcut soundboard state'ini gönder
          if (roomSoundboardState[data.roomId]) {
            ws.send(JSON.stringify({
              type: 'soundboard_state_broadcast',
              state: roomSoundboardState[data.roomId]
            }));
          }
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
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });

  // Broadcast participant updates to WebSocket clients
  function broadcastParticipantUpdate(roomId: string) {
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
        storage.getParticipantsByRoom(roomId).then(participants => {
          client.send(JSON.stringify({
            type: 'participants_update',
            participants
          }));
        });
      }
    });
  }

  // Broadcast music control to WebSocket clients
  function broadcastMusicControl(roomId: string, musicControl: any) {
    wss.clients.forEach((client: ExtendedWebSocket) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId) {
        client.send(JSON.stringify({
          type: 'music_control',
          ...musicControl
        }));
      }
    });
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

  return httpServer;
}
