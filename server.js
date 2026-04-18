
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 41000;

// --- Movements Log Persistence ---
const MOVEMENTS_FILE = path.join(__dirname, 'movements-log.json');

function loadMovements() {
  try {
    const data = fs.readFileSync(MOVEMENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveMovements(movements) {
  try {
    fs.writeFileSync(MOVEMENTS_FILE, JSON.stringify(movements, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save movements:', err);
  }
}

let movements = loadMovements();



// POST a new completed movement (from flight board)
app.post('/api/movements', (req, res) => {
  const entry = {
    ...req.body,
    timestamp: Date.now(),
  };
  movements.push(entry);
  saveMovements(movements);
  res.json({ message: 'Movement logged', entry });
});

// Serve static files (flight-board, etc.)
app.use('/static', express.static(path.join(__dirname, 'static')));
// Serve main project assets (airports.csv, etc.)
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// Redirect root to flight-board
app.get('/', (req, res) => {
  res.redirect('/static/flight-board.html');
});

app.use(cors());
app.use(express.json());

// --- Persistence ---
const BOOKINGS_FILE = path.join(__dirname, 'bookings-data.json');

function loadBookings() {
  try {
    const data = fs.readFileSync(BOOKINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveBookings() {
  try {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save bookings:', err);
  }
}

let bookings = loadBookings();
let nextId = bookings.length > 0 ? Math.max(...bookings.map(b => b.id || 0)) + 1 : 1;

// --- Aircraft type lookup (loaded once at startup) ---
const regToType = {};
const acDbFiles = ['report.txt', 'heli.txt', 'turboexec.txt'];
acDbFiles.forEach(file => {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8');
    const lines = txt.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return;
    const header = lines[0].split(/\s+/);
    const regIdx = header.indexOf('currentid');
    const typeIdx = header.indexOf('ICAO_type');
    if (regIdx === -1 || typeIdx === -1) return;
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split(/\s+/);
      if (fields.length > Math.max(regIdx, typeIdx)) {
        const reg = fields[regIdx].trim().toUpperCase();
        const type = fields[typeIdx].trim().toUpperCase();
        if (reg && type) regToType[reg] = type;
      }
    }
  } catch (e) { /* skip missing files */ }
});
console.log(`Loaded ${Object.keys(regToType).length} aircraft type mappings`);

// API: lookup aircraft type by registration
app.get('/api/aircraft-type/:reg', (req, res) => {
  const reg = (req.params.reg || '').toUpperCase();
  // Try exact, without dashes, with dash after first char
  const type = regToType[reg] || regToType[reg.replace(/-/g, '')] || (reg.length > 1 ? regToType[reg[0] + '-' + reg.slice(1)] : null);
  res.json({ reg, type: type || null });
});

// API: batch lookup aircraft types
app.post('/api/aircraft-types', (req, res) => {
  const regs = req.body.regs || [];
  const results = {};
  regs.forEach(r => {
    const reg = (r || '').toUpperCase();
    results[reg] = regToType[reg] || regToType[reg.replace(/-/g, '')] || (reg.length > 1 ? regToType[reg[0] + '-' + reg.slice(1)] : null) || null;
  });
  res.json(results);
});

// GET all bookings
// GET all bookings (exclude cancelled by default)
app.get('/api/flight-bookings', (req, res) => {
  // Optionally allow ?includeCancelled=true
  const includeCancelled = req.query.includeCancelled === 'true';
  if (includeCancelled) {
    res.json(bookings);
  } else {
    res.json(bookings.filter(b => b.status !== 'cancelled'));
  }
});

// POST a new booking — accepts all fields from Pilot360 or manual entry
app.post('/api/flight-bookings', async (req, res) => {
  // Add date in DDMMYY format for flight board filtering
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yy = String(today.getFullYear()).slice(-2);
  const date = `${dd}${mm}${yy}`;

  const booking = {
    id: nextId++,
    ...req.body,
    date,
    status: req.body.status || 'pending',
  };

  bookings.push(booking);
  saveBookings();
  res.json(booking);
});

// Update booking status
app.post('/api/flight-bookings/:id/status', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  const { status } = req.body;

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  if (status !== 'approved' && status !== 'denied' && status !== 'cancelled') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  booking.status = status;
  console.log(`[DEBUG] Booking ${booking.id} status set to ${status}`);

  // If cancelling a landaway, also cancel the return flight (match on aircraft, from/to swap, and date)
  if (status === 'cancelled' && booking.type && booking.type.toLowerCase() === 'landaway') {
    const returnFlight = bookings.find(b => {
      const match = (
        b.id !== booking.id &&
        b.status !== 'cancelled' &&
        b.type && b.type.toLowerCase() === 'landaway' &&
        b.aircraft === booking.aircraft &&
        b.from === booking.to &&
        b.to === booking.from &&
        b.date === booking.date &&
        (
          (b.etd && booking.etd && b.etd > booking.etd) ||
          (b.id > booking.id)
        )
      );
      if (match) {
        console.log(`[DEBUG] Return flight candidate: id=${b.id}, aircraft=${b.aircraft}, from=${b.from}, to=${b.to}, date=${b.date}, etd=${b.etd}`);
      }
      return match;
    });
    if (returnFlight) {
      returnFlight.status = 'cancelled';
      console.log(`[DEBUG] Return flight ${returnFlight.id} also set to cancelled.`);
    } else {
      console.log('[DEBUG] No matching return flight found for cancellation.');
    }
  }

  saveBookings();
  res.json({ message: 'Booking status updated', booking });
});

// Approve booking
app.post('/api/flight-bookings/:id/approve', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  booking.status = 'approved';
  saveBookings();
  res.json(booking);
});

// Reject booking
app.post('/api/flight-bookings/:id/reject', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  booking.status = 'denied';
  saveBookings();
  res.json(booking);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`SkyCommand API running on http://127.0.0.1:${PORT}`);
});
