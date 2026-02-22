import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  MessageCircle,
  X,
  User as UserIcon,
} from 'lucide-react';
import { SERVER_URL } from '../lib/serverConfig';
import type { User } from '@supabase/supabase-js';
import './../styles/VideoRoom.css';

const DEBUG_WEBRTC = import.meta.env.VITE_DEBUG_WEBRTC === 'true';

const debugLog = (...args: unknown[]) => {
  if (DEBUG_WEBRTC) {
    console.log(...args);
  }
};

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
  roomName: string; // Database room name
  user: User;
  onLeave: () => void;
}

interface UserLeftPayload {
  userId: string;
  userName: string;
  socketId?: string;
}

interface ParticipantMediaChangedPayload {
  userId: string;
  socketId?: string;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
}

interface OfferPayload {
  offer: RTCSessionDescriptionInit;
  fromUserId: string;
  fromSocketId: string;
}

interface AnswerPayload {
  answer: RTCSessionDescriptionInit;
  fromUserId: string;
  fromSocketId: string;
}

interface IceCandidatePayload {
  candidate: RTCIceCandidateInit;
  fromUserId: string;
  fromSocketId: string;
}

// WebRTC configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const VideoRoom: React.FC<VideoRoomProps> = ({ roomId, roomName: roomNameProp, user, onLeave }) => {
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
  const [localSocketId, setLocalSocketId] = useState('');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const localSocketIdRef = useRef('');
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  useEffect(() => {
    // Auto-scroll chat to bottom
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const attachLocalPreview = useCallback(async (stream: MediaStream) => {
    const videoElement = localVideoRef.current;
    if (!videoElement) {
      return;
    }

    if (videoElement.srcObject !== stream) {
      videoElement.srcObject = stream;
    }

    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.setAttribute('playsinline', 'true');

    try {
      await videoElement.play();
    } catch (playError) {
      console.warn('Local preview autoplay was blocked, retrying on metadata load', playError);
      videoElement.onloadedmetadata = () => {
        videoElement.play().catch(err => {
          console.warn('Unable to auto-play local preview:', err);
        });
      };
    }
  }, []);

  useEffect(() => {
    if (!isScreenSharing && localStream) {
      attachLocalPreview(localStream);
    }
  }, [attachLocalPreview, isConnecting, isScreenSharing, localStream]);

  const createPeerConnection = useCallback(async (participant: Participant, stream: MediaStream, isInitiator: boolean) => {
    if (participant.socketId === localSocketIdRef.current) {
      return;
    }

    const peerKey = participant.socketId || participant.id;

    // Skip if peer connection already exists (prevent duplicates)
    if (peerConnections.current.has(peerKey)) {
      debugLog(`Peer connection already exists for ${participant.name}`);
      return;
    }

    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections.current.set(peerKey, peerConnection);

    // Add local stream tracks to peer connection
    debugLog(`📤 Adding local tracks to peer connection with ${participant.name}`);
    stream.getTracks().forEach(track => {
      debugLog(`   Adding ${track.kind} track: ${track.label}`);
      peerConnection.addTrack(track, stream);
    });

    // Handle incoming stream
    peerConnection.ontrack = (event) => {
      debugLog(`🎥 Remote track received from ${participant.name}:`, event.track.kind);
      const [remoteStream] = event.streams;
      
      if (remoteStream) {
        debugLog(`📹 Remote stream has ${remoteStream.getTracks().length} tracks`);
        debugLog(`   Video tracks: ${remoteStream.getVideoTracks().length}`);
        debugLog(`   Audio tracks: ${remoteStream.getAudioTracks().length}`);
        
        setParticipants(prev => {
          const newParticipants = new Map(prev);
          const existingParticipant = newParticipants.get(peerKey);
          if (existingParticipant) {
            debugLog(`✅ Updated existing participant ${participant.name} with stream`);
            // Create NEW object so React detects the change
            newParticipants.set(peerKey, { ...existingParticipant, stream: remoteStream });
          } else {
            debugLog(`➕ Added new participant ${participant.name} with stream`);
            newParticipants.set(peerKey, { ...participant, stream: remoteStream });
          }
          return newParticipants;
        });
      } else {
        console.error(`❌ No remote stream in ontrack event for ${participant.name}`);
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          targetSocketId: participant.socketId
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      debugLog(`🔌 Connection state with ${participant.name}: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === 'failed') {
        console.error(`❌ Connection failed with ${participant.name}`);
        // Try to restart ICE
        peerConnection.restartIce();
      } else if (peerConnection.connectionState === 'connected') {
        debugLog(`✅ Successfully connected to ${participant.name}`);
      }
    };

    // Handle ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      debugLog(`🧊 ICE connection state with ${participant.name}: ${peerConnection.iceConnectionState}`);
    };

    // If initiator, create offer
    if (isInitiator) {
      try {
        debugLog(`📞 Creating offer for ${participant.name} (I am initiator)`);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        debugLog(`   ✅ Offer created and set as local description`);
        
        debugLog(`   📧 Sending offer to ${participant.name}`);
        socketRef.current?.emit('offer', {
          offer,
          targetSocketId: participant.socketId
        });
      } catch (error) {
        console.error('Error creating offer:', error);
      }
    } else {
      debugLog(`⏳ Waiting for offer from ${participant.name} (they are initiator)`);
    }

    // Add participant to state
    setParticipants(prev => {
      const newParticipants = new Map(prev);
      newParticipants.set(peerKey, participant);
      return newParticipants;
    });
  }, []);

  const handleOffer = useCallback(async (data: OfferPayload) => {
    const peerKey = data.fromSocketId || data.fromUserId;
    debugLog(`📨 Received offer from ${peerKey}`);
    const peerConnection = peerConnections.current.get(peerKey);
    if (peerConnection) {
      try {
        debugLog(`   Setting remote description...`);
        await peerConnection.setRemoteDescription(data.offer);
        debugLog(`   Creating answer...`);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        debugLog(`   ✅ Answer created and set as local description`);
        
        // Add any pending ICE candidates now that remote description is set
        const pending = pendingCandidates.current.get(peerKey);
        if (pending) {
          debugLog(`   Adding ${pending.length} pending ICE candidates`);
          for (const candidate of pending) {
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch (err) {
              console.error('Error adding queued ICE candidate:', err);
            }
          }
          pendingCandidates.current.delete(peerKey);
        }
        
        debugLog(`   📤 Sending answer to ${peerKey}`);
        socketRef.current?.emit('answer', {
          answer,
          targetSocketId: data.fromSocketId
        });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    }
  }, []);

  const handleAnswer = useCallback(async (data: AnswerPayload) => {
    const peerKey = data.fromSocketId || data.fromUserId;
    debugLog(`📬 Received answer from ${peerKey}`);
    const peerConnection = peerConnections.current.get(peerKey);
    if (peerConnection) {
      try {
        debugLog(`   Setting remote description from answer...`);
        await peerConnection.setRemoteDescription(data.answer);
        debugLog(`   ✅ Remote description set from answer`);
        
        // Add any pending ICE candidates now that remote description is set
        const pending = pendingCandidates.current.get(peerKey);
        if (pending) {
          debugLog(`   Adding ${pending.length} pending ICE candidates`);
          for (const candidate of pending) {
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch (err) {
              console.error('Error adding queued ICE candidate:', err);
            }
          }
          pendingCandidates.current.delete(peerKey);
        }
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }, []);

  const handleIceCandidate = useCallback(async (data: IceCandidatePayload) => {
    const peerKey = data.fromSocketId || data.fromUserId;
    const peerConnection = peerConnections.current.get(peerKey);
    if (peerConnection) {
      try {
        // Check if remote description is set
        if (peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(data.candidate);
        } else {
          // Queue the candidate for later
          if (!pendingCandidates.current.has(peerKey)) {
            pendingCandidates.current.set(peerKey, []);
          }
          pendingCandidates.current.get(peerKey)!.push(data.candidate);
          debugLog(`Queued ICE candidate for ${peerKey} (remote description not yet set)`);
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }, []);

  const setupSocketListeners = useCallback((socketConnection: Socket, stream: MediaStream) => {
    // Handle existing participants
    socketConnection.on('existing-participants', (existingParticipants: Participant[]) => {
      debugLog('Existing participants:', existingParticipants);
      existingParticipants.forEach(participant => {
        createPeerConnection(participant, stream, true); // true = initiator
      });
    });

    // Handle new user joined
    socketConnection.on('user-joined', (participant: Participant) => {
      debugLog('User joined:', participant);
      createPeerConnection(participant, stream, false); // false = not initiator
    });

    // Handle user left
    socketConnection.on('user-left', (data: UserLeftPayload) => {
      debugLog('User left:', data);
      const peerKey = data.socketId || data.userId;
      const peerConnection = peerConnections.current.get(peerKey);
      if (peerConnection) {
        peerConnection.close();
        peerConnections.current.delete(peerKey);
      }

      pendingCandidates.current.delete(peerKey);

      setParticipants(prev => {
        const newParticipants = new Map(prev);
        newParticipants.delete(peerKey);
        return newParticipants;
      });
    });

    socketConnection.on('offer', handleOffer);
    socketConnection.on('answer', handleAnswer);
    socketConnection.on('ice-candidate', handleIceCandidate);

    socketConnection.on('participant-media-changed', (data: ParticipantMediaChangedPayload) => {
      setParticipants(prev => {
        const newParticipants = new Map(prev);
        const participant = newParticipants.get(data.socketId || data.userId);
        if (participant) {
          participant.isVideoEnabled = data.isVideoEnabled;
          participant.isAudioEnabled = data.isAudioEnabled;
        }
        return newParticipants;
      });
    });

    socketConnection.on('chat-message', (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]);
    });

    socketConnection.on('user-started-screen-share', (data) => {
      debugLog(`${data.userName} started screen sharing`);
    });

    socketConnection.on('user-stopped-screen-share', (data) => {
      debugLog(`${data.userName} stopped screen sharing`);
    });
  }, [createPeerConnection, handleAnswer, handleIceCandidate, handleOffer]);

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        socketRef.current?.emit('toggle-media', { video: videoTrack.enabled });
      }
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        socketRef.current?.emit('toggle-media', { audio: audioTrack.enabled });
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
        socketRef.current?.emit('start-screen-share');

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
    socketRef.current?.emit('stop-screen-share');
  };

  const sendChatMessage = () => {
    if (newMessage.trim() && socketRef.current) {
      socketRef.current.emit('chat-message', newMessage);
      setNewMessage('');
    }
  };

  const handleLeaveRoom = async () => {
    cleanup();
    onLeave();
  };

  const cleanup = () => {
    // Close all peer connections
    peerConnections.current.forEach(peerConnection => {
      peerConnection.close();
    });
    peerConnections.current.clear();

    // Clear pending ICE candidates
    pendingCandidates.current.clear();

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Clear participants
    setParticipants(new Map());

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  useEffect(() => {
    let cancelled = false;
    let streamForCleanup: MediaStream | null = null;
    const peerConnectionsMap = peerConnections.current;
    const pendingCandidatesMap = pendingCandidates.current;

    const initialize = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamForCleanup = stream;
        localStreamRef.current = stream;
        setLocalStream(stream);

        await attachLocalPreview(stream);

        const socketConnection = io(SERVER_URL);
        socketRef.current = socketConnection;

        const userName = user.email?.split('@')[0] || 'Anonymous';
        setRoomName(roomId.substring(0, 8));
        setupSocketListeners(socketConnection, stream);

        const joinRoom = () => {
          const currentSocketId = socketConnection.id;
          if (!currentSocketId || cancelled) {
            return;
          }

          setLocalSocketId(currentSocketId);
          localSocketIdRef.current = currentSocketId;
          setParticipants(prev => {
            const newParticipants = new Map(prev);
            newParticipants.set(currentSocketId, {
              id: user.id,
              name: userName,
              socketId: currentSocketId,
              isVideoEnabled: true,
              isAudioEnabled: true,
              stream,
            });
            return newParticipants;
          });

          socketConnection.emit('join-room', roomId, user.id, userName, roomNameProp);
          setIsConnecting(false);
        };

        if (socketConnection.connected) {
          joinRoom();
        } else {
          socketConnection.once('connect', joinRoom);
        }

        socketConnection.on('connect_error', (err) => {
          console.error('Socket connection error:', err);
          setIsConnecting(false);
        });
      } catch (error) {
        console.error('Error initializing video room:', error);
        setIsConnecting(false);
        alert('Failed to access camera/microphone. Please check permissions.');
      }
    };

    initialize();

    return () => {
      cancelled = true;

      peerConnectionsMap.forEach(peerConnection => {
        peerConnection.close();
      });
      peerConnectionsMap.clear();
      pendingCandidatesMap.clear();

      if (streamForCleanup) {
        streamForCleanup.getTracks().forEach(track => track.stop());
      }

      if (socketRef.current) {
        socketRef.current.disconnect();
      }

      localSocketIdRef.current = '';
    };
  }, [attachLocalPreview, roomId, roomNameProp, setupSocketListeners, user.email, user.id]);

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
          {participants.size} participant{participants.size !== 1 ? 's' : ''}
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
                {!isVideoEnabled && (
                  <span className="media-icon video-off" title="Camera off">
                    <VideoOff size={16} />
                  </span>
                )}
                {!isAudioEnabled && (
                  <span className="media-icon audio-off" title="Microphone off">
                    <MicOff size={16} />
                  </span>
                )}
                {isScreenSharing && (
                  <span className="media-icon screen-share" title="Screen sharing">
                    <Monitor size={16} />
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Remote videos */}
          {Array.from(participants.values())
            .filter(participant => participant.socketId !== localSocketId) // Exclude this device from remote videos
            .map(participant => (
              <ParticipantVideo key={participant.socketId} participant={participant} />
            ))}
        </div>

        {/* Controls */}
        <div className="video-controls">
          <button
            onClick={toggleAudio}
            className={`control-btn ${!isAudioEnabled ? 'disabled' : ''}`}
            title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {isAudioEnabled ? <Mic size={22} /> : <MicOff size={22} />}
          </button>
          
          <button
            onClick={toggleVideo}
            className={`control-btn ${!isVideoEnabled ? 'disabled' : ''}`}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {isVideoEnabled ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
          
          <button 
            onClick={shareScreen} 
            className={`control-btn ${isScreenSharing ? 'active' : ''}`}
            title={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
          >
            {isScreenSharing ? <MonitorOff size={22} /> : <Monitor size={22} />}
          </button>
          
          <button
            onClick={() => setShowChat(!showChat)}
            className={`control-btn ${showChat ? 'active' : ''}`}
            title="Toggle chat"
          >
            <MessageCircle size={22} />
            {chatMessages.length > 0 && <span className="chat-count">{chatMessages.length}</span>}
          </button>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div className="chat-panel">
          <div className="chat-header">
            <h3>Chat</h3>
            <button onClick={() => setShowChat(false)} className="chat-close-btn" title="Close chat">
              <X size={18} />
            </button>
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
      debugLog(`🖼️ Setting stream for ${participant.name} video element`);
      debugLog(`   Stream has ${participant.stream.getTracks().length} tracks`);
      debugLog(`   Video tracks active: ${participant.stream.getVideoTracks().some(t => t.enabled)}`);
      videoRef.current.srcObject = participant.stream;
    } else if (videoRef.current && !participant.stream) {
      debugLog(`⚠️ No stream available for ${participant.name}`);
    }
  }, [participant.stream, participant.name]);

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
          {!participant.isVideoEnabled && (
            <span className="media-icon video-off" title="Camera off">
              <VideoOff size={16} />
            </span>
          )}
          {!participant.isAudioEnabled && (
            <span className="media-icon audio-off" title="Microphone off">
              <MicOff size={16} />
            </span>
          )}
        </div>
      </div>
      {!participant.stream && (
        <div className="connection-status">
          <div className="connection-avatar">
            <UserIcon size={18} />
          </div>
          <div className="loading-spinner small"></div>
          <p>Connecting...</p>
        </div>
      )}
    </div>
  );
};

export default VideoRoom;