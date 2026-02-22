import { useEffect, useRef } from 'react';
import type { Participant } from '../../types/videoRoom';

interface ParticipantVideoProps {
  participant: Participant;
}

const ParticipantVideo = ({ participant }: ParticipantVideoProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  return (
    <div className="video-container remote-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`video ${!participant.isVideoEnabled ? 'video-disabled' : ''}`}
      />
      <div className="video-overlay">
        <span className="participant-name">{participant.name}</span>
        <div className="media-indicators">
          {!participant.isVideoEnabled && <span className="video-off">📷❌</span>}
          {!participant.isAudioEnabled && <span className="audio-off">🎤❌</span>}
        </div>
      </div>
      {!participant.stream && (
        <div className="connection-status">
          <div className="loading-spinner small"></div>
          <p>Connecting...</p>
        </div>
      )}
    </div>
  );
};

export default ParticipantVideo;
