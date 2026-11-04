const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const WebSocket = require('ws');

const PORT = 41001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function todayAsDDMMYY() {
  const date = new Date();
  return `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getFullYear()).slice(-2)}`;
}

function dateOffsetAsDDMMYY(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getFullYear()).slice(-2)}`;
}

async function request(pathname, body, method) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

async function cancelBooking(bookingId, journeyLeg) {
  return request(`/api/flight-bookings/${encodeURIComponent(bookingId)}/cancel`, {
    journeyLeg,
  });
}

async function createBooking(fields = {}) {
  const result = await request('/api/flight-bookings', {
    aircraft: 'GTEST',
    from: 'EGSX',
    to: 'EGSU',
    date: todayAsDDMMYY(),
    status: 'approved',
    ...fields,
  });
  assert.equal(result.response.status, 200);
  return result.data;
}

async function createPilot360Booking(fields) {
  const result = await request('/api/flight-bookings', {
    aircraft: fields.aircraft,
    callsign: fields.callsign,
    departure: fields.departure,
    arrival: fields.destination,
    from: fields.fromIcao,
    to: fields.toIcao,
    pob: fields.pob,
    type: 'LANDAWAY',
    etd: fields.etd,
    eta: fields.eta,
    date: fields.date,
    journeyId: fields.journeyId,
    journeyLeg: fields.journeyLeg,
  });
  assert.equal(result.response.status, 200);
  return result.data;
}

async function completeBooking(bookingId, leg, fields = {}) {
  return request(
    `/api/flight-bookings/${encodeURIComponent(bookingId)}/complete?leg=${encodeURIComponent(leg)}`,
    { category: 'landaway', reg: 'GTEST', from: 'EGSX', to: 'EGSU', ...fields }
  );
}

async function connectWebSocket() {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(socket, 'open');
  return socket;
}

function waitForUpdate(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket update')), 3000);
    socket.once('message', message => {
      clearTimeout(timer);
      resolve(String(message));
    });
  });
}

function blockFile(filePath) {
  const backupPath = `${filePath}.test-backup`;
  assert.equal(fs.existsSync(backupPath), false, 'test backup path must be unused');
  fs.renameSync(filePath, backupPath);
  fs.mkdirSync(filePath);
  let restored = false;
  return () => {
    if (restored) return;
    fs.rmdirSync(filePath);
    fs.renameSync(backupPath, filePath);
    restored = true;
  };
}

async function waitForServer(child, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited before becoming ready:\n${output()}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/flight-bookings`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for isolated server on port ${PORT}:\n${output()}`);
}

test('booking legs complete independently and persist safely on port 41001', async t => {
  assert.equal(BASE_URL, 'http://127.0.0.1:41001');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-phase2a-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  for (const filename of ['bookings-data.json', 'movements-log.json', 'overflights.json', 'manual-strips.json']) {
    fs.writeFileSync(path.join(dataDir, filename), '[]', 'utf8');
  }

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), SKYCOMMAND_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { serverOutput += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { serverOutput += chunk; });

  try {
    await waitForServer(child, () => serverOutput);
    await t.test('preserves individual Pilot360 bookings and idempotently completes them', async () => {
      const individual = await createBooking({ pilot360Reference: 'individual-preserved' });
      assert.equal(individual.pilot360Reference, 'individual-preserved');
      const completionStatusFromProducer = await createBooking({
        status: 'completed',
        returnDate: todayAsDDMMYY(),
      });
      assert.equal(completionStatusFromProducer.status, 'pending');
      assert.deepEqual(completionStatusFromProducer.completedLegs || [], []);

      const first = await completeBooking(individual.id, 'outbound');
      assert.equal(first.response.status, 200);
      assert.equal(first.data.duplicate, false);
      const retry = await completeBooking(individual.id, 'outbound');
      assert.equal(retry.response.status, 200);
      assert.equal(retry.data.duplicate, true);

      const movements = await request('/api/movements');
      assert.equal(movements.data.filter(record => String(record.bookingId) === String(individual.id)).length, 1);
      assert.equal(movements.data.find(record => String(record.bookingId) === String(individual.id)).bookingLeg, 'outbound');
    });

    await t.test('keeps separately posted outbound and return bookings independent', async () => {
      const outbound = await createBooking({ callsign: 'TESTOUT' });
      const returnFlight = await createBooking({
        aircraft: 'GTEST',
        callsign: 'TESTIN',
        from: 'EGSU',
        to: 'EGSX',
      });

      assert.notEqual(outbound.id, returnFlight.id);
      const returnDone = await completeBooking(returnFlight.id, 'outbound', {
        category: 'arrival',
        from: 'EGSU',
        to: 'EGSX',
      });
      assert.equal(returnDone.response.status, 200);
      const current = await request('/api/flight-bookings');
      assert.equal(current.data.some(booking => booking.id === outbound.id), true);
      assert.equal(current.data.some(booking => booking.id === returnFlight.id), false);

      const outboundDone = await completeBooking(outbound.id, 'outbound');
      assert.equal(outboundDone.response.status, 200);
      assert.equal((await request('/api/flight-bookings')).data.some(booking => (
        booking.id === outbound.id || booking.id === returnFlight.id
      )), false);
    });

    await t.test('completes legacy combined legs outbound-first and then return', async () => {
      const combined = await createBooking({
        returnDate: todayAsDDMMYY(),
        returnETD: '1500',
        returnETA: '1600',
        pilot360Extra: { retained: true },
      });
      const outbound = await completeBooking(combined.id, 'outbound');
      assert.equal(outbound.response.status, 200);
      assert.equal(outbound.data.booking.status, 'approved');

      let active = await request('/api/flight-bookings');
      let activeBooking = active.data.find(booking => booking.id === combined.id);
      assert.deepEqual(activeBooking.completedLegs, ['outbound']);
      assert.equal(activeBooking.pilot360Extra.retained, true);
      assert.equal((await request(`/api/flight-bookings/${combined.id}/status`, { status: 'denied' })).response.status, 409);

      const returnDone = await completeBooking(combined.id, 'return', {
        category: 'arrival',
        from: 'EGSU',
        to: 'EGSX',
      });
      assert.equal(returnDone.response.status, 200);
      assert.equal(returnDone.data.booking.status, 'completed');
      const retry = await completeBooking(combined.id, 'return', { category: 'arrival' });
      assert.equal(retry.data.duplicate, true);
      active = await request('/api/flight-bookings');
      assert.equal(active.data.some(booking => booking.id === combined.id), false);
    });

    await t.test('completes legacy combined legs return-first and records overflight legs separately', async () => {
      const combined = await createBooking({ returnDate: todayAsDDMMYY() });
      const returnDone = await completeBooking(combined.id, 'return', {
        category: 'overflight',
        from: 'EGSU',
        to: 'EGTR',
        onTime: '1010',
        offTime: '1020',
      });
      assert.equal(returnDone.response.status, 200);
      assert.equal(returnDone.data.kind, 'overflight');
      let active = await request('/api/flight-bookings');
      assert.deepEqual(active.data.find(booking => booking.id === combined.id).completedLegs, ['return']);

      const outboundDone = await completeBooking(combined.id, 'outbound', {
        category: 'overflight',
        from: 'EGSX',
        to: 'EGSU',
        onTime: '0910',
        offTime: '0920',
      });
      assert.equal(outboundDone.response.status, 200);
      assert.equal(outboundDone.data.kind, 'overflight');
      const retry = await completeBooking(combined.id, 'outbound', { category: 'overflight' });
      assert.equal(retry.data.duplicate, true);

      const overflights = await request('/api/overflights');
      const bookingRecords = overflights.data.filter(record => (
        record.idempotencyKey.startsWith(`booking:${combined.id}:`)
      ));
      assert.equal(bookingRecords.length, 2);
      assert.deepEqual(
        bookingRecords.map(record => record.idempotencyKey).sort(),
        [`booking:${combined.id}:outbound`, `booking:${combined.id}:return`].sort()
      );
      active = await request('/api/flight-bookings');
      assert.equal(active.data.some(booking => booking.id === combined.id), false);
    });

    await t.test('retains approval and denial behavior', async () => {
      const approval = await createBooking({ callsign: 'APPROVAL' });
      const approved = await request(`/api/flight-bookings/${approval.id}/status`, { status: 'approved' });
      assert.equal(approved.response.status, 200);
      assert.equal(approved.data.booking.status, 'approved');

      const denial = await createBooking({ callsign: 'DENIAL' });
      const denied = await request(`/api/flight-bookings/${denial.id}/status`, { status: 'denied' });
      assert.equal(denied.response.status, 200);
      assert.equal(denied.data.booking.status, 'denied');
    });

    await t.test('exposes cancelled bookings for local-cache reconciliation without cancelling a separate return', async () => {
      const returnDate = new Date();
      returnDate.setDate(returnDate.getDate() + 1);
      const returnDateString = `${String(returnDate.getDate()).padStart(2, '0')}${String(returnDate.getMonth() + 1).padStart(2, '0')}${String(returnDate.getFullYear()).slice(-2)}`;
      const outbound = await createBooking({
        aircraft: 'G-CANCEL',
        type: 'landaway',
        from: 'EGSX',
        to: 'EGSU',
        etd: '2200',
      });
      const returnFlight = await createBooking({
        aircraft: 'G-CANCEL',
        type: 'landaway',
        from: 'EGSU',
        to: 'EGSX',
        date: returnDateString,
        etd: '2200',
      });

      const cancelled = await request(`/api/flight-bookings/${outbound.id}/status`, {
        status: 'cancelled',
      });
      assert.equal(cancelled.response.status, 200);
      assert.equal(cancelled.data.booking.status, 'cancelled');

      const activeBookings = await request('/api/flight-bookings');
      assert.equal(activeBookings.data.some(booking => booking.id === outbound.id), false);
      assert.equal(activeBookings.data.some(booking => booking.id === returnFlight.id), true);

      const allBookings = await request('/api/flight-bookings?includeCancelled=true');
      assert.equal(
        allBookings.data.find(booking => booking.id === outbound.id).status,
        'cancelled'
      );
      assert.equal(
        allBookings.data.find(booking => booking.id === returnFlight.id).status,
        'approved'
      );
    });

    await t.test('cancels linked journey legs safely and preserves completed or unrelated flights', async () => {
      for (const [label, returnDate] of [
        ['same-day', todayAsDDMMYY()],
        ['later-date', dateOffsetAsDDMMYY(1)],
      ]) {
        const journeyId = `cancel-${label}-${Date.now()}`;
        const outbound = await createBooking({
          aircraft: 'G-LINK',
          callsign: `OUT-${label}`,
          type: 'landaway',
          date: todayAsDDMMYY(),
          from: 'EGSX',
          to: 'EGSU',
          etd: '2200',
          eta: '2300',
          journeyId,
          journeyLeg: 'outbound',
        });
        const returnFlight = await createBooking({
          aircraft: 'G-LINK',
          callsign: `RET-${label}`,
          type: 'landaway',
          date: returnDate,
          from: 'EGSU',
          to: 'EGSX',
          etd: '2300',
          eta: '0000',
          journeyId,
          journeyLeg: 'return',
        });

        const cancelled = await cancelBooking(outbound.id, 'outbound');
        assert.equal(cancelled.response.status, 200);
        assert.deepEqual(
          cancelled.data.cancelledBookings.map(item => item.booking.id).sort(),
          [outbound.id, returnFlight.id].sort()
        );
        assert.equal(cancelled.data.duplicate, false);

        const duplicate = await cancelBooking(outbound.id, 'outbound');
        assert.equal(duplicate.response.status, 200);
        assert.equal(duplicate.data.duplicate, true);
        assert.equal(
          duplicate.data.cancelledBookings.some(item => item.booking.id === returnFlight.id),
          true
        );
      }

      const returnOnlyJourneyId = `return-only-${Date.now()}`;
      const returnOnlyOutbound = await createBooking({
        aircraft: 'G-RETURN',
        journeyId: returnOnlyJourneyId,
        journeyLeg: 'outbound',
      });
      const returnOnly = await createBooking({
        aircraft: 'G-RETURN',
        from: 'EGSU',
        to: 'EGSX',
        date: dateOffsetAsDDMMYY(1),
        journeyId: returnOnlyJourneyId,
        journeyLeg: 'return',
      });
      const returnCancelled = await cancelBooking(returnOnly.id, 'return');
      assert.equal(returnCancelled.response.status, 200);
      const afterReturnCancellation = await request(
        '/api/flight-bookings?includeCancelled=true'
      );
      assert.equal(
        afterReturnCancellation.data.find(item => item.id === returnOnlyOutbound.id).status,
        'approved'
      );
      assert.equal(
        afterReturnCancellation.data.find(item => item.id === returnOnly.id).status,
        'cancelled'
      );

      const completedOutboundJourneyId = `completed-out-${Date.now()}`;
      const completedOutbound = await createBooking({
        aircraft: 'G-COMPLETE',
        journeyId: completedOutboundJourneyId,
        journeyLeg: 'outbound',
      });
      const completedOutboundReturn = await createBooking({
        aircraft: 'G-COMPLETE',
        from: 'EGSU',
        to: 'EGSX',
        date: dateOffsetAsDDMMYY(1),
        journeyId: completedOutboundJourneyId,
        journeyLeg: 'return',
      });
      const outboundMovement = await completeBooking(completedOutbound.id, 'outbound');
      assert.equal(outboundMovement.response.status, 200);
      const completedOutCancelReturn = await cancelBooking(
        completedOutboundReturn.id,
        'return'
      );
      assert.equal(completedOutCancelReturn.response.status, 200);
      assert.equal(
        completedOutCancelReturn.data.cancelledBookings.some(
          item => item.booking.id === completedOutbound.id
        ),
        false
      );
      const outboundRetry = await completeBooking(completedOutbound.id, 'outbound');
      assert.equal(outboundRetry.data.duplicate, true);
      const movementsAfterReturnCancel = await request('/api/movements');
      assert.equal(
        movementsAfterReturnCancel.data.filter(
          item => String(item.bookingId) === String(completedOutbound.id)
        ).length,
        1
      );

      const completedReturnJourneyId = `completed-return-${Date.now()}`;
      const pendingOutbound = await createBooking({
        aircraft: 'G-RETURN-COMPLETE',
        journeyId: completedReturnJourneyId,
        journeyLeg: 'outbound',
      });
      const completedReturn = await createBooking({
        aircraft: 'G-RETURN-COMPLETE',
        from: 'EGSU',
        to: 'EGSX',
        date: dateOffsetAsDDMMYY(1),
        journeyId: completedReturnJourneyId,
        journeyLeg: 'return',
      });
      const returnMovement = await completeBooking(completedReturn.id, 'outbound', {
        from: 'EGSU',
        to: 'EGSX',
      });
      assert.equal(returnMovement.response.status, 200);
      const outboundCancelled = await cancelBooking(pendingOutbound.id, 'outbound');
      assert.equal(outboundCancelled.response.status, 200);
      assert.equal(
        outboundCancelled.data.cancelledBookings.some(
          item => item.booking.id === completedReturn.id
        ),
        false
      );
      const returnRetry = await completeBooking(completedReturn.id, 'outbound', {
        from: 'EGSU',
        to: 'EGSX',
      });
      assert.equal(returnRetry.data.duplicate, true);
      const completedReturnCancel = await cancelBooking(completedReturn.id, 'return');
      assert.equal(completedReturnCancel.response.status, 409);

      const departedJourneyId = `departed-return-${Date.now()}`;
      const departedOutbound = await createBooking({
        aircraft: 'G-DEPARTED',
        journeyId: departedJourneyId,
        journeyLeg: 'outbound',
      });
      const departedReturn = await createBooking({
        aircraft: 'G-DEPARTED',
        from: 'EGSU',
        to: 'EGSX',
        date: dateOffsetAsDDMMYY(1),
        journeyId: departedJourneyId,
        journeyLeg: 'return',
      });
      const state = await request('/api/flight-booking-strips');
      const returnState = state.data.find(item => (
        item.bookingId === String(departedReturn.id) && item.leg === 'outbound'
      ));
      const departureSaved = await request(
        `/api/flight-bookings/${departedReturn.id}/strip-state/outbound`,
        { expectedRevision: returnState.revision, atd: '1015', lane: 'taxying-out' },
        'PUT'
      );
      assert.equal(departureSaved.response.status, 200);
      const cascadeWithDepartedReturn = await cancelBooking(
        departedOutbound.id,
        'outbound'
      );
      assert.equal(cascadeWithDepartedReturn.response.status, 200);
      assert.equal(
        cascadeWithDepartedReturn.data.cancelledBookings.some(
          item => item.booking.id === departedReturn.id
        ),
        false
      );
      const directDepartedCancel = await cancelBooking(departedReturn.id, 'return');
      assert.equal(directDepartedCancel.response.status, 409);

      const departedOutboundOnly = await createBooking({
        aircraft: 'G-OUT-DEPARTED',
        journeyId: `departed-out-${Date.now()}`,
        journeyLeg: 'outbound',
      });
      const outboundStates = await request('/api/flight-booking-strips');
      const outboundState = outboundStates.data.find(item => (
        item.bookingId === String(departedOutboundOnly.id) && item.leg === 'outbound'
      ));
      const outboundDepartureSaved = await request(
        `/api/flight-bookings/${departedOutboundOnly.id}/strip-state/outbound`,
        { expectedRevision: outboundState.revision, atd: '1045', lane: 'taxying-out' },
        'PUT'
      );
      assert.equal(outboundDepartureSaved.response.status, 200);
      const departedOutboundCancel = await cancelBooking(
        departedOutboundOnly.id,
        'outbound'
      );
      assert.equal(departedOutboundCancel.response.status, 409);

      const unrelatedOutbound = await createBooking({
        aircraft: 'G-UNRELATED',
        type: 'landaway',
        from: 'EGSX',
        to: 'EGSU',
        date: todayAsDDMMYY(),
      });
      const unrelatedReturn = await createBooking({
        aircraft: 'G-UNRELATED',
        type: 'landaway',
        from: 'EGSU',
        to: 'EGSX',
        date: todayAsDDMMYY(),
        etd: '2300',
      });
      const unrelatedCancel = await cancelBooking(unrelatedOutbound.id, 'outbound');
      assert.equal(unrelatedCancel.response.status, 200);
      const unrelatedBookings = await request('/api/flight-bookings');
      assert.equal(
        unrelatedBookings.data.some(item => item.id === unrelatedReturn.id),
        true
      );
      assert.equal(
        unrelatedBookings.data.find(item => item.id === unrelatedReturn.id).status,
        'approved'
      );

      const legacyCombined = await createBooking({
        aircraft: 'G-LEGACY',
        returnDate: dateOffsetAsDDMMYY(1),
        returnETD: '2300',
        returnETA: '0000',
      });
      const legacyReturnCancelled = await cancelBooking(legacyCombined.id, 'return');
      assert.equal(legacyReturnCancelled.response.status, 200);
      assert.deepEqual(legacyReturnCancelled.data.booking.cancelledLegs, ['return']);
      assert.equal(legacyReturnCancelled.data.booking.status, 'approved');
      const legacyVisible = await request('/api/flight-bookings');
      assert.equal(
        legacyVisible.data.some(booking => booking.id === legacyCombined.id),
        true
      );
      const legacyOutboundCancelled = await cancelBooking(legacyCombined.id, 'outbound');
      assert.equal(legacyOutboundCancelled.response.status, 200);
      assert.equal(legacyOutboundCancelled.data.booking.status, 'cancelled');

      const sameJourneyId = `duplicate-create-${Date.now()}`;
      const uniqueLeg = await createBooking({
        journeyId: sameJourneyId,
        journeyLeg: 'outbound',
      });
      const duplicateLeg = await request('/api/flight-bookings', {
        journeyId: sameJourneyId,
        journeyLeg: 'outbound',
        date: todayAsDDMMYY(),
      });
      assert.equal(uniqueLeg.journeyId, sameJourneyId);
      assert.equal(duplicateLeg.response.status, 409);
    });

    await t.test('persists Pilot360 POST linkage and cascades only to its linked return', async () => {
      const journeyId = `pilot360-payload-${Date.now()}`;
      const date = todayAsDDMMYY();
      const outbound = await createPilot360Booking({
        aircraft: 'G-PILOT',
        callsign: 'PILOT1',
        departure: 'EGSX',
        destination: 'EGSU',
        fromIcao: 'EGSX',
        toIcao: 'EGSU',
        pob: '2',
        etd: '2200',
        eta: '2300',
        date,
        journeyId,
        journeyLeg: 'outbound',
      });
      const returnFlight = await createPilot360Booking({
        aircraft: 'G-PILOT',
        callsign: 'PILOT1',
        departure: 'EGSU',
        destination: 'EGSX',
        fromIcao: 'EGSU',
        toIcao: 'EGSX',
        pob: '2',
        etd: '2300',
        eta: '0000',
        date: dateOffsetAsDDMMYY(1),
        journeyId,
        journeyLeg: 'return',
      });
      const unrelated = await createBooking({
        aircraft: 'G-PILOT',
        date,
        etd: '2200',
        eta: '2300',
        from: 'EGSX',
        to: 'EGSU',
      });

      const saved = await request('/api/flight-bookings?includeCancelled=true');
      const savedOutbound = saved.data.find(item => item.id === outbound.id);
      const savedReturn = saved.data.find(item => item.id === returnFlight.id);
      assert.equal(savedOutbound.journeyId, journeyId);
      assert.equal(savedOutbound.journeyLeg, 'outbound');
      assert.equal(savedReturn.journeyId, journeyId);
      assert.equal(savedReturn.journeyLeg, 'return');

      const cancelled = await cancelBooking(outbound.id, 'outbound');
      assert.equal(cancelled.response.status, 200);
      const afterCancellation = await request('/api/flight-bookings?includeCancelled=true');
      assert.equal(
        afterCancellation.data.find(item => item.id === outbound.id).status,
        'cancelled'
      );
      assert.equal(
        afterCancellation.data.find(item => item.id === returnFlight.id).status,
        'cancelled'
      );
      assert.equal(
        afterCancellation.data.find(item => item.id === unrelated.id).status,
        'approved'
      );
    });

    await t.test('persists per-leg strip state, broadcasts it, and rejects stale or completed-leg writes', async () => {
      const booking = await createBooking({
        returnDate: todayAsDDMMYY(),
        pilot360Field: 'unchanged',
      });
      assert.equal(Object.hasOwn(booking, '_skycommandStripStates'), false);

      const initialStates = await request('/api/flight-booking-strips');
      const outboundState = initialStates.data.find(state => (
        state.bookingId === String(booking.id) && state.leg === 'outbound'
      ));
      const returnState = initialStates.data.find(state => (
        state.bookingId === String(booking.id) && state.leg === 'return'
      ));
      assert.equal(outboundState.lane, 'booked-out-top');
      assert.equal(returnState.lane, 'booked-in');
      assert.equal(outboundState.revision, 0);

      const socketOne = await connectWebSocket();
      const socketTwo = await connectWebSocket();
      try {
        const updates = [waitForUpdate(socketOne), waitForUpdate(socketTwo)];
        const saved = await request(`/api/flight-bookings/${booking.id}/strip-state/outbound`, {
          expectedRevision: 0,
          lane: 'taxying-out',
          atd: '1020',
          ata: '1100',
          notes: 'Two-tab edit',
          rwy: true,
          q: true,
          fuel: true,
          lights: false,
          ifr: true,
        }, 'PUT');
        assert.equal(saved.response.status, 200);
        assert.equal(saved.data.revision, 1);
        assert.deepEqual(await Promise.all(updates), ['update', 'update']);

        const stale = await request(`/api/flight-bookings/${booking.id}/strip-state/outbound`, {
          expectedRevision: 0,
          lane: 'booked-in',
          notes: 'Stale client',
        }, 'PUT');
        assert.equal(stale.response.status, 409);
        assert.equal(stale.data.current.revision, 1);

        const loaded = await request('/api/flight-booking-strips');
        const persisted = loaded.data.find(state => (
          state.bookingId === String(booking.id) && state.leg === 'outbound'
        ));
        assert.equal(persisted.lane, 'taxying-out');
        assert.equal(persisted.atd, '1020');
        assert.equal(persisted.ata, '1100');
        assert.equal(persisted.notes, 'Two-tab edit');
        assert.equal(persisted.rwy, true);
        assert.equal(persisted.q, true);
        assert.equal(persisted.fuel, true);
        assert.equal(persisted.lights, false);
        assert.equal(persisted.ifr, true);

        const flightBookings = await request('/api/flight-bookings');
        const publicBooking = flightBookings.data.find(item => item.id === booking.id);
        assert.equal(publicBooking.pilot360Field, 'unchanged');
        assert.equal(Object.hasOwn(publicBooking, '_skycommandStripStates'), false);

        const complete = await completeBooking(booking.id, 'outbound');
        assert.equal(complete.response.status, 200);
        const staleCompleted = await request(`/api/flight-bookings/${booking.id}/strip-state/outbound`, {
          expectedRevision: 1,
          lane: 'booked-in',
        }, 'PUT');
        assert.equal(staleCompleted.response.status, 409);

        const returnEdit = await request(`/api/flight-bookings/${booking.id}/strip-state/return`, {
          expectedRevision: 0,
          lane: 'taxying-in',
          atd: '1410',
          notes: 'Return leg remains editable',
        }, 'PUT');
        assert.equal(returnEdit.response.status, 200);
        assert.equal(returnEdit.data.leg, 'return');
        const completedReturn = await completeBooking(booking.id, 'return', { category: 'arrival' });
        assert.equal(completedReturn.response.status, 200);
        assert.equal(completedReturn.data.booking.status, 'completed');
      } finally {
        socketOne.close();
        socketTwo.close();
      }
    });

    await t.test('returns errors on booking writes and retries a recorded movement without duplication', async () => {
      const statusBooking = await createBooking({ callsign: 'SAVEFAIL', status: 'pending' });
      let restore = blockFile(path.join(dataDir, 'bookings-data.json'));
      try {
        const statusFailure = await request(`/api/flight-bookings/${statusBooking.id}/status`, { status: 'approved' });
        assert.equal(statusFailure.response.status, 500);
      } finally {
        restore();
      }
      const unchanged = (await request('/api/flight-bookings')).data.find(booking => booking.id === statusBooking.id);
      assert.equal(unchanged.status, 'pending');

      restore = blockFile(path.join(dataDir, 'bookings-data.json'));
      try {
        const createFailure = await request('/api/flight-bookings', {
          aircraft: 'GTEST',
          from: 'EGSX',
          to: 'EGSU',
          date: todayAsDDMMYY(),
          pilot360Reference: 'must-not-be-saved',
        });
        assert.equal(createFailure.response.status, 500);
      } finally {
        restore();
      }
      assert.equal((await request('/api/flight-bookings')).data.some(booking => (
        booking.pilot360Reference === 'must-not-be-saved'
      )), false);

      const combined = await createBooking({ returnDate: todayAsDDMMYY(), callsign: 'RETRY' });
      const outbound = await completeBooking(combined.id, 'outbound');
      assert.equal(outbound.response.status, 200);

      restore = blockFile(path.join(dataDir, 'bookings-data.json'));
      try {
        const failedFinalSave = await completeBooking(combined.id, 'return', { category: 'arrival' });
        assert.equal(failedFinalSave.response.status, 500);
        assert.equal(failedFinalSave.data.recordSaved, true);
      } finally {
        restore();
      }

      const retry = await completeBooking(combined.id, 'return', { category: 'arrival' });
      assert.equal(retry.response.status, 200);
      assert.equal(retry.data.duplicate, true);
      assert.equal(retry.data.booking.status, 'completed');

      const movements = await request('/api/movements');
      assert.equal(movements.data.filter(record => String(record.bookingId) === String(combined.id)).length, 2);
    });

    await t.test('does not lose an overflight completion on a simulated overflight-store failure', async () => {
      const booking = await createBooking({ callsign: 'OVERFLIGHT-RETRY' });
      const restore = blockFile(path.join(dataDir, 'overflights.json'));
      try {
        const failed = await completeBooking(booking.id, 'outbound', {
          category: 'overflight',
          from: 'EGTR',
          to: 'EGSU',
        });
        assert.equal(failed.response.status, 500);
      } finally {
        restore();
      }

      const retry = await completeBooking(booking.id, 'outbound', {
        category: 'overflight',
        from: 'EGTR',
        to: 'EGSU',
      });
      assert.equal(retry.response.status, 200);
      assert.equal(retry.data.duplicate, false);
      const overflights = await request('/api/overflights');
      assert.equal(overflights.data.filter(record => record.idempotencyKey === `booking:${booking.id}:outbound`).length, 1);
    });
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
