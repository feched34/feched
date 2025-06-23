import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const participants = pgTable("participants", {
  id: serial("id").primaryKey(),
  nickname: text("nickname").notNull(),
  roomId: text("room_id").notNull(),
  isConnected: boolean("is_connected").notNull().default(true),
  isMuted: boolean("is_muted").notNull().default(false),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userAvatar: text("user_avatar"),
  content: text("content").notNull(),
  messageType: text("message_type").notNull().default('text'),
  mediaUrl: text("media_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertParticipantSchema = createInsertSchema(participants).pick({
  nickname: true,
  roomId: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).pick({
  roomId: true,
  userId: true,
  userName: true,
  userAvatar: true,
  content: true,
  messageType: true,
  mediaUrl: true,
});

export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type Participant = typeof participants.$inferSelect;

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export interface LiveKitTokenRequest {
  nickname: string;
  roomName: string;
}

export interface LiveKitTokenResponse {
  token: string;
  wsUrl: string;
}
