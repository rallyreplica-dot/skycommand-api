const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let bookings = [];
let nextId = 1;

// 1. GET all bookings
app.get('/api/flight-bookings', (req, res) => {
  res.json(bookings);
});

// 2. POST create booking
app.post('/api/flight-bookings', (req, res) => {
  const { aircraftId, pilotId, plannedDepartureTime, plannedArrivalTime } = req.body;
  const booking = {
    id: nextId++,
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status: 'submitted',
  };
  bookings.push(booking);
  res.status(201).json(booking);
});

// 3. POST update status
app.post('/api/flight-bookings/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  const booking = bookings.find(b => b.id === id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (status !== 'approved' && status !== 'denied') {
    return res.status(400).json({ error: 'Invalid status' });
  }
  booking.status = status;
  res.json(booking);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
