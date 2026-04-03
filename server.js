const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Example bookings (replace with real data later)
let bookings = [
  {
    id: 1,
    aircraft: "GGZDO",
    pilot: "P001",
    departure: "2026-04-03T12:00:00Z",
    arrival: "2026-04-03T13:00:00Z",
    status: "submitted"
  }
];

// GET bookings
app.get('/api/flight-bookings', (req, res) => {
  res.json(bookings);
});

// Approve booking
app.post('/api/flight-bookings/:id/approve', (req, res) => {
  const booking = bookings.find(b => b.id == req.params.id);
  if (booking) {
    booking.status = "approved";
    res.json(booking);
  } else {
    res.status(404).send("Not found");
  }
});

// Reject booking
app.post('/api/flight-bookings/:id/reject', (req, res) => {
  const booking = bookings.find(b => b.id == req.params.id);
  if (booking) {
    booking.status = "denied";
    res.json(booking);
  } else {
    res.status(404).send("Not found");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
