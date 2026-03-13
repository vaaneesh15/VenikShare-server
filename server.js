const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // в проде лучше указать конкретный домен клиента
    methods: ['GET', 'POST']
  }
});

// Подключение к PostgreSQL через переменную окружения
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Создание таблиц при запуске
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id VARCHAR(50) PRIMARY KEY,
      last_active TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE CASCADE,
      sender VARCHAR(100) NOT NULL,
      text TEXT NOT NULL,
      timestamp TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_users (
      room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE CASCADE,
      username VARCHAR(100) NOT NULL,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, username)
    )
  `);
  console.log('Database initialized');
}
initDB().catch(console.error);

// Хранилище активных пользователей в памяти
const activeUsers = new Map(); // roomId -> Set of usernames

// Очистка неактивных комнат (72 часа)
setInterval(async () => {
  try {
    const result = await pool.query(
      `DELETE FROM rooms WHERE last_active < NOW() - INTERVAL '72 hours' RETURNING id`
    );
    if (result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} inactive rooms`);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}, 60 * 60 * 1000);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createRoom', async ({ roomId }) => {
    try {
      const existing = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
      if (existing.rows.length > 0) {
        socket.emit('roomError', { message: 'Комната с таким ID уже существует' });
        return;
      }
      await pool.query('INSERT INTO rooms (id, last_active) VALUES ($1, NOW())', [roomId]);
      socket.emit('roomCreated', { roomId });
    } catch (err) {
      console.error(err);
      socket.emit('roomError', { message: 'Ошибка сервера' });
    }
  });

  socket.on('joinRoom', async ({ roomId, username }) => {
    try {
      const room = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
      if (room.rows.length === 0) {
        socket.emit('roomError', { message: 'Комната не существует' });
        return;
      }
      await pool.query('UPDATE rooms SET last_active = NOW() WHERE id = $1', [roomId]);

      await pool.query(
        'INSERT INTO room_users (room_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [roomId, username]
      );

      if (!activeUsers.has(roomId)) {
        activeUsers.set(roomId, new Set());
      }
      activeUsers.get(roomId).add(username);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.username = username;

      const messages = await pool.query(
        'SELECT sender, text, timestamp FROM messages WHERE room_id = $1 ORDER BY timestamp ASC',
        [roomId]
      );
      socket.emit('roomJoined', {
        roomId,
        messages: messages.rows,
        userCount: activeUsers.get(roomId).size
      });

      io.to(roomId).emit('userCount', { count: activeUsers.get(roomId).size });
    } catch (err) {
      console.error(err);
      socket.emit('roomError', { message: 'Ошибка сервера' });
    }
  });

  socket.on('sendMessage', async ({ roomId, sender, text }) => {
    try {
      await pool.query(
        'INSERT INTO messages (room_id, sender, text) VALUES ($1, $2, $3)',
        [roomId, sender, text]
      );
      await pool.query('UPDATE rooms SET last_active = NOW() WHERE id = $1', [roomId]);

      io.to(roomId).emit('newMessage', { roomId, sender, text });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('leaveRoom', ({ roomId }) => {
    if (roomId && socket.data.username) {
      const roomUsers = activeUsers.get(roomId);
      if (roomUsers) {
        roomUsers.delete(socket.data.username);
        if (roomUsers.size === 0) {
          activeUsers.delete(roomId);
        } else {
          io.to(roomId).emit('userCount', { count: roomUsers.size });
        }
      }
      socket.leave(roomId);
    }
  });

  socket.on('getRooms', async () => {
    try {
      const rooms = await pool.query(
        'SELECT id as "roomId", last_active as "lastActive" FROM rooms ORDER BY last_active DESC LIMIT 50'
      );
      socket.emit('roomList', { rooms: rooms.rows });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('deleteRoom', async ({ roomId }) => {
    try {
      await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
      io.emit('roomDeleted', { roomId });
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    const { roomId, username } = socket.data;
    if (roomId && username) {
      const roomUsers = activeUsers.get(roomId);
      if (roomUsers) {
        roomUsers.delete(username);
        if (roomUsers.size === 0) {
          activeUsers.delete(roomId);
        } else {
          io.to(roomId).emit('userCount', { count: roomUsers.size });
        }
      }
    }
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});