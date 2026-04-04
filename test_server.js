// Minimal Node.js server test
const http = require('http');

const server = http.createServer((req, res) => {
  res.end('Server is running!');
});

const PORT = 3005;
server.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
