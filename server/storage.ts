import { participants, chatMessages, type Participant, type InsertParticipant, type ChatMessage, type InsertChatMessage } from "@shared/schema";

export interface IStorage {
  getParticipant(id: number): Promise<Participant | undefined>;
  getParticipantsByRoom(roomId: string): Promise<Participant[]>;
  createParticipant(participant: InsertParticipant): Promise<Participant>;
  updateParticipantConnection(id: number, isConnected: boolean): Promise<void>;
  updateParticipantMute(id: number, isMuted: boolean): Promise<void>;
  removeParticipant(id: number): Promise<void>;
  
  // Chat message functions
  getChatMessagesByRoom(roomId: string, limit?: number): Promise<ChatMessage[]>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  deleteChatMessagesByRoom(roomId: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private participants: Map<number, Participant>;
  private chatMessages: Map<number, ChatMessage>;
  currentId: number;
  currentMessageId: number;

  constructor() {
    this.participants = new Map();
    this.chatMessages = new Map();
    this.currentId = 1;
    this.currentMessageId = 1;
  }

  async getParticipant(id: number): Promise<Participant | undefined> {
    return this.participants.get(id);
  }

  async getParticipantsByRoom(roomId: string): Promise<Participant[]> {
    return Array.from(this.participants.values()).filter(
      (participant) => participant.roomId === roomId && participant.isConnected,
    );
  }

  async createParticipant(insertParticipant: InsertParticipant): Promise<Participant> {
    const id = this.currentId++;
    const participant: Participant = {
      ...insertParticipant,
      id,
      isConnected: true,
      isMuted: false,
      joinedAt: new Date(),
    };
    this.participants.set(id, participant);
    return participant;
  }

  async updateParticipantConnection(id: number, isConnected: boolean): Promise<void> {
    const participant = this.participants.get(id);
    if (participant) {
      participant.isConnected = isConnected;
      this.participants.set(id, participant);
    }
  }

  async updateParticipantMute(id: number, isMuted: boolean): Promise<void> {
    const participant = this.participants.get(id);
    if (participant) {
      participant.isMuted = isMuted;
      this.participants.set(id, participant);
    }
  }

  async removeParticipant(id: number): Promise<void> {
    this.participants.delete(id);
  }

  // Chat message functions
  async getChatMessagesByRoom(roomId: string, limit: number = 50): Promise<ChatMessage[]> {
    const messages = Array.from(this.chatMessages.values())
      .filter(message => message.roomId === roomId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-limit);
    return messages;
  }

  async createChatMessage(insertMessage: InsertChatMessage): Promise<ChatMessage> {
    const id = this.currentMessageId++;
    const message: ChatMessage = {
      ...insertMessage,
      id,
      userAvatar: insertMessage.userAvatar || null,
      messageType: insertMessage.messageType || 'text',
      mediaUrl: insertMessage.mediaUrl || null,
      createdAt: new Date(),
    };
    this.chatMessages.set(id, message);
    return message;
  }

  async deleteChatMessagesByRoom(roomId: string): Promise<void> {
    const messagesToDelete = Array.from(this.chatMessages.values())
      .filter(message => message.roomId === roomId);
    
    messagesToDelete.forEach(message => {
      this.chatMessages.delete(message.id);
    });
  }
}

export const storage = new MemStorage();
