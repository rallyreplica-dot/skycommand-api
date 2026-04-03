// Run this script with: node post-both-bookings.js
// It will send two bookings: outbound (pending) and inbound (landaway)

const http = require('http');

const today = (() => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
})();

const bookings = [
  {
    aircraft: 'GGUAR',
    from: 'EGSX',
    to: 'EGSU',
    pob: '2',
    status: 'pending',
    date: today
  },
  {
    aircraft: 'GGUAR',
    from: 'EGSU',
    to: 'EGSX',
    pob: '2',
    status: 'LANDAWAY',
    date: today
  }
];

function postBooking(booking) {
  const data = JSON.stringify(booking);
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/flight-bookings',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };
  const req = http.request(options, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      console.log('Response:', body);
    });
  });
  req.on('error', error => {
    console.error('Error:', error);
  });
  req.write(data);
  req.end();
}

bookings.forEach(postBooking);
