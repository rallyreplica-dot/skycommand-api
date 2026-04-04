const express = require('express');
const cors = require('cors');
// Only keep this line if your Node version needs it:
// const fetch = require('node-fetch');

const app = express();
const PORT = 41000;

app.use(cors());
app.use(express.json());

let bookings = [];
let nextId = 1;

// GET all bookings
app.get('/api/flight-bookings', (req, res) => {
  res.json(bookings);
});

// POST a new booking
app.post('/api/flight-bookings', async (req, res) => {
  const {
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status,
  } = req.body;

  const booking = {
    id: nextId++,
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status: status || 'submitted',
  };

  bookings.push(booking);

  try {
    await fetch('http://127.0.0.1:49152/api/flight-bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pilot360BookingId: booking.id,
        aircraftId: booking.aircraftId,
        pilotId: booking.pilotId,
        plannedDepartureTime: booking.plannedDepartureTime,
        plannedArrivalTime: booking.plannedArrivalTime,
        status: booking.status,
      }),
    });
  } catch (error) {
    console.error('Error forwarding to SkyCommand:', error.message);
  }

  res.json(booking);
});

// Update booking status
app.post('/api/flight-bookings/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;

  const booking = bookings.find((b) => b.id === id);

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  booking.status = status;
  res.json(booking);
});

app.listen(PORT, () => {
  console.log(`Pilot360 backend running on http://127.0.0.1:${PORT}`);
  console.log('PILOT360 SERVER RUNNING ON 41000 - TEST MARKER A');
  console.log('Server is running on port 41000');
  console.log('Startup logs initialized for debugging.');
});



app.post('/api/flight-bookings', async (req, res) => {

  const {
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status,
  } = req.body;

  const booking = {
    id: nextId++,
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status: status || 'submitted',
  };

  // Save in Pilot360
  bookings.push(booking);

  // Forward to SkyCommand
  try {
    const response = await fetch('http://127.0.0.1:49152/api/flight-bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pilot360BookingId: booking.id,
        aircraftId: booking.aircraftId,
        pilotId: booking.pilotId,
        plannedDepartureTime: booking.plannedDepartureTime,
        plannedArrivalTime: booking.plannedArrivalTime,
        status: booking.status,
      }),
    });

    const skyCommandResult = await response.text();
    console.log('SkyCommand response:', skyCommandResult);
  } catch (error) {
    console.error('Error forwarding booking to SkyCommand:', error.message);
  }

  res.json(booking);
});

app.post('/api/flight-bookings/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;

  // Try to find by id or pilot360BookingId
  let booking = bookings.find((b) => b.id === id || b.pilot360BookingId === id);

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  booking.status = status;
  res.json(booking);
});



app.post('/api/flight-bookings', async (req, res) => {
  const {
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status,
  } = req.body;

  const booking = {
    id: nextId++, 
    aircraftId,
    pilotId,
    plannedDepartureTime,
    plannedArrivalTime,
    status: status || 'submitted',
  };

  // Save in Pilot360
  bookings.push(booking);

  // Forward to SkyCommand
  try {
    const response = await fetch('https://skycommand-api-1.onrender.com/api/flight-bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pilot360BookingId: booking.id,
        aircraftId: booking.aircraftId,
        pilotId: booking.pilotId,
        plannedDepartureTime: booking.plannedDepartureTime,
        plannedArrivalTime: booking.plannedArrivalTime,
        status: booking.status,
      }),
    });

    const skyCommandResult = await response.text();
    console.log('SkyCommand response:', skyCommandResult);
  } catch (error) {
    console.error('Error forwarding booking to SkyCommand:', error.message);
  }

  // Return local booking to Flutter
  res.json(booking);
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

  // Callback to Pilot360 if pilot360BookingId exists
  if (booking.pilot360BookingId) {
    const url = `http://127.0.0.1:3005/api/flight-bookings/${booking.pilot360BookingId}/status`;
    const body = { status: 'approved' };
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((response) => response.text())
      .then((data) => console.log('Pilot360 callback response:', data))
      .catch((err) => console.error('Error sending callback to Pilot360:', err.message));
  }

  res.json(booking);
});

app.post('/api/flight-bookings/:id/reject', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  booking.status = 'denied';

  // Callback to Pilot360 if pilot360BookingId exists
  if (booking.pilot360BookingId) {
    const url = `http://127.0.0.1:3002/api/flight-bookings/${booking.pilot360BookingId}/status`;
    const body = { status: 'denied' };
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((response) => response.text())
      .then((data) => console.log('Pilot360 callback response:', data))
      .catch((err) => console.error('Error sending callback to Pilot360:', err.message));
  }

  res.json(booking);
});



