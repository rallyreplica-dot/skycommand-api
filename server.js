const express = require("express");
const cors = require("cors");
const app = express();

app.use('/static', express.static('static'));
app.use(cors());
app.use(express.json());

let bookings = []; // This will store bookings in memory

// GET /bookings - return all bookings
app.get('/bookings', (req, res) => {
  res.json(bookings);
});

// POST /api/flight-bookings - add a new booking
app.post('/api/flight-bookings', (req, res) => {
  const booking = req.body;
  bookings.push(booking);
  res.status(201).json(booking);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});