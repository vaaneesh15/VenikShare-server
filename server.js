const express = require('express');
const { ExpressPeerServer } = require('peer');
const cors = require('cors');

const app = express();
// Обязательно использовать порт, который даст Render, или 443 по умолчанию
// Render сам назначает порт через переменную окружения process.env.PORT
const PORT = process.env.PORT || 443;

app.use(cors());

// Создаём HTTP-сервер на базе Express
const server = app.listen(PORT, () => {
  console.log(`PeerJS server is running on port ${PORT}`);
});

// Настраиваем PeerJS сервер
// Важно: path должен совпадать на клиенте и сервере
const peerServer = ExpressPeerServer(server, {
  path: '/',
  allow_discovery: true, // Разрешает клиентам "открывать" друг друга
});

// Подключаем PeerJS middleware по пути '/peerjs'
app.use('/peerjs', peerServer);

// (Опционально) Небольшой пинг, чтобы сервер на Render не "засыпал" [citation:1]
app.get('/ping', (req, res) => {
  res.send('pong!');
});

// Каждые 5 минут (300000 мс) сервер будет пинговать сам себя
setInterval(() => {
  // Используем localhost, так как это запрос внутри самого сервера
  fetch(`http://localhost:${PORT}/ping`, { method: 'GET' }).catch(err => console.log('Ping error:', err.message));
}, 300000);

// Логирование подключений и отключений (полезно для отладки)
peerServer.on('connection', (client) => {
  console.log('Client connected:', client.getId());
});

peerServer.on('disconnect', (client) => {
  console.log('Client disconnected:', client.getId());
});
