const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');

const PORT = 41001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function todayAsDDMMYY() {
  const date = new Date();
  return `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getFullYear()).slice(-2)}`;
}

async function request(pathname, body) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, data: await response.json() };
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

async function completeBooking(bookingId, leg, fields = {}) {
  return request(
    `/api/flight-bookings/${encodeURIComponent(bookingId)}/complete?leg=${encodeURIComponent(leg)}`,
    { category: 'landaway', reg: 'GTEST', from: 'EGSX', to: 'EGSU', ...fields }
  );
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
