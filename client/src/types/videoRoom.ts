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
