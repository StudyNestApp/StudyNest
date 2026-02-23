import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import {
  Video,
  VideoOff,
  Hand,
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
const GESTURE_MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const GESTURE_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const GESTURE_COOLDOWN_MS = 5000;
const GESTURE_MIN_SCORE = 0.35;
const GESTURE_FRAME_INTERVAL_MS = 120;
const GESTURE_REACTION_SHOW_MS = 1500;
const GESTURE_CHAT_FALLBACK_PREFIX = '__gesture__:';

type SupportedGesture = 'Closed_Fist' | 'Open_Palm' | 'Victory' | 'Thumb_Up' | 'Thumb_Down' | 'Heart';

const normalizeGestureName = (gestureName: string): SupportedGesture | null => {
  const normalized = gestureName.toLowerCase().replace(/[\s-]+/g, '_');

  if (
    normalized.includes('closed_fist') ||
    normalized === 'fist' ||
    normalized.endsWith('_fist')
  ) {
    return 'Closed_Fist';
  }

  if (
    normalized.includes('open_palm') ||
    normalized.includes('open_hand') ||
    normalized === 'palm'
  ) {
    return 'Open_Palm';
  }

  if (
    normalized.includes('victory') ||
    normalized.includes('peace') ||
    normalized === 'v_sign' ||
    normalized === 'v'
  ) {
    return 'Victory';
  }

  if (normalized.includes('thumb_up') || normalized.includes('thumbs_up')) {
    return 'Thumb_Up';
  }

  if (normalized.includes('thumb_down') || normalized.includes('thumbs_down')) {
    return 'Thumb_Down';
  }

  if (normalized.includes('heart')) {
    return 'Heart';
  }

  return null;
};

const detectGestureFromLandmarks = (landmarks?: { x: number; y: number; z: number }[]): SupportedGesture | null => {
  if (!landmarks || landmarks.length < 21) {
    return null;
  }

  const fingerPairs: Array<[number, number]> = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ];

  const extendedFingers = fingerPairs.reduce((count, [tipIdx, pipIdx]) => {
    const tip = landmarks[tipIdx];
    const pip = landmarks[pipIdx];
    return tip && pip && tip.y < pip.y ? count + 1 : count;
  }, 0);

  if (extendedFingers >= 3) {
    return 'Open_Palm';
  }

  const indexTip = landmarks[8];
  const indexPip = landmarks[6];
  const middleTip = landmarks[12];
  const middlePip = landmarks[10];
  const ringTip = landmarks[16];
  const ringPip = landmarks[14];
  const pinkyTip = landmarks[20];
  const pinkyPip = landmarks[18];

  const isIndexExtended = !!indexTip && !!indexPip && indexTip.y < indexPip.y;
  const isMiddleExtended = !!middleTip && !!middlePip && middleTip.y < middlePip.y;
  const isRingFolded = !!ringTip && !!ringPip && ringTip.y >= ringPip.y;
  const isPinkyFolded = !!pinkyTip && !!pinkyPip && pinkyTip.y >= pinkyPip.y;
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const wrist = landmarks[0];

  if (isIndexExtended && isMiddleExtended && isRingFolded && isPinkyFolded) {
    return 'Victory';
  }

  if (thumbTip && thumbIp && wrist && !isIndexExtended && !isMiddleExtended && isRingFolded && isPinkyFolded) {
    if (thumbTip.y < thumbIp.y && thumbTip.y < wrist.y) {
      return 'Thumb_Up';
    }

    if (thumbTip.y > thumbIp.y && thumbTip.y > wrist.y) {
      return 'Thumb_Down';
    }
  }

  if (extendedFingers <= 1) {
    return 'Closed_Fist';
  }

  return null;
};

const detectTwoHandsHeart = (handsLandmarks?: { x: number; y: number; z: number }[][]): boolean => {
  if (!handsLandmarks || handsLandmarks.length < 2) {
    return false;
  }

  const handA = handsLandmarks[0];
  const handB = handsLandmarks[1];
  if (!handA || !handB || handA.length < 21 || handB.length < 21) {
    return false;
  }

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const thumbTipA = handA[4];
  const indexTipA = handA[8];
  const wristA = handA[0];
  const indexBaseA = handA[5];
  const thumbTipB = handB[4];
  const indexTipB = handB[8];
  const wristB = handB[0];
  const indexBaseB = handB[5];

  if (!thumbTipA || !indexTipA || !wristA || !indexBaseA || !thumbTipB || !indexTipB || !wristB || !indexBaseB) {
    return false;
  }

  const avgPalmWidth = (distance(wristA, indexBaseA) + distance(wristB, indexBaseB)) / 2;
  if (!Number.isFinite(avgPalmWidth) || avgPalmWidth <= 0) {
    return false;
  }

  const handCenterA = {
    x: (wristA.x + indexBaseA.x) / 2,
    y: (wristA.y + indexBaseA.y) / 2,
  };
  const handCenterB = {
    x: (wristB.x + indexBaseB.x) / 2,
    y: (wristB.y + indexBaseB.y) / 2,
  };

  const handsAreNear = distance(handCenterA, handCenterB) < avgPalmWidth * 2.2;
  const topJoin = distance(indexTipA, indexTipB) < avgPalmWidth * 1.25;
  const bottomJoin = distance(thumbTipA, thumbTipB) < avgPalmWidth * 1.3;

  const crossJoinA = distance(thumbTipA, indexTipB) < avgPalmWidth * 1.35;
  const crossJoinB = distance(thumbTipB, indexTipA) < avgPalmWidth * 1.35;

  const heartByParallelTips = topJoin && bottomJoin;
  const heartByCrossTips = crossJoinA && crossJoinB;

  return handsAreNear && (heartByParallelTips || heartByCrossTips);
};

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

interface GestureReactionPayload {
  socketId: string;
  userId: string;
  userName: string;
  emoji: string;
  timestamp: number;
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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isGestureEnabled, setIsGestureEnabled] = useState(false);
  const [gestureStatus, setGestureStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [gestureReactions, setGestureReactions] = useState<Map<string, string>>(new Map());
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
  const reactionTimeoutsRef = useRef<Map<string, number>>(new Map());
  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);
  const gestureFrameRef = useRef<number | null>(null);
  const lastGestureVideoTimeRef = useRef(-1);
  const lastGestureProcessedAtRef = useRef(0);
  const lastGestureSentAtRef = useRef<Record<SupportedGesture, number>>({
    Closed_Fist: 0,
    Open_Palm: 0,
    Victory: 0,
    Thumb_Up: 0,
    Thumb_Down: 0,
    Heart: 0,
  });

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

  const showGestureReaction = useCallback((socketId: string, emoji: string) => {
    const existingTimeout = reactionTimeoutsRef.current.get(socketId);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    setGestureReactions(prev => {
      const next = new Map(prev);
      next.set(socketId, emoji);
      return next;
    });

    const timeoutId = window.setTimeout(() => {
      setGestureReactions(prev => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
      reactionTimeoutsRef.current.delete(socketId);
    }, GESTURE_REACTION_SHOW_MS);

    reactionTimeoutsRef.current.set(socketId, timeoutId);
  }, []);

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

      const reactionTimeout = reactionTimeoutsRef.current.get(peerKey);
      if (reactionTimeout) {
        window.clearTimeout(reactionTimeout);
        reactionTimeoutsRef.current.delete(peerKey);
      }

      setGestureReactions(prev => {
        const next = new Map(prev);
        next.delete(peerKey);
        return next;
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
      if (typeof message.message === 'string' && message.message.startsWith(GESTURE_CHAT_FALLBACK_PREFIX)) {
        const payload = message.message.slice(GESTURE_CHAT_FALLBACK_PREFIX.length);
        const separatorIndex = payload.indexOf(':');
        if (separatorIndex > 0) {
          const sourceSocketId = payload.slice(0, separatorIndex);
          const emoji = payload.slice(separatorIndex + 1);
          if (sourceSocketId && emoji) {
            showGestureReaction(sourceSocketId, emoji);
          }
        }
        return;
      }

      setChatMessages(prev => [...prev, message]);
    });

    socketConnection.on('gesture-reaction', (reaction: GestureReactionPayload) => {
      if (!reaction?.socketId || !reaction?.emoji) {
        return;
      }

      showGestureReaction(reaction.socketId, reaction.emoji);
    });

    socketConnection.on('user-started-screen-share', (data) => {
      debugLog(`${data.userName} started screen sharing`);
    });

    socketConnection.on('user-stopped-screen-share', (data) => {
      debugLog(`${data.userName} stopped screen sharing`);
    });
  }, [createPeerConnection, handleAnswer, handleIceCandidate, handleOffer, showGestureReaction]);

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

  const shareScreen = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
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

  const sendGestureEmoji = useCallback((emoji: string) => {
    const localId = localSocketIdRef.current;
    if (localId) {
      showGestureReaction(localId, emoji);
    }

    if (!socketRef.current) {
      return;
    }

    socketRef.current.emit('gesture-reaction', emoji);
    if (localId) {
      socketRef.current.emit('chat-message', `${GESTURE_CHAT_FALLBACK_PREFIX}${localId}:${emoji}`);
    }
  }, [showGestureReaction]);

  const maybeSendGestureEmoji = useCallback((gestureName: string, score: number) => {
    if (score < GESTURE_MIN_SCORE) {
      return;
    }

    const matchedGesture = normalizeGestureName(gestureName);
    if (!matchedGesture) {
      return;
    }

    const now = Date.now();
    const lastSent = lastGestureSentAtRef.current[matchedGesture];
    if (now - lastSent < GESTURE_COOLDOWN_MS) {
      return;
    }

    lastGestureSentAtRef.current[matchedGesture] = now;
    if (matchedGesture === 'Closed_Fist') {
      sendGestureEmoji('✊');
      return;
    }

    if (matchedGesture === 'Open_Palm') {
      sendGestureEmoji('🖐️');
      return;
    }

    if (matchedGesture === 'Thumb_Up') {
      sendGestureEmoji('👍');
      return;
    }

    if (matchedGesture === 'Thumb_Down') {
      sendGestureEmoji('👎');
      return;
    }

    if (matchedGesture === 'Heart') {
      sendGestureEmoji('❤️');
      return;
    }

    sendGestureEmoji('✌️');
  }, [sendGestureEmoji]);

  const ensureGestureRecognizer = useCallback(async () => {
    if (gestureRecognizerRef.current) {
      return true;
    }

    try {
      setGestureStatus('loading');
      const vision = await FilesetResolver.forVisionTasks(GESTURE_WASM_BASE_URL);
      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: GESTURE_MODEL_ASSET_URL,
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      gestureRecognizerRef.current = recognizer;
      setGestureStatus('ready');
      return true;
    } catch (error) {
      console.error('Failed to initialize gesture recognizer:', error);
      setGestureStatus('error');
      return false;
    }
  }, []);

  const stopGestureLoop = useCallback(() => {
    if (gestureFrameRef.current !== null) {
      cancelAnimationFrame(gestureFrameRef.current);
      gestureFrameRef.current = null;
    }
  }, []);

  const runGestureLoop = useCallback(() => {
    if (!isGestureEnabled || !gestureRecognizerRef.current) {
      return;
    }

    const videoElement = localVideoRef.current;
    if (!videoElement) {
      return;
    }

    const detectFrame = () => {
      if (!isGestureEnabled || !gestureRecognizerRef.current) {
        return;
      }

      const activeVideoElement = localVideoRef.current;
      if (
        !activeVideoElement ||
        activeVideoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        !isVideoEnabled
      ) {
        gestureFrameRef.current = requestAnimationFrame(detectFrame);
        return;
      }

      if (activeVideoElement.currentTime !== lastGestureVideoTimeRef.current) {
        lastGestureVideoTimeRef.current = activeVideoElement.currentTime;
        const now = Date.now();
        if (now - lastGestureProcessedAtRef.current < GESTURE_FRAME_INTERVAL_MS) {
          gestureFrameRef.current = requestAnimationFrame(detectFrame);
          return;
        }

        lastGestureProcessedAtRef.current = now;
        const result = gestureRecognizerRef.current.recognizeForVideo(activeVideoElement, Date.now());
        if (detectTwoHandsHeart(result.landmarks)) {
          maybeSendGestureEmoji('Heart', 1);
          gestureFrameRef.current = requestAnimationFrame(detectFrame);
          return;
        }

        const topGesture = result.gestures[0]?.[0];
        if (topGesture?.categoryName) {
          maybeSendGestureEmoji(topGesture.categoryName, topGesture.score ?? 0);
        } else {
          const landmarkGesture = detectGestureFromLandmarks(result.landmarks?.[0]);
          if (landmarkGesture) {
            maybeSendGestureEmoji(landmarkGesture, 1);
          }
        }
      }

      gestureFrameRef.current = requestAnimationFrame(detectFrame);
    };

    stopGestureLoop();
    gestureFrameRef.current = requestAnimationFrame(detectFrame);
  }, [isGestureEnabled, isVideoEnabled, maybeSendGestureEmoji, stopGestureLoop]);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (!isGestureEnabled) {
        stopGestureLoop();
        setGestureStatus('idle');
        return;
      }

      const isReady = await ensureGestureRecognizer();
      if (cancelled || !isReady) {
        return;
      }

      runGestureLoop();
    };

    start();

    return () => {
      cancelled = true;
      stopGestureLoop();
    };
  }, [ensureGestureRecognizer, isGestureEnabled, runGestureLoop, stopGestureLoop]);

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
    setGestureReactions(new Map());

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    reactionTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    reactionTimeoutsRef.current.clear();

    stopGestureLoop();
    if (gestureRecognizerRef.current) {
      gestureRecognizerRef.current.close();
      gestureRecognizerRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    let streamForCleanup: MediaStream | null = null;
    const peerConnectionsMap = peerConnections.current;
    const pendingCandidatesMap = pendingCandidates.current;
    const reactionTimeoutsMap = reactionTimeoutsRef.current;

    const initialize = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
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
              isAudioEnabled: false,
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
        alert('Failed to access camera. Please check permissions.');
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

      reactionTimeoutsMap.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      reactionTimeoutsMap.clear();

      if (gestureRecognizerRef.current) {
        gestureRecognizerRef.current.close();
        gestureRecognizerRef.current = null;
      }
      stopGestureLoop();

      localSocketIdRef.current = '';
    };
  }, [attachLocalPreview, roomId, roomNameProp, setupSocketListeners, stopGestureLoop, user.email, user.id]);

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
                {isScreenSharing && (
                  <span className="media-icon screen-share" title="Screen sharing">
                    <Monitor size={16} />
                  </span>
                )}
              </div>
            </div>
            {localSocketId && gestureReactions.get(localSocketId) && (
              <div className="gesture-reaction-bubble" title="Gesture reaction">
                {gestureReactions.get(localSocketId)}
              </div>
            )}
          </div>

          {/* Remote videos */}
          {Array.from(participants.values())
            .filter(participant => participant.socketId !== localSocketId) // Exclude this device from remote videos
            .map(participant => (
              <ParticipantVideo
                key={participant.socketId}
                participant={participant}
                reactionEmoji={gestureReactions.get(participant.socketId)}
              />
            ))}
        </div>

        {/* Controls */}
        <div className="video-controls">
          <button
            onClick={() => setIsGestureEnabled(prev => !prev)}
            className={`control-btn ${isGestureEnabled ? 'active' : ''} ${gestureStatus === 'error' ? 'disabled' : ''}`}
            title={
              gestureStatus === 'error'
                ? 'Gesture detection unavailable'
                : isGestureEnabled
                  ? 'Disable gesture emoji detection'
                  : 'Enable gesture emoji detection'
            }
          >
            <Hand size={22} />
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
const ParticipantVideo: React.FC<{ participant: Participant; reactionEmoji?: string }> = ({ participant, reactionEmoji }) => {
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
        </div>
      </div>
      {reactionEmoji && (
        <div className="gesture-reaction-bubble" title="Gesture reaction">
          {reactionEmoji}
        </div>
      )}
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