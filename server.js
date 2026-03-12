const express = require('express');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 443;

app.use(cors());
app.use(express.json()); // для парсинга JSON тела запросов

// Хранилище активных комнат: { roomId: { password, createdAt } }
const rooms = new Map();

// Очистка старых комнат раз в час (можно и чаще)
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of rooms.entries()) {
    if (now - data.createdAt > 24 * 60 * 60 * 1000) { // 24 часа
      rooms.delete(id);
      console.log(`🗑️ Комната ${id} удалена (истек срок)`);
    }
  }
}, 60 * 60 * 1000); // 1 час

// --- API для комнат ---

// Создание комнаты
app.post('/api/rooms', (req, res) => {
  const { roomId, password } = req.body;
  if (!roomId || !password) {
    return res.status(400).json({ error: 'roomId and password required' });
  }
  // Проверка длины и символов (можно дополнительно)
  if (roomId.length < 1 || roomId.length > 10 || !/^[a-zA-Z0-9]+$/.test(roomId)) {
    return res.status(400).json({ error: 'roomId must be 1-10 alphanumeric characters' });
  }
  if (rooms.has(roomId)) {
    return res.status(409).json({ error: 'roomId already taken' });
  }
  rooms.set(roomId, { password, createdAt: Date.now() });
  console.log(`✅ Комната создана: ${roomId}`);
  res.json({ success: true });
});

// Проверка комнаты перед подключением
app.post('/api/rooms/check', (req, res) => {
  const { roomId, password } = req.body;
  if (!roomId || !password) {
    return res.status(400).json({ error: 'roomId and password required' });
  }
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: 'room not found' });
  }
  // Проверка срока действия (на всякий случай)
  if (Date.now() - room.createdAt > 24 * 60 * 60 * 1000) {
    rooms.delete(roomId);
    return res.status(410).json({ error: 'room expired' });
  }
  if (room.password !== password) {
    return res.status(401).json({ error: 'invalid password' });
  }
  res.json({ success: true });
});

// --- PeerJS сервер (как и раньше) ---
const server = app.listen(PORT, () => {
  console.log(`✅ VenikShare сервер запущен на порту ${PORT}`);
});

const peerServer = ExpressPeerServer(server, {
  allow_discovery: true,
});

app.use('/', peerServer);

// Опционально: пинг для предотвращения засыпания
app.get('/ping', (req, res) => {
  res.send('pong');
});

peerServer.on('connection', (client) => {
  console.log('🔗 Клиент подключился к PeerJS:', client.getId());
});

peerServer.on('disconnect', (client) => {
  console.log('🔌 Клиент отключился от PeerJS:', client.getId());
});

// Держим бесплатный таймер активным (пинг каждые 5 минут)
setInterval(() => {
  fetch(`http://localhost:${PORT}/ping`).catch(err => console.log('Ping error:', err.message));
}, 300000);
