interface VideoControlsProps {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  showChat: boolean;
  chatCount: number;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onShareScreen: () => void;
  onToggleChat: () => void;
}

const VideoControls = ({
  isAudioEnabled,
  isVideoEnabled,
  isScreenSharing,
  showChat,
  chatCount,
  onToggleAudio,
  onToggleVideo,
  onShareScreen,
  onToggleChat,
}: VideoControlsProps) => (
  <div className="video-controls">
    <button
      onClick={onToggleAudio}
      className={`control-btn ${!isAudioEnabled ? 'disabled' : ''}`}
      title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
    >
      {isAudioEnabled ? '🎤' : '🎤❌'}
    </button>

    <button
      onClick={onToggleVideo}
      className={`control-btn ${!isVideoEnabled ? 'disabled' : ''}`}
      title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
    >
      {isVideoEnabled ? '📷' : '📷❌'}
    </button>

    <button
      onClick={onShareScreen}
      className={`control-btn ${isScreenSharing ? 'active' : ''}`}
      title={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
    >
      {isScreenSharing ? '🖥️❌' : '🖥️'}
    </button>

    <button
      onClick={onToggleChat}
      className={`control-btn ${showChat ? 'active' : ''}`}
      title="Toggle chat"
    >
      💬 {chatCount > 0 && `(${chatCount})`}
    </button>
  </div>
);

export default VideoControls;
