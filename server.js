const express = require('express');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 443;

app.use(cors());

const server = app.listen(PORT, () => {
  console.log(`✅ PeerJS сервер запущен на порту ${PORT}`);
});

const peerServer = ExpressPeerServer(server, {
  allow_discovery: true,
});

app.use('/', peerServer);

app.get('/ping', (req, res) => {
  res.send('pong');
});

peerServer.on('connection', (client) => {
  console.log('🔗 Клиент подключился:', client.getId());
});

peerServer.on('disconnect', (client) => {
  console.log('🔌 Клиент отключился:', client.getId());
});

setInterval(() => {
  fetch(`http://localhost:${PORT}/ping`).catch(err => console.log('Ping error:', err.message));
}, 300000);
