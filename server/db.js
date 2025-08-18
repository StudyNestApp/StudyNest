const { Pool } = require('pg');
require('dotenv').config();

// NOTE: Use Transaction Pooler URL for IPv4 compatibility
// DATABASE_URL should be: postgresql://postgres.injrpzwzzxywxrlmapgu:password@aws-0-eu-central-2.pooler.supabase.com:6543/postgres

// Parse DATABASE_URL manually for better error handling
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Warn if using old direct connection URL
if (dbUrl.includes('db.injrpzwzzxywxrlmapgu.supabase.co')) {
  console.warn('⚠️  Warning: You are using IPv6-only direct connection URL.');
  console.warn('🔄 For IPv4 compatibility, use the pooler URL instead.');
}

// Create a connection pool
const pool = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 20 // Maximum pool size
});

// Test the connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Database connection error:', err);
});

// Function to execute queries
const query = async (text, params) => {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } catch (error) {
    console.error('Query error:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Function to close the pool
const closePool = async () => {
  await pool.end();
  console.log('Database pool closed');
};

module.exports = {
  pool,
  query,
  closePool
};