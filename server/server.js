const express = require('express');
const cors = require('cors');
require('dotenv').config();

const roomsRouter = require('./routes/rooms'); // adjust path if needed

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/rooms', roomsRouter);

// Health check (optional)
app.get('/', (req, res) => {
  res.send('API is running... :)');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
