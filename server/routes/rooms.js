const express = require('express');
const { query } = require('../db');
const router = express.Router();

// GET /rooms - Get all rooms
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM "Rooms" ORDER BY created_at DESC');
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

// GET /rooms/:id - Get a specific room (if you add an id column later)
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const result = await query('SELECT * FROM "Rooms" WHERE name = $1', [name]);
    
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
    const { creator, name, attendance = 0 } = req.body;
    
    // Validation
    if (!creator || !name) {
      return res.status(400).json({
        success: false,
        error: 'Creator and name are required'
      });
    }
    
    // Check if room already exists
    const existingRoom = await query('SELECT * FROM "Rooms" WHERE name = $1', [name]);
    if (existingRoom.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Room with this name already exists'
      });
    }
    
    // Create room with current time
    const result = await query(
      `INSERT INTO "Rooms" (creator, name, created_at, attendance) 
       VALUES ($1, $2, CURRENT_TIME, $3) 
       RETURNING *`,
      [creator, name, attendance]
    );
    
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
    const existingRoom = await query('SELECT * FROM "Rooms" WHERE name = $1', [name]);
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
      `UPDATE "Rooms" SET ${updates.join(', ')} WHERE name = $${paramCount} RETURNING *`,
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
    const existingRoom = await query('SELECT * FROM "Rooms" WHERE name = $1', [name]);
    if (existingRoom.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Room not found'
      });
    }
    
    await query('DELETE FROM "Rooms" WHERE name = $1', [name]);
    
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
      'UPDATE "Rooms" SET attendance = $1 WHERE name = $2 RETURNING *',
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

module.exports = router;