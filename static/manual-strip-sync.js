(function() {
    const saveTimers = new WeakMap();
    const saveQueues = new WeakMap();
    let loadSequence = 0;

    const stateKeys = [
        'reg', 'callsign', 'posn', 'from', 'to', 'type', 'flightType',
        'category', 'status', 'pob', 'height', 'heading', 'lane',
        'etd', 'eta', 'atd', 'ata', 'onTime', 'offTime', 'notes',
        'rwy', 'q', 'fuel', 'lights', 'ifr'
    ];

    function createManualStripId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `manual-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    }

    function getStripCategory(strip) {
        return Array.from(strip.classList).find(name => (
            ['landaway', 'circuit', 'local', 'arrival', 'overflight'].includes(name)
        )) || '';
    }

    function getStripLane(strip) {
        const lane = strip.closest('.droppable[data-lane]');
        return lane ? lane.dataset.lane : strip.dataset.lane || '';
    }

    function serializeManualStrip(strip) {
        const leftInput = strip.querySelector('.quarter.bottom-left input');
        const rightInput = strip.querySelector('.quarter.bottom-right input');
        const checkboxes = strip.querySelectorAll('.strip-final-box input[type="checkbox"]');
        const etd = strip.querySelector('.quarter.top-left span')?.textContent?.trim() || '';
        const eta = strip.querySelector('.quarter.top-right span')?.textContent?.trim() || '';

        return {
            id: strip.dataset.manualId || '',
            reg: strip.querySelector('.aircraft-reg')?.textContent?.trim() || strip.dataset.registration || '',
            callsign: strip.dataset.callsign || strip.querySelector('.aircraft-callsign')?.textContent?.trim() || '',
            posn: strip.dataset.posn || '',
            from: strip.dataset.routeFrom || '',
            to: strip.dataset.routeTo || '',
            type: strip.querySelector('.aircraft-type')?.textContent?.trim() || '',
            flightType: strip.dataset.flightType || '',
            category: getStripCategory(strip),
            status: strip.dataset.manualStatus || 'active',
            pob: strip.querySelector('.final-booking')?.textContent?.trim() || '',
            height: strip.dataset.height || '',
            heading: strip.dataset.heading || '',
            lane: getStripLane(strip),
            etd: ['ETD', 'X'].includes(etd.toUpperCase()) ? '' : etd,
            eta: ['ETA', 'X'].includes(eta.toUpperCase()) ? '' : eta,
            atd: strip.querySelector('input[placeholder="ATD"]')?.value || leftInput?.value || '',
            ata: strip.querySelector('input[placeholder="ATA"]')?.value || rightInput?.value || '',
            onTime: getStripCategory(strip) === 'overflight' ? leftInput?.value || '' : '',
            offTime: getStripCategory(strip) === 'overflight' ? rightInput?.value || '' : '',
            notes: strip.querySelector('.strip-notes')?.value || '',
            rwy: Boolean(checkboxes[0]?.checked),
            q: Boolean(checkboxes[1]?.checked),
            fuel: Boolean(strip.querySelector('.strip-fuel')?.checked),
            lights: Boolean(strip.querySelector('.strip-lights')?.checked),
            ifr: Boolean(strip.querySelector('.strip-ifr')?.checked),
        };
    }

    function manualStripStateMatches(strip, record) {
        const current = serializeManualStrip(strip);
        return stateKeys.every(key => current[key] === record[key]);
    }

    function findLane(laneName) {
        return Array.from(document.querySelectorAll('.droppable[data-lane]'))
            .find(lane => lane.dataset.lane === laneName) || null;
    }

    function insertStripIntoLane(strip, lane) {
        let container = lane.querySelector('#flight-strip-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'flight-strip-container';
            const label = lane.querySelector('.lane-label');
            if (label) {
                label.after(container);
            } else {
                lane.appendChild(container);
            }
        }
        container.appendChild(strip);
    }

    function reportSaveError(strip, error) {
        strip.dataset.syncError = 'true';
        strip.title = `Not synchronized: ${error.message}`;
        console.error('[FlightBoard] Manual strip was not synchronized:', error);
        if (strip.dataset.syncAlerted !== 'true') {
            strip.dataset.syncAlerted = 'true';
            alert(`Manual strip was not synchronized. It remains on this board; retry by editing or moving it. ${error.message}`);
        }
    }

    function persistManualStripState(strip) {
        const record = serializeManualStrip(strip);
        if (!record.id) return Promise.reject(new Error('Manual strip ID is missing'));
        const previous = saveQueues.get(strip) || Promise.resolve();
        const request = previous.catch(() => {}).then(async () => {
            const response = await fetch(`/api/manual-strips/${encodeURIComponent(record.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            strip.dataset.serverPersisted = 'true';
            delete strip.dataset.syncError;
            delete strip.dataset.syncAlerted;
            strip.title = '';
            return result;
        });
        saveQueues.set(strip, request);
        request.then(
            () => {
                if (saveQueues.get(strip) === request) saveQueues.delete(strip);
            },
            () => {
                if (saveQueues.get(strip) === request) saveQueues.delete(strip);
            }
        );
        return request;
    }

    function scheduleManualStripSave(strip, delay = 250) {
        const previous = saveTimers.get(strip);
        if (previous) clearTimeout(previous);
        const timer = setTimeout(() => {
            saveTimers.delete(strip);
            persistManualStripState(strip).catch(error => reportSaveError(strip, error));
        }, delay);
        saveTimers.set(strip, timer);
    }

    function attachManualStripPersistence(strip) {
        if (strip.dataset.manualSyncAttached === 'true') return;
        strip.dataset.manualSyncAttached = 'true';
        strip.addEventListener('input', () => scheduleManualStripSave(strip));
        strip.addEventListener('change', () => scheduleManualStripSave(strip, 0));
    }

    async function addManualStrip(strip, lane) {
        strip.setAttribute('data-manual', '1');
        strip.dataset.manualId = createManualStripId();
        strip.dataset.serverPersisted = 'false';
        strip.dataset.manualStatus = 'active';
        strip.id = `manualStrip-${strip.dataset.manualId}`;
        insertStripIntoLane(strip, lane);
        attachManualStripPersistence(strip);
        if (typeof window.attachManualListeners === 'function') {
            window.attachManualListeners();
        }

        try {
            await persistManualStripState(strip);
            return true;
        } catch (error) {
            reportSaveError(strip, error);
            return false;
        }
    }

    function createManualStripFromRecord(record) {
        const flightType = record.flightType || (record.category === 'circuit' ? 'CIRCUIT' : '');
        const created = createFlightStrip({
            reg: record.reg,
            callsign: record.callsign,
            posn: record.posn,
            from: record.from,
            to: record.to,
            height: record.height,
            heading: record.heading,
            pob: record.pob,
            etd: record.etd,
            eta: record.eta,
            flightType,
            status: 'manual',
            bookingId: null,
        });
        const strip = created.strip;
        strip.setAttribute('data-manual', '1');
        strip.dataset.manualId = record.id;
        strip.dataset.serverPersisted = 'true';
        strip.dataset.manualStatus = record.status || 'active';
        strip.dataset.posn = record.posn || '';
        strip.dataset.flightType = record.flightType || '';
        strip.id = `manualStrip-${record.id}`;
        if (record.type) strip.querySelector('.aircraft-type').textContent = record.type;
        strip.dataset.registration = record.reg || '';
        strip.dataset.callsign = record.callsign || '';
        strip.dataset.routeFrom = record.from || '';
        strip.dataset.routeTo = record.to || '';
        strip.dataset.height = record.height || '';
        strip.dataset.heading = record.heading || '';

        const leftInput = strip.querySelector('.quarter.bottom-left input');
        const rightInput = strip.querySelector('.quarter.bottom-right input');
        const atdInput = strip.querySelector('input[placeholder="ATD"]') || leftInput;
        const ataInput = strip.querySelector('input[placeholder="ATA"]') || rightInput;
        if (atdInput) atdInput.value = record.atd || '';
        if (ataInput) ataInput.value = record.ata || '';
        if (record.category === 'overflight') {
            if (leftInput) leftInput.value = record.onTime || record.atd || '';
            if (rightInput) rightInput.value = record.offTime || record.ata || '';
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
        return strip;
    }

    function reconcileManualStrips(records) {
        const serverIds = new Set(records.map(record => record.id));
        document.querySelectorAll('.flight-strip[data-manual][data-manual-id]').forEach(strip => {
            if (strip.dataset.serverPersisted === 'true'
                && !serverIds.has(strip.dataset.manualId)
                && strip.dataset.manualCompletionPending !== 'true') {
                strip.remove();
            }
        });

        records.forEach(record => {
            let existing = Array.from(document.querySelectorAll('.flight-strip[data-manual][data-manual-id]'))
                .find(strip => strip.dataset.manualId === record.id);
            if (existing && manualStripStateMatches(existing, record)) {
                existing.dataset.serverPersisted = 'true';
                attachManualStripPersistence(existing);
                return;
            }

            const lane = findLane(record.lane);
            if (!lane) {
                console.error(`[FlightBoard] Saved manual strip ${record.id} references unknown lane ${record.lane}`);
                return;
            }
            const strip = createManualStripFromRecord(record);
            if (existing) existing.remove();
            insertStripIntoLane(strip, lane);
            attachManualStripPersistence(strip);
            if (typeof window.attachManualListeners === 'function') {
                window.attachManualListeners();
            }
        });
    }

    async function loadManualStripsFromAPI() {
        const sequence = ++loadSequence;
        try {
            const response = await fetch('/api/manual-strips');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const records = await response.json();
            if (!Array.isArray(records)) throw new Error('Expected an array of manual strips');
            if (sequence !== loadSequence) return;
            reconcileManualStrips(records);
        } catch (error) {
            console.error('Failed to load manual strips:', error);
        }
    }

    async function completeManualStrip(strip) {
        if (strip.dataset.manualCompletionPending === 'true') return;
        const timer = saveTimers.get(strip);
        if (timer) {
            clearTimeout(timer);
            saveTimers.delete(strip);
        }
        strip.dataset.manualCompletionPending = 'true';
        try {
            await persistManualStripState(strip);
            const id = strip.dataset.manualId;
            const response = await fetch(`/api/manual-strips/${encodeURIComponent(id)}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serializeManualStrip(strip)),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

            if (result.kind === 'movement') {
                try {
                    const log = JSON.parse(localStorage.getItem('movementsLog') || '[]');
                    log.push(result.record);
                    localStorage.setItem('movementsLog', JSON.stringify(log));
                } catch (error) {
                    console.error('[FlightBoard] Movement saved but local history could not be updated:', error);
                }
            }
            strip.remove();
            return result;
        } catch (error) {
            delete strip.dataset.manualCompletionPending;
            reportSaveError(strip, error);
            await loadManualStripsFromAPI();
            throw error;
        }
    }

    window.loadManualStripsFromAPI = loadManualStripsFromAPI;
    window.addManualStrip = addManualStrip;
    window.persistManualStripState = persistManualStripState;
    window.completeManualStrip = completeManualStrip;
    window.scheduleManualStripSave = scheduleManualStripSave;
})();
