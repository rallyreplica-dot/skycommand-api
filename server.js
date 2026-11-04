
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
const DATA_DIR = process.env.SKYCOMMAND_DATA_DIR || __dirname;

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
const PORT = Number(process.env.PORT) || 41000;
app.use(express.json());
// --- Movements Log Persistence ---
const MOVEMENTS_FILE = path.join(DATA_DIR, 'movements-log.json');

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

const OVERFLIGHTS_FILE = path.join(DATA_DIR, 'overflights.json');

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

const MANUAL_STRIPS_FILE = path.join(DATA_DIR, 'manual-strips.json');
const MANUAL_STRIP_LANES = new Set([
  'booked-out-top',
  'taxying-in',
  'taxying-out',
  'circuit-top',
  'circuit-bottom',
  'local',
  'booked-in',
]);
const MANUAL_STRIP_CATEGORIES = new Set(['landaway', 'circuit', 'local', 'arrival', 'overflight']);

function loadManualStrips() {
  try {
    const records = JSON.parse(fs.readFileSync(MANUAL_STRIPS_FILE, 'utf8'));
    if (!Array.isArray(records)) throw new Error('Manual strip store must contain an array');
    return records;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    console.error('Failed to load manual strips:', error);
    throw error;
  }
}

let manualStrips = loadManualStrips();

function findManualStripCompletion(id) {
  const movement = movements.find(record => String(record.manualStripId) === id);
  if (movement) return { kind: 'movement', record: movement };
  const overflight = overflights.find(record => record.idempotencyKey === `manual:${id}`);
  if (overflight) return { kind: 'overflight', record: overflight };
  return null;
}

function saveManualStrips(updatedManualStrips) {
  writeJsonAtomically(MANUAL_STRIPS_FILE, updatedManualStrips);
  manualStrips = updatedManualStrips;
}

function normalizeManualStrip(id, body, existing) {
  const text = key => String(
    body[key] !== undefined ? body[key] : (existing && existing[key]) || ''
  ).trim();
  const boolean = key => body[key] !== undefined
    ? body[key] === true || body[key] === 'true'
    : Boolean(existing && existing[key]);
  const now = Date.now();

  return {
    id,
    reg: text('reg'),
    callsign: text('callsign'),
    posn: text('posn'),
    from: text('from'),
    to: text('to'),
    type: text('type'),
    flightType: text('flightType'),
    category: text('category'),
    status: text('status') || 'active',
    pob: text('pob'),
    height: text('height'),
    heading: text('heading'),
    lane: text('lane'),
    etd: text('etd'),
    eta: text('eta'),
    atd: text('atd'),
    ata: text('ata'),
    onTime: text('onTime'),
    offTime: text('offTime'),
    notes: text('notes'),
    rwy: boolean('rwy'),
    q: boolean('q'),
    fuel: boolean('fuel'),
    lights: boolean('lights'),
    ifr: boolean('ifr'),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
}

function validateManualStrip(record) {
  return MANUAL_STRIP_CATEGORIES.has(record.category)
    && MANUAL_STRIP_LANES.has(record.lane);
}

app.get('/api/manual-strips', (req, res) => {
  try {
    const activeStrips = manualStrips.filter(strip => !findManualStripCompletion(strip.id));
    if (activeStrips.length !== manualStrips.length) {
      saveManualStrips(activeStrips);
      if (wsBroadcast) wsBroadcast();
    }
    return res.json(manualStrips);
  } catch (error) {
    console.error('Failed to load active manual strips:', error);
    return res.status(500).json({ error: 'Failed to load active manual strips' });
  }
});

app.put('/api/manual-strips/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id || id.length > 128) {
    return res.status(400).json({ error: 'A valid manual strip ID is required' });
  }
  if (findManualStripCompletion(id)) {
    return res.status(409).json({ error: 'Completed manual strip cannot be changed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const existing = manualStrips.find(strip => strip.id === id);
  const record = normalizeManualStrip(id, body, existing);
  if (!validateManualStrip(record)) {
    return res.status(400).json({ error: 'Invalid manual strip category or lane' });
  }

  try {
    const updatedStrips = manualStrips.filter(strip => strip.id !== id).concat(record);
    saveManualStrips(updatedStrips);
  } catch (error) {
    console.error(`Failed to save manual strip ${id}:`, error);
    return res.status(500).json({ error: 'Failed to save manual strip' });
  }

  if (wsBroadcast) wsBroadcast();
  return res.json(record);
});

app.post('/api/manual-strips/:id/complete', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id || id.length > 128) {
    return res.status(400).json({ error: 'A valid manual strip ID is required' });
  }

  let strip = manualStrips.find(record => record.id === id);
  let completion = findManualStripCompletion(id);
  const duplicate = completion !== null;
  if (!strip && !completion) {
    return res.status(404).json({ error: 'Manual strip not found' });
  }

  if (strip) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    strip = normalizeManualStrip(id, body, strip);
    if (!validateManualStrip(strip)) {
      return res.status(400).json({ error: 'Invalid manual strip category or lane' });
    }
    try {
      saveManualStrips(manualStrips.filter(record => record.id !== id).concat(strip));
    } catch (error) {
      console.error(`Failed to save final state for manual strip ${id}:`, error);
      return res.status(500).json({ error: 'Failed to save manual strip before completion' });
    }
  }

  if (!completion) {
    if (strip.category === 'overflight') {
      const timestamp = Date.now();
      const completedAt = new Date(timestamp).toISOString();
      try {
        const result = recordOverflight({
          idempotencyKey: `manual:${id}`,
          reg: strip.reg,
          type: strip.type,
          date: completedAt.slice(0, 10),
          time: completedAt.slice(11, 16),
          timestamp,
          completedAt,
          callsign: strip.callsign,
          from: strip.from,
          to: strip.to,
          route: [strip.from, strip.to].filter(Boolean).join(' - '),
          onTime: strip.onTime || strip.atd,
          offTime: strip.offTime || strip.ata,
          height: strip.height,
          heading: strip.heading,
        }, `manual:${id}`);
        completion = { kind: 'overflight', record: result.entry };
      } catch (error) {
        console.error(`Failed to save overflight for manual strip ${id}:`, error);
        return res.status(500).json({ error: 'Failed to save overflight completion' });
      }
    } else {
      const movement = {
        reg: strip.reg,
        callsign: strip.callsign,
        type: strip.type,
        from: strip.from,
        to: strip.to,
        atd: strip.atd,
        ata: strip.ata,
        name: strip.notes,
        pob: strip.pob,
        colorClass: strip.category,
        timestamp: Date.now(),
        manualStripId: id,
      };
      const updatedMovements = [...movements, movement];
      try {
        saveMovements(updatedMovements);
      } catch (error) {
        console.error(`Failed to save movement for manual strip ${id}:`, error);
        return res.status(500).json({ error: 'Failed to save movement completion' });
      }
      movements = updatedMovements;
      completion = { kind: 'movement', record: movement };
    }
  }

  try {
    saveManualStrips(manualStrips.filter(record => record.id !== id));
  } catch (error) {
    console.error(`Completion saved but manual strip ${id} could not be removed:`, error);
    return res.status(500).json({
      error: 'Completion saved, but manual strip removal failed; retry completion',
      recordSaved: true,
      retryable: true,
    });
  }

  if (wsBroadcast) wsBroadcast();
  return res.json({
    message: 'Manual strip completed',
    kind: completion.kind,
    record: completion.record,
    duplicate,
  });
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
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings-data.json');

function loadBookings() {
  try {
    const data = fs.readFileSync(BOOKINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveBookings(updatedBookings = bookings) {
  writeJsonAtomically(BOOKINGS_FILE, updatedBookings);
  bookings = updatedBookings;
}

let bookings = loadBookings();
let nextId = bookings.length > 0 ? Math.max(...bookings.map(b => b.id || 0)) + 1 : 1;

function getBookingLegs(booking) {
  return booking.returnDate && String(booking.returnDate).trim()
    ? ['outbound', 'return']
    : ['outbound'];
}

const BOOKING_STRIP_LANES = new Set([
  'booked-out-top',
  'taxying-in',
  'taxying-out',
  'circuit-top',
  'circuit-bottom',
  'local',
  'booked-in',
]);
const BOOKING_STRIP_CATEGORIES = new Set(['landaway', 'circuit', 'local', 'arrival', 'overflight']);
const BOOKING_STRIP_TEXT_FIELDS = [
  'reg', 'callsign', 'posn', 'from', 'to', 'type', 'flightType', 'category',
  'pob', 'height', 'heading', 'lane', 'etd', 'eta', 'atd', 'ata',
  'onTime', 'offTime', 'notes',
];
const BOOKING_STRIP_BOOLEAN_FIELDS = ['rwy', 'q', 'fuel', 'lights', 'ifr'];

function getBookingLegDetails(booking, leg) {
  const isReturn = leg === 'return';
  const from = isReturn
    ? booking.to || booking.arrival || ''
    : booking.from || booking.departure || '';
  const to = isReturn
    ? booking.from || booking.departure || ''
    : booking.to || booking.arrival || '';
  const normalizedFrom = String(from).trim().toUpperCase().replace(/\s+(AIRFIELD|AIRPORT|AERODROME)$/g, '');
  const normalizedTo = String(to).trim().toUpperCase().replace(/\s+(AIRFIELD|AIRPORT|AERODROME)$/g, '');
  const fromIsBase = normalizedFrom === 'EGSX' || normalizedFrom === 'NORTH WEALD';
  const toIsBase = normalizedTo === 'EGSX' || normalizedTo === 'NORTH WEALD';
  const flightType = String(booking.type || '').toUpperCase();
  let category;
  let lane;

  if (flightType === 'CIRCUIT') {
    category = 'circuit';
    lane = 'booked-out-top';
  } else if (fromIsBase && toIsBase) {
    category = 'local';
    lane = 'booked-out-top';
  } else if (fromIsBase) {
    category = 'landaway';
    lane = 'booked-out-top';
  } else if (toIsBase) {
    category = 'arrival';
    lane = 'booked-in';
  } else {
    category = 'overflight';
    lane = 'local';
  }
  if (isReturn) lane = 'booked-in';

  return {
    reg: booking.aircraft || booking.reg || '',
    callsign: booking.callsign || '',
    posn: booking.posn || '',
    from,
    to,
    type: booking.aircraftType || booking.aircraft_type || '',
    flightType: booking.type || '',
    category,
    pob: booking.pob || '',
    height: booking.height || '',
    heading: booking.heading || '',
    lane,
    etd: isReturn ? booking.returnETD || '' : booking.etd || '',
    eta: isReturn ? booking.returnETA || '' : booking.eta || '',
    atd: isReturn ? booking.returnATD || '' : booking.atd || '',
    ata: isReturn ? booking.returnATA || '' : booking.ata || '',
    onTime: isReturn ? booking.returnOnTime || '' : booking.onTime || '',
    offTime: isReturn ? booking.returnOffTime || '' : booking.offTime || '',
    notes: booking.name || booking.notes || '',
    rwy: Boolean(booking.rwy),
    q: Boolean(booking.q),
    fuel: Boolean(booking.fuel),
    lights: Boolean(booking.lights),
    ifr: Boolean(booking.ifr),
    revision: 0,
    updatedAt: Date.now(),
  };
}

function createBookingStripStates(booking) {
  return Object.fromEntries(getBookingLegs(booking).map(leg => (
    [leg, getBookingLegDetails(booking, leg)]
  )));
}

function ensureBookingStripStates() {
  let changed = false;
  const updatedBookings = bookings.map(booking => {
    const states = { ...(booking._skycommandStripStates || {}) };
    let bookingChanged = false;
    getBookingLegs(booking).forEach(leg => {
      if (!states[leg]) {
        states[leg] = getBookingLegDetails(booking, leg);
        bookingChanged = true;
      }
    });
    if (!bookingChanged) return booking;
    changed = true;
    return { ...booking, _skycommandStripStates: states };
  });
  if (changed) saveBookings(updatedBookings);
  return updatedBookings;
}

function exposeBooking(booking) {
  const { _skycommandStripStates, ...publicBooking } = booking;
  return publicBooking;
}

function normalizeBookingStripState(booking, leg, body, current) {
  const defaults = getBookingLegDetails(booking, leg);
  const state = {};
  BOOKING_STRIP_TEXT_FIELDS.forEach(field => {
    const value = body[field] !== undefined ? body[field] : current[field] !== undefined ? current[field] : defaults[field];
    state[field] = String(value === null ? '' : value).trim();
  });
  BOOKING_STRIP_BOOLEAN_FIELDS.forEach(field => {
    const value = body[field] !== undefined ? body[field] : current[field] !== undefined ? current[field] : defaults[field];
    state[field] = value === true || value === 'true';
  });
  if (!BOOKING_STRIP_CATEGORIES.has(state.category) || !BOOKING_STRIP_LANES.has(state.lane)) {
    throw new Error('Invalid booking strip category or lane');
  }
  return {
    ...state,
    revision: current.revision + 1,
    createdAt: current.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function findBookingCompletion(bookingId, leg = 'outbound') {
  const id = String(bookingId);
  const movement = movements.find(record => (
    String(record.bookingId) === id
    && (record.bookingLeg || 'outbound') === leg
  ));
  if (movement) return { kind: 'movement', record: movement };
  const overflight = overflights.find(record => (
    record.idempotencyKey === `booking:${id}:${leg}`
    || (leg === 'outbound' && record.idempotencyKey === `booking:${id}`)
  ));
  if (overflight) return { kind: 'overflight', record: overflight };
  return null;
}

function getCompletedBookingLegs(booking) {
  const legs = getBookingLegs(booking);
  const completedLegs = legs.filter(leg => findBookingCompletion(booking.id, leg));
  return booking.status === 'completed' && completedLegs.length === 0
    ? legs
    : completedLegs;
}

function hasCompletedBookingLeg(booking) {
  return getCompletedBookingLegs(booking).length > 0;
}

function isBookingCompleted(booking) {
  return getCompletedBookingLegs(booking).length === getBookingLegs(booking).length;
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
  let changed = false;
  const updatedBookings = bookings.map(booking => {
    if (isBookingCompleted(booking) && booking.status !== 'completed') {
      changed = true;
      return { ...booking, status: 'completed' };
    }
    return booking;
  });
  if (changed) {
    saveBookings(updatedBookings);
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
  const bookingsWithCompletedLegs = bookings.map(booking => {
    const completedLegs = getCompletedBookingLegs(booking);
    return {
      ...exposeBooking(booking),
      status: booking.status === 'completed' && completedLegs.length < getBookingLegs(booking).length
        ? 'approved'
        : booking.status,
      completedLegs,
    };
  });
  if (includeCancelled) {
    res.json(bookingsWithCompletedLegs.filter(booking => !isBookingCompleted(booking)));
  } else {
    res.json(bookingsWithCompletedLegs.filter(booking => (
      booking.status !== 'cancelled' && !isBookingCompleted(booking)
    )));
  }
});

app.get('/api/flight-booking-strips', (req, res) => {
  let bookingsWithStates;
  try {
    bookingsWithStates = ensureBookingStripStates();
  } catch (error) {
    console.error('Failed to initialize booking strip state:', error);
    return res.status(500).json({ error: 'Failed to load booking strip state' });
  }
  const states = bookingsWithStates.flatMap(booking => getBookingLegs(booking).map(leg => ({
    bookingId: String(booking.id),
    leg,
    ...booking._skycommandStripStates[leg],
  })));
  return res.json(states);
});

app.put('/api/flight-bookings/:id/strip-state/:leg', (req, res) => {
  const booking = bookings.find(item => String(item.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  const bookingId = String(booking.id);
  const leg = String(req.params.leg || '').toLowerCase();
  if (!getBookingLegs(booking).includes(leg)) {
    return res.status(400).json({ error: 'Invalid booking leg' });
  }
  if (booking.status === 'denied' || booking.status === 'cancelled'
      || isBookingCompleted(booking) || findBookingCompletion(bookingId, leg)) {
    return res.status(409).json({ error: 'Completed or inactive booking leg cannot be changed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const current = (booking._skycommandStripStates || {})[leg] || getBookingLegDetails(booking, leg);
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== current.revision) {
    return res.status(409).json({
      error: 'Booking strip changed on another workstation; reload before editing again',
      current: { bookingId, leg, ...current },
    });
  }

  let record;
  try {
    record = normalizeBookingStripState(booking, leg, body, current);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const updatedBooking = {
    ...booking,
    _skycommandStripStates: {
      ...(booking._skycommandStripStates || {}),
      [leg]: record,
    },
  };
  const updatedBookings = bookings.map(item => (
    String(item.id) === bookingId ? updatedBooking : item
  ));
  try {
    saveBookings(updatedBookings);
  } catch (error) {
    console.error(`Failed to save booking strip state ${bookingId}/${leg}:`, error);
    return res.status(500).json({ error: 'Failed to save booking strip state' });
  }

  if (wsBroadcast) wsBroadcast();
  return res.json({ bookingId, leg, ...record });
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
    ...req.body,
    id: nextId,
    date,
    status: req.body.status === 'completed' ? 'pending' : (req.body.status || 'pending'),
  };
  booking._skycommandStripStates = createBookingStripStates(booking);

  try {
    saveBookings(bookings.concat(booking));
  } catch (error) {
    console.error('Failed to save booking:', error);
    return res.status(500).json({ error: 'Failed to save booking' });
  }
  nextId += 1;
  if (wsBroadcast) wsBroadcast();
  res.json(exposeBooking(booking));
});

// Update booking status
app.post('/api/flight-bookings/:id/status', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  const { status } = req.body;

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  if (hasCompletedBookingLeg(booking)) {
    return res.status(409).json({ error: 'Completed booking cannot be changed' });
  }

  if (status !== 'approved' && status !== 'denied' && status !== 'cancelled') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  let updatedBookings = bookings.map(item => (
    String(item.id) === String(booking.id) ? { ...item, status } : item
  ));
  console.log(`[DEBUG] Booking ${booking.id} status set to ${status}`);

  // If cancelling a landaway, also cancel the return flight (match on aircraft, from/to swap, and date)
  if (status === 'cancelled' && booking.type && booking.type.toLowerCase() === 'landaway') {
    const returnFlight = updatedBookings.find(b => {
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
      updatedBookings = updatedBookings.map(item => (
        String(item.id) === String(returnFlight.id) ? { ...item, status: 'cancelled' } : item
      ));
      console.log(`[DEBUG] Return flight ${returnFlight.id} also set to cancelled.`);
    } else {
      console.log('[DEBUG] No matching return flight found for cancellation.');
    }
  }

  try {
    saveBookings(updatedBookings);
  } catch (error) {
    console.error(`Failed to save booking status for ${booking.id}:`, error);
    return res.status(500).json({ error: 'Failed to save booking status' });
  }
  if (wsBroadcast) wsBroadcast();
  res.json({
    message: 'Booking status updated',
    booking: exposeBooking(bookings.find(item => String(item.id) === String(booking.id))),
  });
});

app.post('/api/flight-bookings/:id/complete', (req, res) => {
  const booking = bookings.find(item => String(item.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  const bookingId = String(booking.id);
  const leg = String(req.query.leg || req.body.bookingLeg || 'outbound').toLowerCase();
  if (!getBookingLegs(booking).includes(leg)) {
    return res.status(400).json({ error: 'Invalid booking leg' });
  }

  let completion = findBookingCompletion(bookingId, leg);
  const duplicate = completion !== null;
  if (!completion && (booking.status === 'denied' || booking.status === 'cancelled')) {
    return res.status(409).json({ error: `Cannot complete a ${booking.status} booking` });
  }

  if (!completion && req.body.category === 'overflight') {
    try {
      const result = recordOverflight(req.body, `booking:${bookingId}:${leg}`);
      completion = { kind: 'overflight', record: result.entry };
    } catch (error) {
      console.error(`Failed to save overflight completion for booking ${bookingId} (${leg}):`, error);
      return res.status(500).json({ error: 'Failed to save overflight completion' });
    }
  } else if (!completion) {
    const movement = {
      ...req.body,
      bookingId,
      bookingLeg: leg,
      timestamp: Date.now(),
    };
    const updatedMovements = [...movements, movement];
    try {
      saveMovements(updatedMovements);
    } catch (error) {
      console.error(`Failed to save movement for booking ${bookingId} (${leg}):`, error);
      return res.status(500).json({ error: 'Failed to save movement' });
    }
    movements = updatedMovements;
    completion = { kind: 'movement', record: movement };
  }

  let completedBooking = booking;
  if (getBookingLegs(booking).every(bookingLeg => (
    bookingLeg === leg || findBookingCompletion(bookingId, bookingLeg)
  ))) {
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
    booking: exposeBooking(completedBooking),
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
  if (hasCompletedBookingLeg(booking)) {
    return res.status(409).json({ error: 'Completed booking cannot be changed' });
  }
  const updatedBookings = bookings.map(item => (
    String(item.id) === String(booking.id) ? { ...item, status: 'approved' } : item
  ));
  try {
    saveBookings(updatedBookings);
  } catch (error) {
    console.error(`Failed to approve booking ${booking.id}:`, error);
    return res.status(500).json({ error: 'Failed to save booking status' });
  }
  if (wsBroadcast) wsBroadcast();
  res.json(exposeBooking(bookings.find(item => String(item.id) === String(booking.id))));
});

// Reject booking
app.post('/api/flight-bookings/:id/reject', (req, res) => {
  const booking = bookings.find((b) => String(b.id) === String(req.params.id));
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (hasCompletedBookingLeg(booking)) {
    return res.status(409).json({ error: 'Completed booking cannot be changed' });
  }
  const updatedBookings = bookings.map(item => (
    String(item.id) === String(booking.id) ? { ...item, status: 'denied' } : item
  ));
  try {
    saveBookings(updatedBookings);
  } catch (error) {
    console.error(`Failed to deny booking ${booking.id}:`, error);
    return res.status(500).json({ error: 'Failed to save booking status' });
  }
  if (wsBroadcast) wsBroadcast();
  res.json(exposeBooking(bookings.find(item => String(item.id) === String(booking.id))));
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
