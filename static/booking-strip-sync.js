(function() {
    const textFields = [
        'reg', 'callsign', 'posn', 'from', 'to', 'type', 'flightType',
        'category', 'pob', 'height', 'heading', 'lane', 'etd', 'eta',
        'atd', 'ata', 'onTime', 'offTime', 'notes'
    ];
    const booleanFields = ['rwy', 'q', 'fuel', 'lights', 'ifr'];
    const categories = ['landaway', 'circuit', 'local', 'arrival', 'overflight'];
    const timers = new WeakMap();
    const queues = new WeakMap();
    const laneNames = new Set([
        'booked-out-top', 'taxying-in', 'taxying-out',
        'circuit-top', 'circuit-bottom', 'local', 'booked-in'
    ]);

    function bookingLegKey(bookingId, leg) {
        return JSON.stringify([String(bookingId), leg]);
    }

    function stripCategory(strip) {
        return Array.from(strip.classList).find(name => categories.includes(name)) || '';
    }

    function stripLane(strip) {
        const lane = strip.closest('.droppable[data-lane]');
        return lane ? lane.dataset.lane : '';
    }

    function serializeStrip(strip) {
        const leftInput = strip.querySelector('.quarter.bottom-left input');
        const rightInput = strip.querySelector('.quarter.bottom-right input');
        const checkboxes = strip.querySelectorAll('.strip-final-box input[type="checkbox"]');
        const etd = strip.querySelector('.quarter.top-left span')?.textContent?.trim() || '';
        const eta = strip.querySelector('.quarter.top-right span')?.textContent?.trim() || '';
        return {
            reg: strip.querySelector('.aircraft-reg')?.textContent?.trim() || '',
            callsign: strip.querySelector('.aircraft-callsign')?.textContent?.trim() || '',
            posn: strip.dataset.posn || '',
            from: strip.dataset.routeFrom || '',
            to: strip.dataset.routeTo || '',
            type: strip.querySelector('.aircraft-type')?.textContent?.trim() || '',
            flightType: strip.dataset.flightType || '',
            category: stripCategory(strip),
            pob: strip.querySelector('.final-booking')?.textContent?.trim() || '',
            height: strip.dataset.height || '',
            heading: strip.dataset.heading || '',
            lane: stripLane(strip),
            etd: ['ETD', 'X'].includes(etd.toUpperCase()) ? '' : etd,
            eta: ['ETA', 'X'].includes(eta.toUpperCase()) ? '' : eta,
            atd: strip.querySelector('input[placeholder="ATD"]')?.value || '',
            ata: strip.querySelector('input[placeholder="ATA"]')?.value || '',
            onTime: stripCategory(strip) === 'overflight' ? leftInput?.value || '' : '',
            offTime: stripCategory(strip) === 'overflight' ? rightInput?.value || '' : '',
            notes: strip.querySelector('.strip-notes')?.value || '',
            rwy: Boolean(checkboxes[0]?.checked),
            q: Boolean(checkboxes[1]?.checked),
            fuel: Boolean(strip.querySelector('.strip-fuel')?.checked),
            lights: Boolean(strip.querySelector('.strip-lights')?.checked),
            ifr: Boolean(strip.querySelector('.strip-ifr')?.checked),
        };
    }

    function stateMatches(strip, record) {
        const current = serializeStrip(strip);
        return textFields.concat(booleanFields).every(key => current[key] === record[key]);
    }

    function findLane(laneName) {
        if (!laneNames.has(laneName)) return null;
        return Array.from(document.querySelectorAll('.droppable[data-lane]'))
            .find(lane => lane.dataset.lane === laneName) || null;
    }

    function insertStrip(strip, lane) {
        let container = lane.querySelector('#flight-strip-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'flight-strip-container';
            const label = lane.querySelector('.lane-label');
            if (label) label.after(container);
            else lane.appendChild(container);
        }
        container.appendChild(strip);
    }

    function placeStrip(strip, laneName, fallbackLane) {
        const lane = findLane(laneName) || fallbackLane;
        if (!lane) {
            throw new Error(`Unknown Flight Board lane: ${laneName}`);
        }
        insertStrip(strip, lane);
    }

    function applyState(strip, record) {
        strip.dataset.bookingId = String(record.bookingId);
        strip.dataset.bookingLeg = record.leg;
        strip.dataset.bookingRevision = String(record.revision || 0);
        strip.dataset.serverPersisted = 'true';
        strip.dataset.registration = record.reg || '';
        strip.dataset.callsign = record.callsign || '';
        strip.dataset.posn = record.posn || '';
        strip.dataset.routeFrom = record.from || '';
        strip.dataset.routeTo = record.to || '';
        strip.dataset.flightType = record.flightType || '';
        strip.dataset.height = record.height || '';
        strip.dataset.heading = record.heading || '';

        const registration = strip.querySelector('.aircraft-reg');
        const callsign = strip.querySelector('.aircraft-callsign');
        const aircraftType = strip.querySelector('.aircraft-type');
        const pob = strip.querySelector('.final-booking');
        if (registration) registration.textContent = (record.reg || '').toUpperCase();
        if (callsign) callsign.textContent = (record.callsign || '').toUpperCase();
        if (aircraftType) aircraftType.textContent = record.type || '';
        if (pob) pob.textContent = String(record.pob || '').toUpperCase();

        const category = stripCategory(strip);
        const etd = strip.querySelector('.quarter.top-left span');
        const eta = strip.querySelector('.quarter.top-right span');
        if (etd) etd.textContent = category === 'arrival' ? 'X' : (record.etd || 'ETD');
        if (eta) eta.textContent = category === 'landaway' ? 'X' : (record.eta || 'ETA');
        if (!['circuit', 'local'].includes(category)) {
            const route = strip.querySelector('.strip-route-box .route-content > div:last-child');
            if (route) route.textContent = `${record.from || ''} - ${record.to || ''}`;
        }

        const leftInput = strip.querySelector('.quarter.bottom-left input');
        const rightInput = strip.querySelector('.quarter.bottom-right input');
        const atdInput = strip.querySelector('input[placeholder="ATD"]');
        const ataInput = strip.querySelector('input[placeholder="ATA"]');
        if (atdInput) atdInput.value = record.atd || '';
        if (ataInput) ataInput.value = record.ata || '';
        if (stripCategory(strip) === 'overflight') {
            if (leftInput) leftInput.value = record.onTime || '';
            if (rightInput) rightInput.value = record.offTime || '';
        }

        const notes = strip.querySelector('.strip-notes');
        if (notes) notes.value = record.notes || '';
        const checkboxes = strip.querySelectorAll('.strip-final-box input[type="checkbox"]');
        if (checkboxes[0]) checkboxes[0].checked = Boolean(record.rwy);
        if (checkboxes[1]) checkboxes[1].checked = Boolean(record.q);
        const fuel = strip.querySelector('.strip-fuel');
        const lights = strip.querySelector('.strip-lights');
        const ifr = strip.querySelector('.strip-ifr');
        if (fuel) fuel.checked = Boolean(record.fuel);
        if (lights) lights.checked = Boolean(record.lights);
        if (ifr) ifr.checked = Boolean(record.ifr);
    }

    function reportSaveError(strip, error, conflict = false) {
        strip.dataset.bookingSyncError = 'true';
        if (conflict) strip.dataset.bookingSyncBlocked = 'true';
        strip.title = `Not synchronized: ${error.message}`;
        console.error('[FlightBoard] Booking strip was not synchronized:', error);
        if (strip.dataset.bookingSyncAlerted !== 'true') {
            strip.dataset.bookingSyncAlerted = 'true';
            alert(conflict
                ? `This booking strip changed on another workstation. Your unsaved draft was not sent. Reload the board before editing again. ${error.message}`
                : `Booking strip changes were not synchronized. Your local edits remain on this board; retry by editing the strip. ${error.message}`);
        }
    }

    function attachPersistence(strip) {
        if (strip.dataset.bookingSyncAttached === 'true') return;
        strip.dataset.bookingSyncAttached = 'true';
        strip.dataset.serverPersisted = 'true';
        strip.addEventListener('input', () => scheduleSave(strip));
        strip.addEventListener('change', () => scheduleSave(strip, 0));
    }

    function persistStrip(strip) {
        if (strip.dataset.bookingSyncBlocked === 'true') {
            return Promise.reject(new Error('Reload the board to resolve this stale edit'));
        }
        const previous = queues.get(strip) || Promise.resolve();
        const request = previous.catch(() => {}).then(async () => {
            if (!strip.isConnected) return null;
            const record = serializeStrip(strip);
            const bookingId = strip.dataset.bookingId;
            const leg = strip.dataset.bookingLeg || 'outbound';
            const response = await fetch(
                `/api/flight-bookings/${encodeURIComponent(bookingId)}/strip-state/${encodeURIComponent(leg)}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...record,
                        expectedRevision: Number(strip.dataset.bookingRevision || 0),
                    }),
                }
            );
            const result = await response.json();
            if (!response.ok) {
                const error = new Error(result.error || `HTTP ${response.status}`);
                if (response.status === 409) reportSaveError(strip, error, true);
                throw error;
            }
            strip.dataset.bookingRevision = String(result.revision);
            if (stateMatches(strip, result)) {
                delete strip.dataset.bookingDirty;
                delete strip.dataset.bookingSyncError;
                delete strip.dataset.bookingSyncAlerted;
                strip.title = '';
            } else {
                scheduleSave(strip, 0);
            }
            return result;
        });
        queues.set(strip, request);
        request.then(
            () => {
                if (queues.get(strip) === request) queues.delete(strip);
            },
            () => {
                if (queues.get(strip) === request) queues.delete(strip);
            }
        );
        return request;
    }

    function scheduleSave(strip, delay = 250) {
        if (strip.dataset.bookingSyncBlocked === 'true') return;
        strip.dataset.bookingDirty = 'true';
        const previous = timers.get(strip);
        if (previous) clearTimeout(previous);
        const timer = setTimeout(() => {
            timers.delete(strip);
            persistStrip(strip).catch(error => {
                if (strip.dataset.bookingSyncBlocked !== 'true') reportSaveError(strip, error);
            });
        }, delay);
        timers.set(strip, timer);
    }

    async function flushSave(strip) {
        const timer = timers.get(strip);
        if (timer) {
            clearTimeout(timer);
            timers.delete(strip);
        }
        if (strip.dataset.bookingDirty !== 'true') return;
        return persistStrip(strip);
    }

    function bookingFields(booking, leg, state) {
        const get = (key, fallback) => state && state[key] !== undefined ? state[key] : fallback;
        const isReturn = leg === 'return';
        return {
            reg: get('reg', booking.aircraft || booking.reg || ''),
            callsign: get('callsign', booking.callsign || ''),
            posn: get('posn', booking.posn || ''),
            from: get('from', isReturn ? booking.to || booking.arrival || '' : booking.from || booking.departure || ''),
            to: get('to', isReturn ? booking.from || booking.departure || '' : booking.to || booking.arrival || ''),
            height: get('height', booking.height || ''),
            heading: get('heading', booking.heading || ''),
            pob: get('pob', booking.pob || ''),
            etd: get('etd', isReturn ? booking.returnETD || '' : booking.etd || ''),
            eta: get('eta', isReturn ? booking.returnETA || '' : booking.eta || ''),
            callsignType: get('flightType', booking.type || ''),
        };
    }

    function createStripForBooking(booking, leg, state) {
        const fields = bookingFields(booking, leg, state);
        const created = createFlightStrip({
            reg: fields.reg,
            callsign: fields.callsign,
            posn: fields.posn,
            from: fields.from,
            to: fields.to,
            height: fields.height,
            heading: fields.heading,
            pob: fields.pob,
            etd: fields.etd,
            eta: fields.eta,
            flightType: fields.callsignType,
            status: booking.status || 'pending',
            bookingId: booking.id,
            bookingLeg: leg,
        });
        created.strip.dataset.bookingStatus = booking.status || 'pending';
        return created;
    }

    function addApproveDeny(strip) {
        if (!strip._shouldPulse || strip.querySelector('[data-booking-actions]')) return;
        strip._addApproveDeny();
        if (strip.lastElementChild) strip.lastElementChild.dataset.bookingActions = 'true';
    }

    function sortLane(selector, earliestAtBottom) {
        const container = document.querySelector(`${selector} #flight-strip-container`);
        if (!container) return;
        const strips = Array.from(container.children);
        strips.sort((a, b) => {
            const etdA = a.querySelector('.quarter.top-left span')?.textContent || '';
            const etdB = b.querySelector('.quarter.top-left span')?.textContent || '';
            const mins = value => value.length === 4
                ? parseInt(value.slice(0, 2), 10) * 60 + parseInt(value.slice(2, 4), 10)
                : 9999;
            return earliestAtBottom ? mins(etdB) - mins(etdA) : mins(etdA) - mins(etdB);
        });
        strips.forEach(strip => container.appendChild(strip));
    }

    function reconcileBookingStrips(bookings, states, todayStr) {
        const stateByKey = new Map(states.map(state => [
            bookingLegKey(state.bookingId, state.leg),
            state,
        ]));
        const desired = new Map();
        bookings.forEach(booking => {
            if (booking.status === 'denied' || booking.status === 'cancelled' || booking.status === 'completed') return;
            const completedLegs = new Set(Array.isArray(booking.completedLegs) ? booking.completedLegs : []);
            if (booking.date === todayStr && !completedLegs.has('outbound')) {
                desired.set(bookingLegKey(booking.id, 'outbound'), { booking, leg: 'outbound' });
            }
            if (booking.returnDate === todayStr && !completedLegs.has('return')) {
                desired.set(bookingLegKey(booking.id, 'return'), { booking, leg: 'return' });
            }
        });

        const existing = new Map();
        document.querySelectorAll('.flight-strip[data-booking-id]').forEach(strip => {
            const key = bookingLegKey(strip.dataset.bookingId, strip.dataset.bookingLeg || 'outbound');
            const previous = existing.get(key);
            if (!previous) {
                existing.set(key, strip);
            } else {
                const previousScore = (previous.dataset.bookingDirty === 'true' ? 1000000 : 0)
                    + Number(previous.dataset.bookingRevision || 0);
                const stripScore = (strip.dataset.bookingDirty === 'true' ? 1000000 : 0)
                    + Number(strip.dataset.bookingRevision || 0);
                if (stripScore > previousScore) {
                    previous.remove();
                    existing.set(key, strip);
                } else {
                    strip.remove();
                }
            }
        });
        existing.forEach((strip, key) => {
            if (!desired.has(key) && strip.dataset.bookingCompletionPending !== 'true') strip.remove();
        });

        desired.forEach(({ booking, leg }, key) => {
            const state = stateByKey.get(key);
            if (!state) {
                console.error(`[FlightBoard] Server did not return state for booking leg ${key}`);
                return;
            }
            const current = existing.get(key);
            const defaultStrip = current && current.dataset.bookingStatus === (booking.status || 'pending')
                ? current
                : null;
            let strip = defaultStrip;
            let fallbackLane;
            if (defaultStrip) {
                fallbackLane = defaultStrip.closest('.droppable[data-lane]');
                const currentRevision = Number(defaultStrip.dataset.bookingRevision || 0);
                const hasLocalDraft = defaultStrip.dataset.bookingDirty === 'true';
                if (state.revision > currentRevision && !hasLocalDraft) {
                    applyState(defaultStrip, state);
                    delete defaultStrip.dataset.bookingSyncBlocked;
                    delete defaultStrip.dataset.bookingSyncError;
                    delete defaultStrip.dataset.bookingSyncAlerted;
                }
                if (!hasLocalDraft) placeStrip(defaultStrip, state.lane, fallbackLane);
                attachPersistence(defaultStrip);
                return;
            }

            if (current) current.remove();
            const created = createStripForBooking(booking, leg, state);
            strip = created.strip;
            fallbackLane = document.querySelector(created.laneSelector) || document.querySelector('.lane');
            applyState(strip, state);
            placeStrip(strip, state.lane, fallbackLane);
            attachPersistence(strip);
            addApproveDeny(strip);
        });
        sortLane('.lane-booked-out-top', true);
        sortLane('.lane-booked-in', false);
    }

    window.reconcileBookingStrips = reconcileBookingStrips;
    window.scheduleBookingStripSave = scheduleSave;
    window.persistBookingStripState = persistStrip;
    window.flushBookingStripState = flushSave;
})();
