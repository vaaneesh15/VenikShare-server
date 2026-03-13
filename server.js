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
    origin: '*', // можно заменить на домен клиента позже
    methods: ['GET', 'POST']
  }
});

// Подключение к PostgreSQL – строка прямо здесь, без переменных окружения
const pool = new Pool({
  connectionString: 'postgresql://chatx_db_wtlk_user:znr3oAy78EIqLR3FqXLHxYjnaqOYXT75@dpg-d6pna595pdvs739v2ou0-a/chatx_db_wtlk',
  ssl: {
    rejectUnauthorized: false // обязательно для Render
  }
});

// Создание таблиц при запуске
async function initDB() {
  try {
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
    console.log('✅ База данных инициализирована');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
  }
}
initDB();

// Хранилище активных пользователей в памяти
const activeUsers = new Map(); // roomId -> Set of usernames

// Очистка неактивных комнат (72 часа)
setInterval(async () => {
  try {
    const result = await pool.query(
      `DELETE FROM rooms WHERE last_active < NOW() - INTERVAL '72 hours' RETURNING id`
    );
    if (result.rowCount > 0) {
      console.log(`🧹 Удалено ${result.rowCount} неактивных комнат`);
    }
  } catch (err) {
    console.error('❌ Ошибка очистки:', err);
  }
}, 60 * 60 * 1000); // раз в час

io.on('connection', (socket) => {
  console.log('🔗 Клиент подключился:', socket.id);

  socket.on('createRoom', async ({ roomId }) => {
    console.log(`📩 createRoom: ${roomId}`);
    try {
      const existing = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
      if (existing.rows.length > 0) {
        socket.emit('roomError', { message: 'Комната с таким ID уже существует' });
        return;
      }
      await pool.query('INSERT INTO rooms (id, last_active) VALUES ($1, NOW())', [roomId]);
      socket.emit('roomCreated', { roomId });
      console.log(`✅ Комната ${roomId} создана`);
    } catch (err) {
      console.error('❌ Ошибка createRoom:', err);
      socket.emit('roomError', { message: 'Ошибка сервера при создании комнаты' });
    }
  });

  socket.on('joinRoom', async ({ roomId, username }) => {
    console.log(`📩 joinRoom: ${roomId}, пользователь ${username}`);
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
      console.log(`✅ Пользователь ${username} присоединился к комнате ${roomId}, участников: ${activeUsers.get(roomId).size}`);
    } catch (err) {
      console.error('❌ Ошибка joinRoom:', err);
      socket.emit('roomError', { message: 'Ошибка сервера при подключении' });
    }
  });

  socket.on('sendMessage', async ({ roomId, sender, text }) => {
    console.log(`📩 sendMessage в ${roomId} от ${sender}: ${text}`);
    try {
      await pool.query(
        'INSERT INTO messages (room_id, sender, text) VALUES ($1, $2, $3)',
        [roomId, sender, text]
      );
      await pool.query('UPDATE rooms SET last_active = NOW() WHERE id = $1', [roomId]);

      io.to(roomId).emit('newMessage', { roomId, sender, text });
      console.log(`✅ Сообщение сохранено и разослано в ${roomId}`);
    } catch (err) {
      console.error('❌ Ошибка sendMessage:', err);
    }
  });

  socket.on('leaveRoom', ({ roomId }) => {
    if (roomId && socket.data.username) {
      console.log(`📩 leaveRoom: ${roomId}, пользователь ${socket.data.username}`);
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
      console.log(`👋 Пользователь ${socket.data.username} покинул комнату ${roomId}`);
    }
  });

  socket.on('getRooms', async () => {
    console.log('📩 getRooms');
    try {
      const rooms = await pool.query(
        'SELECT id as "roomId", last_active as "lastActive" FROM rooms ORDER BY last_active DESC LIMIT 50'
      );
      socket.emit('roomList', { rooms: rooms.rows });
      console.log(`✅ Отправлено ${rooms.rows.length} комнат`);
    } catch (err) {
      console.error('❌ Ошибка getRooms:', err);
    }
  });

  socket.on('deleteRoom', async ({ roomId }) => {
    console.log(`📩 deleteRoom: ${roomId}`);
    try {
      await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
      io.emit('roomDeleted', { roomId });
      console.log(`✅ Комната ${roomId} удалена`);
    } catch (err) {
      console.error('❌ Ошибка deleteRoom:', err);
    }
  });

  socket.on('disconnect', () => {
    const { roomId, username } = socket.data;
    if (roomId && username) {
      console.log(`📩 disconnect: ${roomId}, пользователь ${username}`);
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
    console.log('🔌 Клиент отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});