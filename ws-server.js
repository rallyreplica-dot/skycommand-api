// WebSocket server for real-time flight board updates
const WebSocket = require('ws');

let sockets = [];
function attachWebSocketServer(server) {
  const wss = new WebSocket.Server({ server });
  wss.on('connection', function connection(ws) {
    sockets.push(ws);
    ws.on('close', () => {
      sockets = sockets.filter(s => s !== ws);
    });
    ws.on('error', () => {
      sockets = sockets.filter(s => s !== ws);
    });
  });
  // Attach broadcast function to the exported function
  attachWebSocketServer.broadcastUpdate = function broadcastUpdate() {
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('update');
      }
    });
  };
}

module.exports = { attachWebSocketServer };
