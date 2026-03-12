const express = require('express');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 443;

// Разрешаем все CORS-запросы
app.use(cors());

// Создаём HTTP-сервер
const server = app.listen(PORT, () => {
  console.log(`✅ PeerJS сервер запущен на порту ${PORT}`);
});

// Настраиваем PeerJS сервер на корневом пути
const peerServer = ExpressPeerServer(server, {
  allow_discovery: true, // разрешаем клиентам находить друг друга
});

// Монтируем PeerJS на корень (важно!)
app.use('/', peerServer);

// (Необязательно) Проверка, что сервер жив
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Логируем подключения
peerServer.on('connection', (client) => {
  console.log('🔗 Клиент подключился:', client.getId());
});

peerServer.on('disconnect', (client) => {
  console.log('🔌 Клиент отключился:', client.getId());
});

// Держим бесплатный таймер активным (пинг каждые 5 минут)
setInterval(() => {
  fetch(`http://localhost:${PORT}/ping`).catch(err => console.log('Ping error:', err.message));
}, 300000);
