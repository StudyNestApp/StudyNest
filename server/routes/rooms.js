const express = require('express');
const { query } = require('../db');
const crypto = require('crypto');
const router = express.Router();
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';

const debugLog = (...args) => {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
};

function emitRoomsChanged(req, action, roomName) {
  const io = req.app.get('io');
  if (!io) {
    return;
  }

  io.emit('rooms-changed', {
    action,
    roomName,
    timestamp: Date.now(),
  });
}

// Helper function to generate unique video room ID
function generateVideoRoomId() {
  const id = crypto.randomBytes(16).toString('hex');
  debugLog('🎯 Generated video room ID:', id);
  return id;
}

// GET /rooms - Get all rooms
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM "rooms" ORDER BY created_at DESC');
    debugLog('📋 Fetched rooms:', result.rows);
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rooms',
      message: error.message
    });
  }
});

// GET /rooms/:name - Get a specific room by name
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const result = await query('SELECT * FROM "rooms" WHERE name = $1', [name]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch room',
      message: error.message
    });
  }
});

// POST /rooms - Create a new room
router.post('/', async (req, res) => {
  try {
    const { creator, name, attendance = 1 } = req.body;
    
    debugLog('📝 Creating room with data:', { creator, name, attendance });
    
    // Validation
    if (!creator || !name) {
      return res.status(400).json({
        success: false,
        error: 'Creator and name are required'
      });
    }
    
    // Check if room already exists
    const existingRoom = await query('SELECT * FROM "rooms" WHERE name = $1', [name]);
    if (existingRoom.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Room with this name already exists'
      });
    }
    
    // Generate unique video room ID
    const videoRoomId = generateVideoRoomId();
    debugLog('🎬 Generated video room ID:', videoRoomId);
    
    const insertValues = [creator, name, attendance, videoRoomId];
    debugLog('💾 About to insert with values:', insertValues);
    
    // Create room with video_url
    const insertQuery = 'INSERT INTO "rooms" (creator, name, created_at, attendance, video_url) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4) RETURNING *';
    debugLog('📝 Insert query:', insertQuery);
    
    const result = await query(insertQuery, insertValues);
    
    debugLog('✅ Room created successfully:', result.rows[0]);
    debugLog('🔗 Video URL in result:', result.rows[0].video_url);
    
    emitRoomsChanged(req, 'created', name);
    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating room:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to create room',
      message: error.message
    });
  }
});

// PUT /rooms/:name - Update room attendance or other details
router.put('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { attendance, creator } = req.body;
    
    // Check if room exists
    const existingRoom = await query('SELECT * FROM "rooms" WHERE name = $1', [name]);
    if (existingRoom.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }
    
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (attendance !== undefined) {
      updates.push(`attendance = $${paramCount}`);
      values.push(attendance);
      paramCount++;
    }
    
    if (creator !== undefined) {
      updates.push(`creator = $${paramCount}`);
      values.push(creator);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }
    
    values.push(name); // Add name for WHERE clause
    
    const result = await query(
      `UPDATE "rooms" SET ${updates.join(', ')} WHERE name = $${paramCount} RETURNING *`,
      values
    );
    
    res.json({
      success: true,
      message: 'Room updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update room',
      message: error.message
    });
  }
});

// DELETE /rooms/:name - Delete a room
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    // Check if room exists
    const existingRoom = await query('SELECT * FROM "rooms" WHERE name = $1', [name]);
    if (existingRoom.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }
    
    await query('DELETE FROM "rooms" WHERE name = $1', [name]);
    emitRoomsChanged(req, 'deleted', name);
    
    res.json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete room',
      message: error.message
    });
  }
});

// PATCH /rooms/:name/attendance - Quick endpoint to update just attendance
router.patch('/:name/attendance', async (req, res) => {
  try {
    const { name } = req.params;
    const { attendance } = req.body;
    
    if (attendance === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Attendance value is required'
      });
    }
    
    const result = await query(
      'UPDATE "rooms" SET attendance = $1 WHERE name = $2 RETURNING *',
      [attendance, name]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Attendance updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update attendance',
      message: error.message
    });
  }
});

// POST /rooms/:name/join - Join a room (increment attendance)
router.post('/:name/join', async (req, res) => {
  try {
    const { name } = req.params;
    
    const result = await query(
      'UPDATE "rooms" SET attendance = attendance + 1 WHERE name = $1 RETURNING *',
      [name]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Joined room successfully',
      data: result.rows[0]
    });
    emitRoomsChanged(req, 'joined', name);
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to join room',
      message: error.message
    });
  }
});

// POST /rooms/:name/leave - Leave a room (decrement attendance)
router.post('/:name/leave', async (req, res) => {
  try {
    const { name } = req.params;
    
    const result = await query(
      'UPDATE "rooms" SET attendance = GREATEST(attendance - 1, 0) WHERE name = $1 RETURNING *',
      [name]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Left room successfully',
      data: result.rows[0]
    });
    emitRoomsChanged(req, 'left', name);
  } catch (error) {
    console.error('Error leaving room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to leave room',
      message: error.message
    });
  }
});

// POST /rooms/:name/exit - Leave room, and delete if creator is last participant
router.post('/:name/exit', async (req, res) => {
  try {
    const { name } = req.params;
    const { creator } = req.body || {};

    const roomResult = await query('SELECT * FROM "rooms" WHERE name = $1', [name]);
    if (roomResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }

    const room = roomResult.rows[0];
    const isCreator = typeof creator === 'string' && creator === room.creator;
    const isLastParticipant = Number(room.attendance) <= 1;

    if (isCreator && isLastParticipant) {
      await query('DELETE FROM "rooms" WHERE name = $1', [name]);
      emitRoomsChanged(req, 'deleted', name);
      return res.json({
        success: true,
        message: 'Room deleted because creator exited as last participant',
        deleted: true,
        data: null
      });
    }

    // Attendance is synchronized by socket disconnect logic in server.js.
    // Avoid decrementing here to prevent double-decrement races.
    return res.json({
      success: true,
      message: 'Exit acknowledged',
      deleted: false,
      data: room
    });
  } catch (error) {
    console.error('Error exiting room:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to exit room',
      message: error.message
    });
  }
});

module.exports = router;