const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
const socketIo = require('socket.io');
require('dotenv').config();

const roomsRouter = require('./routes/rooms');

const app = express();
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';

const debugLog = (...args) => {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
};

const parsedCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowAllOrigins =
  process.env.CORS_ALLOW_ALL === 'true' ||
  (parsedCorsOrigins.length === 0 && process.env.NODE_ENV !== 'production');

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  if (allowAllOrigins) {
    return true;
  }

  return parsedCorsOrigins.includes(origin);
};

// Load SSL certificates
const keyPath = path.join(__dirname, '../certs/key.pem');
const certPath = path.join(__dirname, '../certs/cert.pem');

let server;
try {
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);
  server = https.createServer({ key, cert }, app);
  console.log('✅ HTTPS server created with SSL certificates');
} catch (err) {
  console.warn('⚠️  Could not load SSL certificates:', err.message);
  console.warn('⚠️  Falling back to HTTP');
  const http = require('http');
  server = http.createServer(app);
}

// Socket.io setup with CORS
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS: Origin not allowed'));
    },
    methods: ["GET", "POST"]
  }
});

app.set('io', io);

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS: Origin not allowed'));
    },
  })
);
app.use(express.json());

// Routes
app.use('/rooms', roomsRouter);

// Health check
app.get('/', (req, res) => {
  res.send('API is running... :)');
});

// Store active video rooms and participants
const videoRooms = new Map();
const socketToUser = new Map();
const roomFocusStates = new Map();
const roomGoals = new Map();
const roomLeaderboard = new Map();
const roomStopVoteStates = new Map();

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const getLeaderboardForToday = (roomName) => {
  const todayKey = getTodayKey();
  const leaderboardMap = roomLeaderboard.get(roomName) || new Map();
  const list = [];

  leaderboardMap.forEach((entry, userId) => {
    if (entry.dateKey !== todayKey) {
      leaderboardMap.set(userId, { ...entry, dateKey: todayKey, minutes: 0 });
      list.push({ ...entry, dateKey: todayKey, minutes: 0 });
      return;
    }
    list.push(entry);
  });

  if (roomLeaderboard.has(roomName)) {
    roomLeaderboard.set(roomName, leaderboardMap);
  }

  return list.sort((a, b) => b.minutes - a.minutes);
};

const getRoomGoalsList = (roomName) => {
  const goalsMap = roomGoals.get(roomName) || new Map();
  return Array.from(goalsMap.values());
};

const getActiveSocketIdsInRoom = (roomName) => {
  const roomSockets = io.sockets.adapter.rooms.get(roomName);
  if (!roomSockets || roomSockets.size === 0) {
    return [];
  }

  return Array.from(roomSockets).filter((socketId) => io.sockets.sockets.has(socketId));
};

const getFocusStopVotePayload = (roomName) => {
  const voteState = roomStopVoteStates.get(roomName);
  if (!voteState) {
    return {
      isActive: false,
      requestedBy: null,
      requestedBySocketId: null,
      yesCount: 0,
      noCount: 0,
      totalEligible: 0,
      threshold: 0,
      yesVoterSocketIds: [],
      noVoterSocketIds: [],
    };
  }

  const eligibleSocketIds = getActiveSocketIdsInRoom(roomName);
  const eligibleSocketSet = new Set(eligibleSocketIds);
  const yesVoterSocketIds = [];
  const noVoterSocketIds = [];

  voteState.votes.forEach((value, socketId) => {
    if (!eligibleSocketSet.has(socketId)) {
      return;
    }

    if (value === 'yes') {
      yesVoterSocketIds.push(socketId);
      return;
    }

    if (value === 'no') {
      noVoterSocketIds.push(socketId);
    }
  });

  const totalEligible = eligibleSocketIds.length;
  const threshold = totalEligible > 0 ? Math.ceil((2 * totalEligible) / 3) : 0;

  return {
    isActive: true,
    requestedBy: voteState.requestedBy,
    requestedBySocketId: voteState.requestedBySocketId,
    yesCount: yesVoterSocketIds.length,
    noCount: noVoterSocketIds.length,
    totalEligible,
    threshold,
    yesVoterSocketIds,
    noVoterSocketIds,
    startedAt: voteState.startedAt,
  };
};

const broadcastFocusStopVoteState = (roomName) => {
  io.to(roomName).emit('focus-stop-vote-sync', getFocusStopVotePayload(roomName));
};

const tryResolveFocusStopVote = (roomName) => {
  const voteState = roomStopVoteStates.get(roomName);
  if (!voteState) {
    return;
  }

  const activeSocketIds = getActiveSocketIdsInRoom(roomName);
  const activeSocketIdSet = new Set(activeSocketIds);

  voteState.votes.forEach((_, socketId) => {
    if (!activeSocketIdSet.has(socketId)) {
      voteState.votes.delete(socketId);
    }
  });

  const payload = getFocusStopVotePayload(roomName);
  if (!payload.isActive) {
    roomStopVoteStates.delete(roomName);
    broadcastFocusStopVoteState(roomName);
    return;
  }

  const yesCount = payload.yesCount;
  const noCount = payload.noCount;
  const totalEligible = payload.totalEligible;
  const threshold = payload.threshold;
  const remainingVotes = Math.max(0, totalEligible - (yesCount + noCount));

  if (yesCount >= threshold && threshold > 0) {
    const existingState = roomFocusStates.get(roomName);
    if (existingState && existingState.isRunning) {
      const remaining = existingState.endAt
        ? Math.max(0, Math.ceil((existingState.endAt - Date.now()) / 1000))
        : Math.max(0, Math.floor(existingState.durationSec || 0));

      const stoppedState = {
        ...existingState,
        durationSec: remaining,
        endAt: null,
        isRunning: false,
        updatedBy: 'Vote passed',
        updatedAt: Date.now(),
      };

      roomFocusStates.set(roomName, stoppedState);
      io.to(roomName).emit('focus-timer-update', stoppedState);
    }

    roomStopVoteStates.delete(roomName);
    broadcastFocusStopVoteState(roomName);
    return;
  }

  if (yesCount + remainingVotes < threshold || yesCount + noCount >= totalEligible) {
    roomStopVoteStates.delete(roomName);
    broadcastFocusStopVoteState(roomName);
    return;
  }

  broadcastFocusStopVoteState(roomName);
};

// Socket.io connection handling
io.on('connection', (socket) => {
  debugLog('User connected:', socket.id);

  // Join room event
  socket.on('join-room', (roomName, userId, userName, dbRoomName) => {
    debugLog(`\n📝 JOIN-ROOM EVENT:`);
    debugLog(`   User: ${userName} (${userId})`);
    debugLog(`   Socket: ${socket.id}`);
    debugLog(`   Room: ${roomName}`);
    
    // Leave any previous rooms
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
        debugLog(`   Left room: ${room}`);
      }
    });

    // Join the new room
    socket.join(roomName);
    debugLog(`   ✅ Joined room`);
    
    // Store user info
    socketToUser.set(socket.id, {
      userId,
      userName,
      roomName,
      dbRoomName: dbRoomName || roomName,
    });

    // Initialize room if it doesn't exist
    if (!videoRooms.has(roomName)) {
      videoRooms.set(roomName, new Map());
      debugLog(`   🆕 Created new room`);
    }

    const room = videoRooms.get(roomName);
    const socketsInRoom = io.sockets.adapter.rooms.get(roomName) || new Set();

    // Prune stale participants (e.g. after reconnects/abrupt disconnects)
    for (const [participantSocketId] of room.entries()) {
      const isSocketConnected = io.sockets.sockets.has(participantSocketId);
      const isSocketInRoom = socketsInRoom.has(participantSocketId);
      if (!isSocketConnected || !isSocketInRoom) {
        room.delete(participantSocketId);
      }
    }

    const currentSize = room.size;
    debugLog(`   Current participants: ${currentSize}`);
    
    // Get existing participants
    const existingParticipants = Array.from(room.values());
    debugLog(`   📤 Sending ${existingParticipants.length} existing participants`);
    if (existingParticipants.length > 0) {
      debugLog(`      Participants: ${existingParticipants.map(p => p.name).join(', ')}`);
    }
    
    // Add current socket connection to room (supports same user on multiple devices)
    room.set(socket.id, {
      id: userId,
      name: userName,
      socketId: socket.id,
      isVideoEnabled: true,
      isAudioEnabled: true
    });
    debugLog(`   ✅ Added to room. New size: ${room.size}`);

    // Send existing participants to the new user
    socket.emit('existing-participants', existingParticipants);

    // Notify others about the new user
    const othersCount = io.sockets.adapter.rooms.get(roomName).size - 1;
    debugLog(`   📢 Broadcasting user-joined to ${othersCount} others`);
    socket.to(roomName).emit('user-joined', {
      id: userId,
      name: userName,
      socketId: socket.id,
      isVideoEnabled: true,
      isAudioEnabled: true
    });

    socket.emit('focus-state-sync', roomFocusStates.get(roomName) || null);
    socket.emit('focus-goals-sync', getRoomGoalsList(roomName));
    socket.emit('focus-leaderboard-sync', getLeaderboardForToday(roomName));
    socket.emit('focus-stop-vote-sync', getFocusStopVotePayload(roomName));
  });

  // WebRTC signaling events
  socket.on('offer', (data) => {
    debugLog(`\n📤 OFFER RECEIVED from ${socketToUser.get(socket.id)?.userName}`);
    debugLog(`   Targeting socket: ${data.targetSocketId}`);
    debugLog(`   From user: ${socketToUser.get(socket.id)?.userId}`);
    socket.to(data.targetSocketId).emit('offer', {
      ...data,
      fromUserId: socketToUser.get(socket.id)?.userId,
      fromSocketId: socket.id
    });
    debugLog(`   ✅ Relayed to ${data.targetSocketId}\n`);
  });

  socket.on('answer', (data) => {
    debugLog(`\n📥 ANSWER RECEIVED from ${socketToUser.get(socket.id)?.userName}`);
    debugLog(`   Targeting socket: ${data.targetSocketId}`);
    socket.to(data.targetSocketId).emit('answer', {
      ...data,
      fromUserId: socketToUser.get(socket.id)?.userId,
      fromSocketId: socket.id
    });
    debugLog(`   ✅ Relayed\n`);
  });

  socket.on('ice-candidate', (data) => {
    // Don't log all ICE candidates (too many), just relay
    socket.to(data.targetSocketId).emit('ice-candidate', {
      ...data,
      fromUserId: socketToUser.get(socket.id)?.userId,
      fromSocketId: socket.id
    });
  });

  // Media toggle events
  socket.on('toggle-media', (data) => {
    const userInfo = socketToUser.get(socket.id);
    if (userInfo) {
      const room = videoRooms.get(userInfo.roomName);
      if (room) {
        const participant = room.get(socket.id);
        if (participant) {
          if (data.video !== undefined) participant.isVideoEnabled = data.video;
          if (data.audio !== undefined) participant.isAudioEnabled = data.audio;
          
          // Notify others about media changes
          socket.to(userInfo.roomName).emit('participant-media-changed', {
            userId: userInfo.userId,
            socketId: socket.id,
            isVideoEnabled: participant.isVideoEnabled,
            isAudioEnabled: participant.isAudioEnabled
          });
        }
      }
    }
  });

  // Screen sharing events
  socket.on('start-screen-share', () => {
    const userInfo = socketToUser.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomName).emit('user-started-screen-share', {
        userId: userInfo.userId,
        userName: userInfo.userName
      });
    }
  });

  socket.on('stop-screen-share', () => {
    const userInfo = socketToUser.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomName).emit('user-stopped-screen-share', {
        userId: userInfo.userId,
        userName: userInfo.userName
      });
    }
  });

  // Chat message
  socket.on('chat-message', (message) => {
    const userInfo = socketToUser.get(socket.id);
    if (userInfo) {
      const chatMessage = {
        id: Date.now(),
        userId: userInfo.userId,
        userName: userInfo.userName,
        message: message,
        timestamp: new Date().toISOString()
      };
      
      // Send to all users in the room including sender
      io.to(userInfo.roomName).emit('chat-message', chatMessage);
    }
  });

  // Gesture reaction
  socket.on('gesture-reaction', (emoji) => {
    const userInfo = socketToUser.get(socket.id);
    if (userInfo && typeof emoji === 'string' && emoji.trim()) {
      io.to(userInfo.roomName).emit('gesture-reaction', {
        socketId: socket.id,
        userId: userInfo.userId,
        userName: userInfo.userName,
        emoji: emoji.trim(),
        timestamp: Date.now(),
      });
    }
  });

  socket.on('focus-timer-update', (focusState) => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo || !focusState || typeof focusState !== 'object') {
      return;
    }

    const roomName = userInfo.roomName;
    const normalizedState = {
      preset: focusState.preset === '50/10' ? '50/10' : '25/5',
      phase: focusState.phase === 'break' ? 'break' : 'focus',
      durationSec: Number.isFinite(focusState.durationSec) ? Math.max(0, Math.floor(focusState.durationSec)) : 0,
      endAt: typeof focusState.endAt === 'number' ? focusState.endAt : null,
      isRunning: !!focusState.isRunning,
      updatedBy: userInfo.userName,
      updatedAt: Date.now(),
      ownerSocketId: null,
    };

    const existingState = roomFocusStates.get(roomName);
    const isNaturalCompletion = !normalizedState.isRunning && normalizedState.durationSec <= 0;
    const isOwnerStopping =
      !!existingState?.isRunning &&
      !normalizedState.isRunning &&
      existingState.ownerSocketId === socket.id;

    if (existingState?.isRunning && !normalizedState.isRunning && !isNaturalCompletion && !isOwnerStopping) {
      return;
    }

    if (normalizedState.isRunning) {
      const isStartingNow = !existingState?.isRunning;
      normalizedState.ownerSocketId = isStartingNow
        ? socket.id
        : existingState?.ownerSocketId || socket.id;
    }

    if (normalizedState.isRunning) {
      roomStopVoteStates.delete(roomName);
      broadcastFocusStopVoteState(roomName);
    } else if (isOwnerStopping || isNaturalCompletion) {
      roomStopVoteStates.delete(roomName);
      broadcastFocusStopVoteState(roomName);
    }

    roomFocusStates.set(roomName, normalizedState);
    io.to(roomName).emit('focus-timer-update', normalizedState);
  });

  socket.on('focus-stop-vote-start', () => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo) {
      return;
    }

    const roomName = userInfo.roomName;
    const currentState = roomFocusStates.get(roomName);
    if (!currentState?.isRunning) {
      return;
    }

    if (currentState.ownerSocketId === socket.id) {
      return;
    }

    if (roomStopVoteStates.has(roomName)) {
      broadcastFocusStopVoteState(roomName);
      return;
    }

    roomStopVoteStates.set(roomName, {
      requestedBy: userInfo.userName,
      requestedBySocketId: socket.id,
      startedAt: Date.now(),
      votes: new Map([[socket.id, 'yes']]),
    });

    tryResolveFocusStopVote(roomName);
  });

  socket.on('focus-stop-vote-cast', (payload) => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo || !payload || typeof payload !== 'object') {
      return;
    }

    const roomName = userInfo.roomName;
    const voteState = roomStopVoteStates.get(roomName);
    const voteValue = payload.vote === 'yes' ? 'yes' : payload.vote === 'no' ? 'no' : null;
    if (!voteState || !voteValue) {
      return;
    }

    if (voteState.requestedBySocketId === socket.id) {
      return;
    }

    voteState.votes.set(socket.id, voteValue);
    tryResolveFocusStopVote(roomName);
  });

  socket.on('focus-stop-vote-request-sync', () => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo) {
      return;
    }

    socket.emit('focus-stop-vote-sync', getFocusStopVotePayload(userInfo.roomName));
  });

  socket.on('goal-checkin-update', (payload) => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo || !payload || typeof payload !== 'object') {
      return;
    }

    const roomName = userInfo.roomName;
    const goalText = typeof payload.goal === 'string' ? payload.goal.trim().slice(0, 180) : '';
    const done = !!payload.done;

    if (!roomGoals.has(roomName)) {
      roomGoals.set(roomName, new Map());
    }

    const roomGoalMap = roomGoals.get(roomName);
    if (!goalText) {
      roomGoalMap.delete(socket.id);
    } else {
      roomGoalMap.set(socket.id, {
        socketId: socket.id,
        userId: userInfo.userId,
        userName: userInfo.userName,
        goal: goalText,
        done,
      });
    }

    io.to(roomName).emit('focus-goals-sync', getRoomGoalsList(roomName));
  });

  socket.on('focus-minutes-add', (payload) => {
    const userInfo = socketToUser.get(socket.id);
    if (!userInfo || !payload || typeof payload !== 'object') {
      return;
    }

    const minutesToAddRaw = Number(payload.minutes);
    const minutesToAdd = Number.isFinite(minutesToAddRaw)
      ? Math.max(0, Math.min(30, Math.floor(minutesToAddRaw)))
      : 0;

    if (minutesToAdd <= 0) {
      return;
    }

    const roomName = userInfo.roomName;
    const todayKey = getTodayKey();

    if (!roomLeaderboard.has(roomName)) {
      roomLeaderboard.set(roomName, new Map());
    }

    const leaderboardMap = roomLeaderboard.get(roomName);
    const existing = leaderboardMap.get(userInfo.userId);
    if (!existing || existing.dateKey !== todayKey) {
      leaderboardMap.set(userInfo.userId, {
        userId: userInfo.userId,
        userName: userInfo.userName,
        minutes: minutesToAdd,
        dateKey: todayKey,
      });
    } else {
      leaderboardMap.set(userInfo.userId, {
        ...existing,
        userName: userInfo.userName,
        minutes: existing.minutes + minutesToAdd,
      });
    }

    io.to(roomName).emit('focus-leaderboard-sync', getLeaderboardForToday(roomName));
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    debugLog('User disconnected:', socket.id);
    
    const userInfo = socketToUser.get(socket.id);
    if (userInfo) {
      const { userId, userName, roomName } = userInfo;
      
      // Remove from video room
      const room = videoRooms.get(roomName);
      if (room) {
        room.delete(socket.id);

        if (roomGoals.has(roomName)) {
          roomGoals.get(roomName).delete(socket.id);
          io.to(roomName).emit('focus-goals-sync', getRoomGoalsList(roomName));
        }

        if (roomStopVoteStates.has(roomName)) {
          const voteState = roomStopVoteStates.get(roomName);
          voteState.votes.delete(socket.id);
          tryResolveFocusStopVote(roomName);
        }
        
        // Update database attendance
        updateRoomAttendance(userInfo.dbRoomName || roomName, room.size);
        
        // If room is empty, clean it up
        if (room.size === 0) {
          videoRooms.delete(roomName);
          roomFocusStates.delete(roomName);
          roomGoals.delete(roomName);
          roomLeaderboard.delete(roomName);
          roomStopVoteStates.delete(roomName);
        }
        
        // Notify others
        socket.to(roomName).emit('user-left', { userId, userName, socketId: socket.id });
      }
      
      // Clean up socket mapping
      socketToUser.delete(socket.id);
    }
  });
});

// Helper function to update room attendance in database
async function updateRoomAttendance(roomName, attendance) {
  try {
    const { query } = require('./db'); // Adjust path as needed

    if (attendance <= 0) {
      const deleteResult = await query('DELETE FROM "rooms" WHERE name = $1 RETURNING name', [roomName]);
      if (deleteResult.rows.length > 0) {
        io.emit('rooms-changed', {
          action: 'deleted',
          roomName,
          timestamp: Date.now(),
        });
      }
      return;
    }

    await query('UPDATE "rooms" SET attendance = $1 WHERE name = $2', [attendance, roomName]);
    io.emit('rooms-changed', {
      action: 'left',
      roomName,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error updating room attendance:', error);
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  const protocol = server instanceof https.Server ? 'https' : 'http';
  console.log(`✅ Server running on ${protocol}://0.0.0.0:${PORT}`);
  if (DEBUG_LOGS) {
    console.log(`✅ Accessible from: ${protocol}://192.168.1.120:${PORT}`);
  }
  console.log(`🔗 Socket.io enabled for WebRTC signaling`);
});