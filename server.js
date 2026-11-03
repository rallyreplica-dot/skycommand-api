
// --- WebSocket server for real-time updates ---
let attachWebSocketServer;
let wsBroadcast;
try {
  ({ attachWebSocketServer } = require('./ws-server'));
  console.log('WebSocket server module loaded for real-time updates.');
} catch (e) {
  console.warn('WebSocket server not loaded:', e);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

function writeJsonAtomically(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (cleanupError) {
      console.error('Failed to clean up temporary persistence file:', cleanupError);
    }
    throw error;
  }
}

const app = express();
const PORT = 41000;
app.use(express.json());
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
  writeJsonAtomically(MOVEMENTS_FILE, movements);
}

let movements = loadMovements();
// Retrieve all completed aircraft movements
app.get('/api/movements', (req, res) => {
  res.json(movements);
});


// POST a new completed movement (from flight board)
app.post('/api/movements', (req, res) => {
  const entry = {
    ...req.body,
    timestamp: Date.now(),
  };
  const updatedMovements = [...movements, entry];
  try {
    saveMovements(updatedMovements);
  } catch (error) {
    console.error('Failed to save movement:', error);
    return res.status(500).json({ error: 'Failed to save movement' });
  }
  movements = updatedMovements;
  res.json({ message: 'Movement logged', entry });
});

const OVERFLIGHTS_FILE = path.join(__dirname, 'overflights.json');

function loadOverflights() {
  try {
    const records = JSON.parse(fs.readFileSync(OVERFLIGHTS_FILE, 'utf8'));
    if (!Array.isArray(records)) throw new Error('Overflight store must contain an array');
    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    console.error('Failed to load overflights:', error);
    throw error;
  }
}

let overflights = loadOverflights();

function recordOverflight(body, idempotencyKey = body.idempotencyKey) {
  const existing = overflights.find(record => record.idempotencyKey === idempotencyKey);
  if (existing) return { entry: existing, duplicate: true };

  const timestamp = Number.isFinite(Number(body.timestamp)) && body.timestamp !== ''
    ? Number(body.timestamp)
    : Date.now();
  const completedAt = new Date(timestamp);
  const record = {
    idempotencyKey,
    category: 'overflight',
    reg: String(body.reg || '').trim(),
    type: String(body.type || '').trim(),
    date: String(body.date || completedAt.toISOString().slice(0, 10)),
    time: String(body.time || ''),
    timestamp,
    completedAt: String(body.completedAt || completedAt.toISOString()),
    callsign: String(body.callsign || '').trim(),
    from: String(body.from || '').trim(),
    to: String(body.to || '').trim(),
    route: String(body.route || '').trim(),
    onTime: String(body.onTime || '').trim(),
    offTime: String(body.offTime || '').trim(),
    height: String(body.height || '').trim(),
    heading: String(body.heading || '').trim(),
  };
  const updatedOverflights = [...overflights, record];
  writeJsonAtomically(OVERFLIGHTS_FILE, updatedOverflights);
  overflights = updatedOverflights;
  return { entry: record, duplicate: false };
}

app.get('/api/overflights', (req, res) => {
  res.json(overflights);
});

app.post('/api/overflights', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'idempotencyKey is required' });
  }

  try {
    const result = recordOverflight(body, idempotencyKey);
    if (result.duplicate) {
      return res.json({ message: 'Overflight already recorded', ...result });
    }
    return res.status(201).json({ message: 'Overflight recorded', ...result });
  } catch (error) {
    console.error('Failed to save overflight:', error);
    return res.status(500).json({ error: 'Failed to save overflight' });
  }
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

function findBookingCompletion(bookingId) {
  const id = String(bookingId);
  const movement = movements.find(record => String(record.bookingId) === id);
  if (movement) return { kind: 'movement', record: movement };
  const overflight = overflights.find(record => record.idempotencyKey === `booking:${id}`);
  if (overflight) return { kind: 'overflight', record: overflight };
  return null;
}

function isBookingCompleted(booking) {
  return booking.status === 'completed' || findBookingCompletion(booking.id) !== null;
}

function persistCompletedBooking(bookingId) {
  const updatedBookings = bookings.map(booking => (
    String(booking.id) === String(bookingId)
      ? { ...booking, status: 'completed' }
      : booking
  ));
  writeJsonAtomically(BOOKINGS_FILE, updatedBookings);
  bookings = updatedBookings;
  return bookings.find(booking => String(booking.id) === String(bookingId));
}

function reconcileCompletedBookings() {
  const completedIds = new Set();
  movements.forEach(record => {
    if (record.bookingId !== undefined && record.bookingId !== null) {
      completedIds.add(String(record.bookingId));
    }
  });
  overflights.forEach(record => {
    if (typeof record.idempotencyKey === 'string' && record.idempotencyKey.startsWith('booking:')) {
      completedIds.add(record.idempotencyKey.slice('booking:'.length));
    }
  });

  let changed = false;
  const updatedBookings = bookings.map(booking => {
    if (completedIds.has(String(booking.id)) && booking.status !== 'completed') {
      changed = true;
      return { ...booking, status: 'completed' };
    }
    return booking;
  });
  if (changed) {
    writeJsonAtomically(BOOKINGS_FILE, updatedBookings);
    bookings = updatedBookings;
  }
}

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
  try {
    reconcileCompletedBookings();
  } catch (error) {
    console.error('Failed to reconcile completed bookings:', error);
    return res.status(500).json({ error: 'Failed to persist completed booking status' });
  }
  if (includeCancelled) {
    res.json(bookings.filter(booking => !isBookingCompleted(booking)));
  } else {
    res.json(bookings.filter(booking => (
      booking.status !== 'cancelled' && !isBookingCompleted(booking)
    )));
  }
});

// POST a new booking — accepts all fields from Pilot360 or manual entry
app.post('/api/flight-bookings', async (req, res) => {

  // Accept DDMMYY directly from client, fallback to today if missing or invalid
  let date = req.body.date;
  if (!date || typeof date !== 'string' || !/^\d{6}$/.test(date)) {
    // If not in DDMMYY, fallback to today
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yy = String(today.getFullYear()).slice(-2);
    date = `${dd}${mm}${yy}`;
  }

  const booking = {
    id: nextId++,
    ...req.body,
    date,
    status: req.body.status || 'pending',
  };

  bookings.push(booking);
  saveBookings();
  if (wsBroadcast) wsBroadcast();
  res.json(booking);
});

// Update booking status
app.post('/api/flight-bookings/:id/status', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  const { status } = req.body;

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  if (isBookingCompleted(booking)) {
    return res.status(409).json({ error: 'Completed booking cannot be changed' });
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
  if (wsBroadcast) wsBroadcast();
  res.json({ message: 'Booking status updated', booking });
});

app.post('/api/flight-bookings/:id/complete', (req, res) => {
  const booking = bookings.find(item => String(item.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  const bookingId = String(booking.id);
  let completion = findBookingCompletion(bookingId);
  const duplicate = completion !== null;
  if (!completion && (booking.status === 'denied' || booking.status === 'cancelled')) {
    return res.status(409).json({ error: `Cannot complete a ${booking.status} booking` });
  }

  if (!completion && req.body.category === 'overflight') {
    try {
      const result = recordOverflight(req.body, `booking:${bookingId}`);
      completion = { kind: 'overflight', record: result.entry };
    } catch (error) {
      console.error(`Failed to save overflight completion for booking ${bookingId}:`, error);
      return res.status(500).json({ error: 'Failed to save overflight completion' });
    }
  } else if (!completion) {
    const movement = {
      ...req.body,
      bookingId,
      timestamp: Date.now(),
    };
    const updatedMovements = [...movements, movement];
    try {
      saveMovements(updatedMovements);
    } catch (error) {
      console.error(`Failed to save movement for booking ${bookingId}:`, error);
      return res.status(500).json({ error: 'Failed to save movement' });
    }
    movements = updatedMovements;
    completion = { kind: 'movement', record: movement };
  }

  let completedBooking = booking;
  if (booking.status !== 'completed') {
    try {
      completedBooking = persistCompletedBooking(bookingId);
    } catch (error) {
      console.error(`Completion record saved but booking ${bookingId} status failed to save:`, error);
      return res.status(500).json({
        error: 'Completion record saved, but booking status was not saved; retry completion',
        recordSaved: true,
        retryable: true,
      });
    }
  }

  if (wsBroadcast) wsBroadcast();
  return res.json({
    message: 'Booking completed',
    booking: completedBooking,
    kind: completion.kind,
    record: completion.record,
    duplicate,
  });
});

// Approve booking
app.post('/api/flight-bookings/:id/approve', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (isBookingCompleted(booking)) {
    return res.status(409).json({ error: 'Completed booking cannot be changed' });
  }
  booking.status = 'approved';
  saveBookings();
  if (wsBroadcast) wsBroadcast();
  res.json(booking);
});

// Reject booking
app.post('/api/flight-bookings/:id/reject', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (isBookingCompleted(booking)) {
    return res.status(409).json({ error: 'Completed booking cannot be changed' });
  }
  booking.status = 'denied';
  saveBookings();
  if (wsBroadcast) wsBroadcast();
  res.json(booking);
});



const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`SkyCommand API running on http://127.0.0.1:${PORT}`);
  // Attach WebSocket server to this HTTP server
  if (attachWebSocketServer) {
    attachWebSocketServer(server);
    wsBroadcast = attachWebSocketServer.broadcastUpdate;
    console.log('WebSocket server attached for real-time updates.');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nERROR: Port ${PORT} is already in use.\n` +
      'Another instance of the server may be running, or the port is blocked.\n' +
      'Please stop the other process or use a different port.');
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
