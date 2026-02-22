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
        
        // Update database attendance
        updateRoomAttendance(userInfo.dbRoomName || roomName, room.size);
        
        // If room is empty, clean it up
        if (room.size === 0) {
          videoRooms.delete(roomName);
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