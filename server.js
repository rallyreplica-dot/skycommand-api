const axios = require('axios');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let bookings = [];
let nextId = 1;

app.get('/api/flight-bookings', (req, res) => {
  res.json(bookings);
});

app.post('/api/flight-bookings', (req, res) => {
  const {
    pilot360BookingId,
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status,
  } = req.body;

  const booking = {
    id: nextId++,
    pilot360BookingId: pilot360BookingId || null,
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status: status || 'submitted',
  };

  bookings.push(booking);
  res.status(201).json(booking);
});

app.post('/api/flight-bookings/:id/status', async (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  const { status } = req.body;

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  if (status !== 'approved' && status !== 'denied') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  booking.status = status;

  if (booking.pilot360BookingId) {
    try {
      await axios.post(
        `http://localhost:3001/api/flight-bookings/${booking.pilot360BookingId}/status`,
        { status }
      );
    } catch (err) {
      console.error('Error syncing status to Pilot360:', err.message);
    }
  }

  res.json({
    message: 'Booking status updated',
    booking,
  });
});

app.post('/api/flight-bookings/:id/approve', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  booking.status = 'approved';
  res.json(booking);
});

app.post('/api/flight-bookings/:id/reject', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  booking.status = 'denied';
  res.json(booking);
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Pilot360 backend running on port ${PORT}`);
});
