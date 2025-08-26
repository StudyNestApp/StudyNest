// src/types/index.ts
export interface Room {
  creator: string;
  name: string;
  created_at: string;
  attendance: number;
  video_url: string;
}

export interface ApiResponse {
  success: boolean;
  data: Room[];
  count: number;
  error?: string;
  message?: string;
}

export interface SingleRoomApiResponse {
  success: boolean;
  data: Room;
  error?: string;
  message?: string;
}

export interface Participant {
  id: string;
  name: string;
  socketId: string;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  stream?: MediaStream;
}

export interface ChatMessage {
  id: number;
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
}