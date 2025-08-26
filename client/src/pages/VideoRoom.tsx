import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { User } from '@supabase/supabase-js';
import './../styles/VideoRoom.css';

interface Participant {
  id: string;
  name: string;
  socketId: string;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  stream?: MediaStream;
}

interface ChatMessage {
  id: number;
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
}

interface VideoRoomProps {
  roomId: string; // This will be the video_url from the room
  user: User;
  onLeave: () => void;
}

// WebRTC configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const VideoRoom: React.FC<VideoRoomProps> = ({ roomId, user, onLeave }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [roomName, setRoomName] = useState('');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initializeVideoRoom();
    return () => cleanup();
  }, []);

  useEffect(() => {
    // Auto-scroll chat to bottom
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const initializeVideoRoom = async () => {
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Initialize Socket.io connection
      const socketConnection = io('http://localhost:5000');
      setSocket(socketConnection);

      // Use roomId as the room identifier for Socket.io
      const userName = user.email?.split('@')[0] || 'Anonymous';
      setRoomName(roomId.substring(0, 8)); // Show shortened room ID
      
      // Join the room using the video_url as room identifier
      socketConnection.emit('join-room', roomId, user.id, userName);

      setupSocketListeners(socketConnection, stream);
      setIsConnecting(false);

    } catch (error) {
      console.error('Error initializing video room:', error);
      setIsConnecting(false);
      // Handle permission denied or other errors
      alert('Failed to access camera/microphone. Please check permissions.');
    }
  };

  const setupSocketListeners = (socketConnection: Socket, stream: MediaStream) => {
    // Handle existing participants
    socketConnection.on('existing-participants', (existingParticipants: Participant[]) => {
      console.log('Existing participants:', existingParticipants);
      existingParticipants.forEach(participant => {
        createPeerConnection(participant, stream, true); // true = initiator
      });
    });

    // Handle new user joined
    socketConnection.on('user-joined', (participant: Participant) => {
      console.log('User joined:', participant);
      createPeerConnection(participant, stream, false); // false = not initiator
    });

    // Handle user left
    socketConnection.on('user-left', (data: { userId: string; userName: string }) => {
      console.log('User left:', data);
      const peerConnection = peerConnections.current.get(data.userId);
      if (peerConnection) {
        peerConnection.close();
        peerConnections.current.delete(data.userId);
      }
      
      setParticipants(prev => {
        const newParticipants = new Map(prev);
        newParticipants.delete(data.userId);
        return newParticipants;
      });
    });

    // Handle WebRTC signaling
    socketConnection.on('offer', handleOffer);
    socketConnection.on('answer', handleAnswer);
    socketConnection.on('ice-candidate', handleIceCandidate);

    // Handle media changes
    socketConnection.on('participant-media-changed', (data) => {
      setParticipants(prev => {
        const newParticipants = new Map(prev);
        const participant = newParticipants.get(data.userId);
        if (participant) {
          participant.isVideoEnabled = data.isVideoEnabled;
          participant.isAudioEnabled = data.isAudioEnabled;
        }
        return newParticipants;
      });
    });

    // Handle chat messages
    socketConnection.on('chat-message', (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]);
    });

    // Handle screen sharing events
    socketConnection.on('user-started-screen-share', (data) => {
      console.log(`${data.userName} started screen sharing`);
      // You can show a notification or update UI here
    });

    socketConnection.on('user-stopped-screen-share', (data) => {
      console.log(`${data.userName} stopped screen sharing`);
      // You can show a notification or update UI here
    });
  };

  const createPeerConnection = async (participant: Participant, stream: MediaStream, isInitiator: boolean) => {
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections.current.set(participant.id, peerConnection);

    // Add local stream tracks to peer connection
    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });

    // Handle incoming stream
    peerConnection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setParticipants(prev => {
        const newParticipants = new Map(prev);
        const existingParticipant = newParticipants.get(participant.id);
        if (existingParticipant) {
          existingParticipant.stream = remoteStream;
        } else {
          newParticipants.set(participant.id, { ...participant, stream: remoteStream });
        }
        return newParticipants;
      });
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', {
          candidate: event.candidate,
          targetSocketId: participant.socketId
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state with ${participant.name}: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === 'failed') {
        // Try to restart ICE
        peerConnection.restartIce();
      }
    };

    // If initiator, create offer
    if (isInitiator) {
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket?.emit('offer', {
          offer,
          targetUserId: participant.id,
          targetSocketId: participant.socketId
        });
      } catch (error) {
        console.error('Error creating offer:', error);
      }
    }

    // Add participant to state
    setParticipants(prev => {
      const newParticipants = new Map(prev);
      newParticipants.set(participant.id, participant);
      return newParticipants;
    });
  };

  const handleOffer = async (data: any) => {
    const peerConnection = peerConnections.current.get(data.fromUserId);
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(data.offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket?.emit('answer', {
          answer,
          targetUserId: data.fromUserId,
          targetSocketId: data.fromSocketId
        });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    }
  };

  const handleAnswer = async (data: any) => {
    const peerConnection = peerConnections.current.get(data.fromUserId);
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(data.answer);
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  };

  const handleIceCandidate = async (data: any) => {
    const peerConnection = peerConnections.current.get(data.fromUserId);
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(data.candidate);
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        socket?.emit('toggle-media', { video: videoTrack.enabled });
      }
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        socket?.emit('toggle-media', { audio: audioTrack.enabled });
      }
    }
  };

  const shareScreen = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });

        // Replace video track for all peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        peerConnections.current.forEach(peerConnection => {
          const sender = peerConnection.getSenders().find(s => 
            s.track && s.track.kind === 'video'
          );
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });

        // Update local video
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        setIsScreenSharing(true);
        socket?.emit('start-screen-share');

        // Handle screen share end
        videoTrack.addEventListener('ended', stopScreenShare);
      } catch (error) {
        console.error('Error sharing screen:', error);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      
      // Replace screen share track back to camera
      peerConnections.current.forEach(peerConnection => {
        const sender = peerConnection.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      });

      // Update local video back to camera
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
    }

    setIsScreenSharing(false);
    socket?.emit('stop-screen-share');
  };

  const sendChatMessage = () => {
    if (newMessage.trim() && socket) {
      socket.emit('chat-message', newMessage);
      setNewMessage('');
    }
  };

  const handleLeaveRoom = () => {
    cleanup();
    onLeave();
  };

  const cleanup = () => {
    // Close all peer connections
    peerConnections.current.forEach(peerConnection => {
      peerConnection.close();
    });
    peerConnections.current.clear();

    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    // Disconnect socket
    if (socket) {
      socket.disconnect();
    }
  };

  if (isConnecting) {
    return (
      <div className="video-room-loading">
        <div className="loading-spinner"></div>
        <p>Connecting to video room...</p>
      </div>
    );
  }

  return (
    <div className="video-room-container">
      <div className="video-room-header">
        <h2>Study Room: {roomName}</h2>
        <div className="participant-count">
          {participants.size + 1} participant{participants.size !== 0 ? 's' : ''}
        </div>
        <button onClick={handleLeaveRoom} className="leave-room-btn">
          Leave Room
        </button>
      </div>

      <div className="video-room-content">
        <div className="video-grid">
          {/* Local video */}
          <div className="video-container local-video">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`video ${!isVideoEnabled ? 'video-disabled' : ''}`}
            />
            <div className="video-overlay">
              <span className="participant-name">You</span>
              <div className="media-indicators">
                {!isVideoEnabled && <span className="video-off">📷❌</span>}
                {!isAudioEnabled && <span className="audio-off">🎤❌</span>}
                {isScreenSharing && <span className="screen-share">🖥️</span>}
              </div>
            </div>
          </div>

          {/* Remote videos */}
          {Array.from(participants.values()).map(participant => (
            <ParticipantVideo key={participant.id} participant={participant} />
          ))}
        </div>

        {/* Controls */}
        <div className="video-controls">
          <button
            onClick={toggleAudio}
            className={`control-btn ${!isAudioEnabled ? 'disabled' : ''}`}
            title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {isAudioEnabled ? '🎤' : '🎤❌'}
          </button>
          
          <button
            onClick={toggleVideo}
            className={`control-btn ${!isVideoEnabled ? 'disabled' : ''}`}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isVideoEnabled ? '📷' : '📷❌'}
          </button>
          
          <button 
            onClick={shareScreen} 
            className={`control-btn ${isScreenSharing ? 'active' : ''}`}
            title={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
          >
            {isScreenSharing ? '🖥️❌' : '🖥️'}
          </button>
          
          <button
            onClick={() => setShowChat(!showChat)}
            className={`control-btn ${showChat ? 'active' : ''}`}
            title="Toggle chat"
          >
            💬 {chatMessages.length > 0 && `(${chatMessages.length})`}
          </button>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div className="chat-panel">
          <div className="chat-header">
            <h3>Chat</h3>
            <button onClick={() => setShowChat(false)}>❌</button>
          </div>
          <div className="chat-messages" ref={chatContainerRef}>
            {chatMessages.length === 0 ? (
              <div className="chat-empty">
                <p>No messages yet. Start the conversation!</p>
              </div>
            ) : (
              chatMessages.map(message => (
                <div key={message.id} className="chat-message">
                  <span className="message-author">{message.userName}:</span>
                  <span className="message-content">{message.message}</span>
                  <span className="message-time">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="chat-input">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
              placeholder="Type a message..."
              maxLength={500}
            />
            <button 
              onClick={sendChatMessage}
              disabled={!newMessage.trim()}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Participant Video Component
const ParticipantVideo: React.FC<{ participant: Participant }> = ({ participant }) => {
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

export default VideoRoom;