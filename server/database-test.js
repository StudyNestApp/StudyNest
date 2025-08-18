// database-test.js
// Run this script to test your database connection and schema

const { query } = require('./db'); // Adjust path as needed

async function testDatabase() {
  console.log('=== DATABASE CONNECTION TEST ===');
  
  try {
    // Test basic connection
    console.log('1. Testing database connection...');
    const connectionTest = await query('SELECT NOW()');
    console.log('✅ Database connection successful');
    console.log('Current time:', connectionTest.rows[0].now);
    
    // Check if Rooms table exists
    console.log('\n2. Checking if Rooms table exists...');
    const tableCheck = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'Rooms'
    `);
    
    if (tableCheck.rows.length === 0) {
      console.log('❌ Rooms table does not exist!');
      console.log('You need to create the Rooms table first.');
      return;
    }
    console.log('✅ Rooms table exists');
    
    // Check table schema
    console.log('\n3. Checking Rooms table schema...');
    const schemaCheck = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'Rooms' 
      ORDER BY ordinal_position
    `);
    
    console.log('Table schema:');
    schemaCheck.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
    });
    
    // Test a simple SELECT
    console.log('\n4. Testing SELECT query...');
    const selectTest = await query('SELECT * FROM "Rooms" LIMIT 5');
    console.log(`✅ SELECT successful. Found ${selectTest.rows.length} rooms`);
    
    // Test INSERT with sample data
    console.log('\n5. Testing INSERT query...');
    const testRoomName = `test-room-${Date.now()}`;
    const insertTest = await query(
      'INSERT INTO "Rooms" (creator, name, created_at, attendance) VALUES ($1, $2, CURRENT_TIMESTAMP, $3) RETURNING *',
      ['testuser', testRoomName, 1]
    );
    console.log('✅ INSERT successful');
    console.log('Created room:', insertTest.rows[0]);
    
    // Clean up test data
    console.log('\n6. Cleaning up test data...');
    await query('DELETE FROM "Rooms" WHERE name = $1', [testRoomName]);
    console.log('✅ Test data cleaned up');
    
    console.log('\n🎉 All database tests passed!');
    
  } catch (error) {
    console.error('\n❌ Database test failed:');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Full error:', error);
  }
}

// If Rooms table doesn't exist, here's the CREATE statement
function printCreateTableStatement() {
  console.log('\n=== CREATE ROOMS TABLE ===');
  console.log('If the Rooms table doesn\'t exist, run this SQL:');
  console.log(`
CREATE TABLE "Rooms" (
  id SERIAL PRIMARY KEY,
  creator VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  attendance INTEGER DEFAULT 0
);
  `);
}

// Run the test
testDatabase().then(() => {
  printCreateTableStatement();
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error);
  printCreateTableStatement();
  process.exit(1);
});