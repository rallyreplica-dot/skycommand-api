// Store and restore manual strip times in localStorage
(function() {
    // Helper to get all manual strips and their times
    function getStripKey(strip) {
        // Only use manualId for true manual strips (no bookingId, has data-manual)
        if (strip.hasAttribute('data-manual') && !strip.dataset.bookingId && strip.dataset.manualId) {
            return 'manual-' + strip.dataset.manualId;
        }
        // For all booked strips (with bookingId), use booking-XX-category
        if (strip.dataset.bookingId) {
            let cat = '';
            if (strip.classList.contains('circuit')) cat = 'circuit';
            else if (strip.classList.contains('landaway')) cat = 'landaway';
            else if (strip.classList.contains('arrival')) cat = 'arrival';
            else if (strip.classList.contains('overflight')) cat = 'overflight';
            else if (strip.classList.contains('local')) cat = 'local';
            return 'booking-' + strip.dataset.bookingId + '-' + cat;
        }
        return 'dom-' + (strip.id || 'unknown');
    }
        // Track last focused input and its selection
        let lastFocusedInput = null;
        let lastSelectionStart = null;
        let lastSelectionEnd = null;
    // Debounce save to avoid excessive writes
    let saveTimeout = null;
    function saveManualStripTimes() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const data = [];
            const allKeys = [];
            document.querySelectorAll('.flight-strip').forEach(strip => {
                const id = getStripKey(strip);
                allKeys.push(id);
                // console.log('[manual-strip-times] getStripKey:', id, 'dataset:', JSON.stringify(strip.dataset), 'classList:', Array.from(strip.classList));
                if (!id) return;
                let left = strip.querySelector('.quarter.bottom-left input')?.value || '';
                let right = strip.querySelector('.quarter.bottom-right input')?.value || '';
                left = left.replace(/:/g, '');
                right = right.replace(/:/g, '');
                data.push({id, left, right});
            });
            // console.log('[manual-strip-times] Saving ALL strip times:', JSON.stringify(data));
            // console.log('[manual-strip-times] Current strip keys:', allKeys);
            localStorage.setItem('manualStripTimes', JSON.stringify(data));
        }, 150); // 150ms debounce
    }
    // Helper to restore times
    function restoreManualStripTimes() {
        let data = [];
        try { data = JSON.parse(localStorage.getItem('manualStripTimes') || '[]'); } catch {}
        // console.log('[manual-strip-times] Restoring ALL strip times:', JSON.stringify(data));
        // const allCurrentKeys = Array.from(document.querySelectorAll('.flight-strip')).map(getStripKey);
        // console.log('[manual-strip-times] All current strip keys before restore:', allCurrentKeys);
        data.forEach(({id, left, right}) => {
            // Try to match by manualId, bookingId+category, or DOM id
            let strip = null;
            if (id.startsWith('manual-')) {
                const mid = id.replace('manual-', '');
                strip = document.querySelector(`.flight-strip[data-manual][data-manual-id="${mid}"]`);
            } else if (id.startsWith('booking-')) {
                // booking-<id>-<cat>
                const match = id.match(/^booking-(.+?)-(circuit|landaway|arrival|overflight|local)$/);
                if (match) {
                    const bid = match[1];
                    const cat = match[2];
                    strip = Array.from(document.querySelectorAll('.flight-strip[data-booking-id]')).find(s => s.dataset.bookingId === bid && s.classList.contains(cat));
                }
            } else if (id.startsWith('dom-')) {
                const domid = id.replace('dom-', '');
                strip = document.getElementById(domid);
            }
            if (strip) {
                const l = strip.querySelector('.quarter.bottom-left input');
                const r = strip.querySelector('.quarter.bottom-right input');
                if (l) {
                    l.value = (left || '').replace(/:/g, '');
                    l.dispatchEvent(new Event('input', {bubbles:true}));
                }
                if (r) {
                    r.value = (right || '').replace(/:/g, '');
                    r.dispatchEvent(new Event('input', {bubbles:true}));
                }
            }
        });
        // After restoring, if user was editing a time input, try to restore focus and selection
        setTimeout(() => {
            if (lastFocusedInput && document.body.contains(lastFocusedInput)) {
                lastFocusedInput.focus();
                if (lastSelectionStart !== null && lastSelectionEnd !== null) {
                    lastFocusedInput.setSelectionRange(lastSelectionStart, lastSelectionEnd);
                }
            }
        }, 30);
        setTimeout(saveManualStripTimes, 10);
    }
    // Assign a unique id to each manual strip
    function assignManualId(strip) {
        // Only assign manualId if it's a true manual strip (has data-manual, no bookingId)
        if (strip.hasAttribute('data-manual') && !strip.dataset.bookingId && !strip.dataset.manualId) {
            strip.dataset.manualId = 'mstrip-' + Math.random().toString(36).substr(2, 9);
        }
    }
    // Attach listeners for all manual strips (after submit and after polling)
    function attachManualListeners() {
        document.querySelectorAll('.flight-strip').forEach(strip => {
            assignManualId(strip);
            // Extra debug for circuit/white strips
            if (strip.classList.contains('circuit')) {
                console.log('[manual-strip-times][DEBUG] Found circuit strip:', getStripKey(strip), 'dataset:', JSON.stringify(strip.dataset), 'classList:', Array.from(strip.classList));
            }
        });
        document.querySelectorAll('.flight-strip .quarter.bottom-left input, .flight-strip .quarter.bottom-right input')
            .forEach(input => {
                if (!input._manualListenerAttached) {
                    input.addEventListener('input', saveManualStripTimes);
                    input.addEventListener('change', saveManualStripTimes);
                    input.addEventListener('focus', function(e) {
                        lastFocusedInput = e.target;
                        lastSelectionStart = e.target.selectionStart;
                        lastSelectionEnd = e.target.selectionEnd;
                    });
                    input.addEventListener('blur', function() {
                        lastFocusedInput = null;
                        lastSelectionStart = null;
                        lastSelectionEnd = null;
                    });
                    input.addEventListener('dblclick', function() {
                        setTimeout(() => {
                            input.dispatchEvent(new Event('input', {bubbles:true}));
                            input.dispatchEvent(new Event('change', {bubbles:true}));
                        }, 60);
                    });
                    input._manualListenerAttached = true;
                }
                // Extra debug for circuit/white input
                const parentStrip = input.closest('.flight-strip');
                if (parentStrip && parentStrip.classList.contains('circuit')) {
                    console.log('[manual-strip-times][DEBUG] Attaching listeners to circuit input:', getStripKey(parentStrip), 'input:', input);
                }
            });
        saveManualStripTimes();
    }
    // On submit, attach listeners
    document.getElementById('submitBtn').addEventListener('click', function() {
        setTimeout(attachManualListeners, 100);
    });
    // Expose globally for manual call after new strip
    if (typeof window !== 'undefined') {
        window.attachManualListeners = attachManualListeners;
        window.restoreManualStripTimes = restoreManualStripTimes;
    }
    // After polling, attach listeners
    setInterval(() => setTimeout(attachManualListeners, 250), 1200);
    // Do NOT restore times on a timer! Only restore on page load and after polling.
    // On DOMContentLoaded, restore times
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(restoreManualStripTimes, 500);
    });
})();
