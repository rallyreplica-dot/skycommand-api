const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

let bookings = [
  {
    id: 1,
    aircraftId: 'GGZDO',
    pilotId: 'P001',
    plannedDepartureTime: '2026-04-03T12:00:00Z',
    plannedArrivalTime: '2026-04-03T13:00:00Z',
    status: 'submitted',
  },
];

app.get('/api/flight-bookings', (req, res) => {
  res.json(bookings);
});

app.post('/api/flight-bookings', (req, res) => {
  const booking = {
    id: Date.now(),
    aircraftId: req.body.aircraftId || '',
    pilotId: req.body.pilotId || '',
    plannedDepartureTime: req.body.plannedDepartureTime || '',
    plannedArrivalTime: req.body.plannedArrivalTime || '',
    status: req.body.status || 'submitted',
  };

  bookings.push(booking);
  res.status(201).json(booking);
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
