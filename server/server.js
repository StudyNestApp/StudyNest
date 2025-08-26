const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const roomsRouter = require('./routes/rooms');

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000", // Your React app URL
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
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
  console.log('User connected:', socket.id);

  // Join room event
  socket.on('join-room', (roomName, userId, userName) => {
    console.log(`User ${userName} (${userId}) joining room: ${roomName}`);
    
    // Leave any previous rooms
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });

    // Join the new room
    socket.join(roomName);
    
    // Store user info
    socketToUser.set(socket.id, { userId, userName, roomName });

    // Initialize room if it doesn't exist
    if (!videoRooms.has(roomName)) {
      videoRooms.set(roomName, new Map());
    }

    const room = videoRooms.get(roomName);
    
    // Get existing participants
    const existingParticipants = Array.from(room.values());
    
    // Add current user to room
    room.set(userId, {
      id: userId,
      name: userName,
      socketId: socket.id,
      isVideoEnabled: true,
      isAudioEnabled: true
    });

    // Send existing participants to the new user
    socket.emit('existing-participants', existingParticipants);

    // Notify others about the new user
    socket.to(roomName).emit('user-joined', {
      id: userId,
      name: userName,
      socketId: socket.id,
      isVideoEnabled: true,
      isAudioEnabled: true
    });

    // Update room attendance in database
    updateRoomAttendance(roomName, room.size);
  });

  // WebRTC signaling events
  socket.on('offer', (data) => {
    socket.to(data.targetSocketId).emit('offer', {
      ...data,
      fromUserId: socketToUser.get(socket.id)?.userId,
      fromSocketId: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.targetSocketId).emit('answer', {
      ...data,
      fromUserId: socketToUser.get(socket.id)?.userId,
      fromSocketId: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
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
        const participant = room.get(userInfo.userId);
        if (participant) {
          if (data.video !== undefined) participant.isVideoEnabled = data.video;
          if (data.audio !== undefined) participant.isAudioEnabled = data.audio;
          
          // Notify others about media changes
          socket.to(userInfo.roomName).emit('participant-media-changed', {
            userId: userInfo.userId,
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
    console.log('User disconnected:', socket.id);
    
    const userInfo = socketToUser.get(socket.id);
    if (userInfo) {
      const { userId, userName, roomName } = userInfo;
      
      // Remove from video room
      const room = videoRooms.get(roomName);
      if (room) {
        room.delete(userId);
        
        // Update database attendance
        updateRoomAttendance(roomName, room.size);
        
        // If room is empty, clean it up
        if (room.size === 0) {
          videoRooms.delete(roomName);
        }
        
        // Notify others
        socket.to(roomName).emit('user-left', { userId, userName });
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
    await query('UPDATE "Rooms" SET attendance = $1 WHERE name = $2', [attendance, roomName]);
  } catch (error) {
    console.error('Error updating room attendance:', error);
  }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🔗 Socket.io enabled for WebRTC signaling`);
});