const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for bookings
const bookings = [];

// Serve static files (adjust 'static' if your folder is named differently)
app.use('/static', express.static(path.join(__dirname, 'static')));

// API: Get all bookings
app.get('/api/flight-bookings', (req, res) => {
  res.json(bookings);
});

// API: Add a new booking
app.post('/api/flight-bookings', (req, res) => {
  const booking = req.body;
  bookings.push(booking);
  res.status(201).json(booking);
});

// Fallback: Serve index.html for any other route (optional, for SPAs)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'flight-board.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
