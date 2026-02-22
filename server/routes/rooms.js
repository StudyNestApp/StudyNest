const express = require('express');
const { query } = require('../db');
const crypto = require('crypto'); // IMPORTANT: Make sure this is imported
const router = express.Router();

// Helper function to generate unique video room ID
function generateVideoRoomId() {
  const id = crypto.randomBytes(16).toString('hex');
  console.log('🎯 Generated video room ID:', id); // Debug log
  return id;
}

// GET /rooms - Get all rooms
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM "rooms" ORDER BY created_at DESC');
    console.log('📋 Fetched rooms:', result.rows); // Debug log to see all rooms
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

// POST /rooms - Create a new room with enhanced debugging
router.post('/', async (req, res) => {
  try {
    const { creator, name, attendance = 1 } = req.body;
    
    console.log('📝 Creating room with data:', { creator, name, attendance });
    
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
    console.log('🎬 Generated video room ID:', videoRoomId);
    
    // Check table schema first
    console.log('🔍 Checking table schema...');
    const schemaCheck = await query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'rooms' AND table_schema = 'public'
    `);
    console.log('📊 Table schema:', schemaCheck.rows);
    
    // Check if video_url column exists
    const hasVideoUrlColumn = schemaCheck.rows.some(col => col.column_name === 'video_url');
    console.log('🎯 Has video_url column:', hasVideoUrlColumn);
    
    if (!hasVideoUrlColumn) {
      console.log('❌ video_url column does not exist! Creating it...');
      try {
        await query('ALTER TABLE "rooms" ADD COLUMN video_url VARCHAR(255)');
        console.log('✅ Successfully added video_url column');
      } catch (alterError) {
        console.error('❌ Failed to add video_url column:', alterError);
        return res.status(500).json({
          success: false,
          error: 'Database schema issue - video_url column missing and cannot be added',
          message: alterError.message
        });
      }
    }
    
    // Log the exact values we're about to insert
    const insertValues = [creator, name, attendance, videoRoomId];
    console.log('💾 About to insert with values:', insertValues);
    
    // Create room with video_url
    const insertQuery = 'INSERT INTO "rooms" (creator, name, created_at, attendance, video_url) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4) RETURNING *';
    console.log('📝 Insert query:', insertQuery);
    
    const result = await query(insertQuery, insertValues);
    
    console.log('✅ Room created successfully:', result.rows[0]);
    console.log('🔗 Video URL in result:', result.rows[0].video_url);
    
    // Double-check by selecting the room again
    const verifyResult = await query('SELECT * FROM "rooms" WHERE name = $1', [name]);
    console.log('🔍 Verification select:', verifyResult.rows[0]);
    
    // Triple check - verify the video_url is actually stored
    if (!verifyResult.rows[0].video_url) {
      console.error('❌ CRITICAL: video_url is NULL in database after insert!');
      console.log('🔧 Attempting manual update...');
      
      const updateResult = await query('UPDATE "rooms" SET video_url = $1 WHERE name = $2 RETURNING *', [videoRoomId, name]);
      console.log('🔄 Manual update result:', updateResult.rows[0]);
      
      if (updateResult.rows[0].video_url) {
        console.log('✅ Manual update successful');
        return res.status(201).json({
          success: true,
          message: 'Room created successfully (with manual video_url fix)',
          data: updateResult.rows[0]
        });
      } else {
        console.error('❌ Manual update also failed');
      }
    }
    
    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error creating room:', error);
    console.error('📊 Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to create room',
      message: error.message,
      code: error.code
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
  } catch (error) {
    console.error('Error leaving room:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to leave room',
      message: error.message
    });
  }
});

module.exports = router;