const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Persistent storage for bookings
let bookings = [];
// Load bookings from file if exists
function loadBookings() {
  try {
    if (fs.existsSync(BOOKINGS_FILE)) {
      const data = fs.readFileSync(BOOKINGS_FILE, 'utf8');
      bookings = JSON.parse(data);
      console.log(`[Bookings] Loaded ${bookings.length} bookings from file.`);
    }
  } catch (err) {
    console.error('[Bookings] Failed to load bookings:', err);
    bookings = [];
  }
}
function saveBookings() {
  try {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf8');
    //console.log('[Bookings] Saved bookings to file.');
  } catch (err) {
    console.error('[Bookings] Failed to save bookings:', err);
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

// GET all bookings
app.get('/api/flight-bookings', (req, res) => {
  res.json(bookings);
});

// POST a new booking
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

// Approve booking
app.post('/api/flight-bookings/:id/approve', (req, res) => {
  const booking = bookings.find(
    (b) => String(b.id) === String(req.params.id)
  );

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  booking.status = 'approved';
  res.json(booking);
});

// Reject booking
app.post('/api/flight-bookings/:id/reject', (req, res) => {
  const booking = bookings.find(
    (b) => String(b.id) === String(req.params.id)
  );

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
  }
}
loadBookings();

// Serve static files (adjust 'static' if your folder is named differently)
app.use('/static', express.static(path.join(__dirname, 'static')));

// API: Get all bookings
app.get('/api/flight-bookings', (req, res) => {
  // Always return bookings with plannedDepartureTime, plannedArrivalTime, and displayDate
  res.json(bookings.map(b => {
    let plannedDepartureTime = b.plannedDepartureTime;
    let plannedArrivalTime = b.plannedArrivalTime;
    let displayDate = b.displayDate;
    // Patch legacy bookings if needed
    if (!plannedDepartureTime && b.date && b.date.match(/^\d{2}\d{2}\d{2}$/)) {
      const dd = b.date.slice(0,2);
      const mm = b.date.slice(2,4);
      const yy = b.date.slice(4,6);
      const yyyy = `20${yy}`;
      plannedDepartureTime = `${yyyy}-${mm}-${dd}T00:00:00Z`;
      plannedArrivalTime = `${yyyy}-${mm}-${dd}T01:00:00Z`;
      displayDate = b.date;
    }
    return {
      ...b,
      plannedDepartureTime,
      plannedArrivalTime,
      displayDate
    };
  }));
});

// API: Add a new booking
app.post('/api/flight-bookings', (req, res) => {
  const incoming = req.body;
  console.log('Received booking:', incoming);
  function normalizeAirport(name) {
    if (!name) return '';
    let n = name.toUpperCase().replace(/\b(AIRFIELD|AERODROME|HELIPORT)\b/g, '').trim();
    if (n === 'NORTH WEALD') return 'EGSX';
    if (n === 'DUXFORD') return 'EGSU';
    return n;
  }
  let plannedDepartureTime = '';
  let plannedArrivalTime = '';
  let displayDate = '';
  if (incoming.plannedDepartureTime) {
    plannedDepartureTime = new Date(incoming.plannedDepartureTime).toISOString();
    plannedArrivalTime = new Date(new Date(incoming.plannedDepartureTime).getTime() + 60*60*1000).toISOString();
    const d = new Date(incoming.plannedDepartureTime);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    displayDate = `${dd}${mm}${yy}`;
  } else if (incoming.date && incoming.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    plannedDepartureTime = `${incoming.date}T00:00:00Z`;
    plannedArrivalTime = `${incoming.date}T01:00:00Z`;
    const [yyyy, mm, dd] = incoming.date.split('-');
    displayDate = `${dd}${mm}${yyyy.slice(-2)}`;
  } else if (incoming.date) {
    const m = incoming.date.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (m) {
      const [_, dd, mm, yy] = m;
      const yyyy = `20${yy}`;
      plannedDepartureTime = `${yyyy}-${mm}-${dd}T00:00:00Z`;
      plannedArrivalTime = `${yyyy}-${mm}-${dd}T01:00:00Z`;
      displayDate = incoming.date;
    } else {
      displayDate = incoming.date;
    }
  }
  const booking = {
    id: Math.random().toString(36).substr(2, 9),
    aircraft: incoming.aircraftId || incoming.aircraft || '',
    from: normalizeAirport(incoming.departureAirport || incoming.from || ''),
    to: normalizeAirport(incoming.arrivalAirport || incoming.to || ''),
    pob: incoming.passengers || incoming.pob || '',
    status: 'pending',
    plannedDepartureTime,
    plannedArrivalTime,
    displayDate
  };
  bookings.push(booking);
  saveBookings();
  // Forward booking to Python backend for calendar integration
  const pythonBooking = {
    pilot: incoming.pilot || '',
    aircraft: booking.aircraft,
    date: booking.displayDate ? formatDateForPython(booking.displayDate) : '',
    time: incoming.time || '',
    status: booking.status
  };
  // Helper to convert DDMMYY to YYYY-MM-DD
  function formatDateForPython(ddmmyy) {
    if (!ddmmyy || ddmmyy.length !== 6) return '';
    const dd = ddmmyy.slice(0,2);
    const mm = ddmmyy.slice(2,4);
    const yy = ddmmyy.slice(4,6);
    return `20${yy}-${mm}-${dd}`;
  }
  fetch('http://localhost:5000/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pythonBooking)
  }).then(() => {
    res.status(201).json(booking);
  }).catch(err => {
    console.error('[Forward to Python] Failed:', err);
    res.status(201).json(booking);
  });
});

// Fallback: Serve index.html for any other route (optional, for SPAs)

// PATCH booking status by id

// Helper to send outbound POST to Pilot360
const notifyPilot360 = async ({ bookingId, status }) => {
  const endpoint = `http://172.25.0.138:3000/api/flight-bookings/${bookingId}/status`;
  const token = 'YOUR_PILOT360_TOKEN'; // Placeholder token
  try {
    const payload = {
      bookingId,
      status,
      timestamp: new Date().toISOString(),
      source: 'SkyCommand'
    };
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    console.log(`[Pilot360] Notified:`, payload);
  } catch (err) {
    console.error('[Pilot360] Notification failed:', err);
  }
};

app.patch('/bookings/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const booking = bookings.find(b => b.id === id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  booking.status = status;
  saveBookings();
  // Notify Pilot360 on approve/deny
  if (status === 'approved' || status === 'denied') {
    notifyPilot360({ bookingId: id, status });
  }
  res.json(booking);
});

// NEW: Endpoint for external systems to receive approve/deny status updates
app.post('/api/booking-status-updates', (req, res) => {
  const { bookingId, status, source } = req.body;
  // Log the update for now; in future, forward to Pilot360 or other systems
  console.log(`[STATUS UPDATE] Booking ${bookingId} set to ${status} by ${source || 'unknown'}`);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'flight-board.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});