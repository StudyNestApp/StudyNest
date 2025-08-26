// debug-room.js - Test room creation step by step
const { query } = require('./db'); // Adjust path to your db file
const crypto = require('crypto');

function generateVideoRoomId() {
  return crypto.randomBytes(16).toString('hex');
}

async function debugRoomCreation() {
  try {
    console.log('🔍 Debug: Testing room creation step by step\n');
    
    // Step 1: Test the generateVideoRoomId function
    const testVideoId = generateVideoRoomId();
    console.log('1. Generated video ID:', testVideoId);
    console.log('   Type:', typeof testVideoId);
    console.log('   Length:', testVideoId.length);
    
    // Step 2: Check current table structure
    console.log('\n2. Checking table structure...');
    const columns = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'Rooms' AND column_name IN ('name', 'creator', 'attendance', 'video_url', 'created_at')
      ORDER BY ordinal_position;
    `);
    console.table(columns.rows);
    
    // Step 3: Test a simple INSERT
    const testRoomName = `debug-test-${Date.now()}`;
    const testCreator = 'debug-user';
    const testAttendance = 1;
    const testVideoUrl = generateVideoRoomId();
    
    console.log('\n3. Testing INSERT with values:');
    console.log('   creator:', testCreator);
    console.log('   name:', testRoomName);
    console.log('   attendance:', testAttendance);
    console.log('   video_url:', testVideoUrl);
    
    // First, let's try a very explicit INSERT
    const insertResult = await query(`
      INSERT INTO "Rooms" (creator, name, attendance, video_url, created_at) 
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
      RETURNING *
    `, [testCreator, testRoomName, testAttendance, testVideoUrl]);
    
    console.log('\n4. INSERT result:');
    console.log(insertResult.rows[0]);
    
    // Step 4: Verify by selecting the inserted row
    const selectResult = await query('SELECT * FROM "Rooms" WHERE name = $1', [testRoomName]);
    console.log('\n5. SELECT result:');
    console.log(selectResult.rows[0]);
    
    // Check if video_url is actually stored
    if (selectResult.rows[0].video_url) {
      console.log('✅ video_url was stored correctly!');
    } else {
      console.log('❌ video_url is null/empty in database');
      
      // Let's check what's in the database exactly
      const rawQuery = await query(`
        SELECT 
          video_url,
          video_url IS NULL as is_null,
          video_url = '' as is_empty_string,
          LENGTH(video_url) as url_length,
          pg_typeof(video_url) as url_type
        FROM "Rooms" WHERE name = $1
      `, [testRoomName]);
      
      console.log('Raw video_url analysis:', rawQuery.rows[0]);
    }
    
    // Clean up
    await query('DELETE FROM "Rooms" WHERE name = $1', [testRoomName]);
    console.log('\n🧹 Test room cleaned up');
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
    console.error('Full error:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      position: error.position,
      query: error.query
    });
  }
}

debugRoomCreation().then(() => {
  console.log('\n✨ Debug complete');
  process.exit(0);
}).catch(error => {
  console.error('💥 Debug script failed:', error);
  process.exit(1);
});