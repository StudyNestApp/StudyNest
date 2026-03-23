export interface Room {
  creator: string;
  name: string;
  created_at: string;
  attendance: number;
  video_url?: string;
  hasPassword?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  count?: number;
  error?: string;
  message?: string;
}
