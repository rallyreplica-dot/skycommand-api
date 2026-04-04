// Run this script with: node post-booking.js
// It will send a test booking to your backend at http://localhost:3000/api/flight-bookings

const http = require('http');

const booking = {
  aircraft: 'GTEST',
  from: 'EGSX',
  to: 'EGSU',
  pob: '2',
  status: 'pending',
  date: (() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}${mm}${yy}`;
  })()
};

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
