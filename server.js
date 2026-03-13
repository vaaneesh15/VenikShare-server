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
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: 'postgresql://chatx_db_wtlk_user:znr3oAy78EIqLR3FqXLHxYjnaqOYXT75@dpg-d6pna595pdvs739v2ou0-a/chatx_db_wtlk',
  ssl: {
    rejectUnauthorized: false
  }
});

// Создание таблиц при запуске
async function initDB() {
  try {
    // Пользователи
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(50) PRIMARY KEY,
        password VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Комнаты (личные и публичная)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        password VARCHAR(100), -- NULL для публичной комнаты
        type VARCHAR(20) NOT NULL DEFAULT 'private', -- 'public' или 'private'
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Участники комнат и статус удаления
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_participants (
        room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE CASCADE,
        username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        deleted BOOLEAN NOT NULL DEFAULT FALSE, -- пометил ли пользователь комнату как удалённую
        joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (room_id, username)
      )
    `);
    // Сообщения (связь с комнатой)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE CASCADE,
        sender VARCHAR(50) REFERENCES users(username) ON DELETE SET NULL,
        text TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // Создаём публичную комнату, если её нет
    await pool.query(`
      INSERT INTO rooms (id, name, password, type) 
      VALUES ('public', 'Public Chat', NULL, 'public')
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('✅ База данных инициализирована');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
  }
}
initDB();

// Активные пользователи в памяти (для счётчиков)
const activeUsers = new Map(); // roomId -> Set of usernames

// --- API для аккаунтов ---
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const existing = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const user = await pool.query('SELECT password FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.rows[0].password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ success: true, username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/delete-account', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const user = await pool.query('SELECT password FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.rows[0].password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Удаляем пользователя (каскадно удалятся сообщения, участники)
    await pool.query('DELETE FROM users WHERE username = $1', [username]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- API для личных комнат ---
app.post('/api/rooms/create', async (req, res) => {
  const { roomId, roomName, password, creator } = req.body;
  if (!roomId || !roomName || !password || !creator) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const existing = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Room ID already exists' });
    }
    await pool.query(
      'INSERT INTO rooms (id, name, password, type) VALUES ($1, $2, $3, $4)',
      [roomId, roomName, password, 'private']
    );
    // Добавляем создателя как участника (не удалена)
    await pool.query(
      'INSERT INTO room_participants (room_id, username, deleted) VALUES ($1, $2, false)',
      [roomId, creator]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/rooms/check-password', async (req, res) => {
  const { roomId, password } = req.body;
  try {
    const room = await pool.query('SELECT password FROM rooms WHERE id = $1 AND type = $2', [roomId, 'private']);
    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (room.rows[0].password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/rooms/join', async (req, res) => {
  const { roomId, username } = req.body;
  try {
    // Добавляем участника, если ещё не участвует, и сбрасываем deleted
    await pool.query(
      `INSERT INTO room_participants (room_id, username, deleted) 
       VALUES ($1, $2, false)
       ON CONFLICT (room_id, username) 
       DO UPDATE SET deleted = false`,
      [roomId, username]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/rooms/delete', async (req, res) => {
  const { roomId, username } = req.body;
  try {
    // Помечаем комнату как удалённую для этого пользователя
    await pool.query(
      'UPDATE room_participants SET deleted = true WHERE room_id = $1 AND username = $2',
      [roomId, username]
    );
    // Проверяем, все ли участники пометили комнату как удалённую
    const remaining = await pool.query(
      'SELECT COUNT(*) FROM room_participants WHERE room_id = $1 AND deleted = false',
      [roomId]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      // Никто не хочет видеть комнату – удаляем полностью
      await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/rooms/list/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const rooms = await pool.query(
      `SELECT r.id, r.name, r.type 
       FROM rooms r
       JOIN room_participants p ON r.id = p.room_id
       WHERE p.username = $1 AND p.deleted = false AND r.type = 'private'`,
      [username]
    );
    res.json(rooms.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log('🔗 Клиент подключился:', socket.id);

  socket.on('joinRoom', async ({ roomId, username }) => {
    console.log(`📩 joinRoom: ${roomId}, пользователь ${username}`);
    try {
      // Проверяем существование комнаты
      const room = await pool.query('SELECT id, type FROM rooms WHERE id = $1', [roomId]);
      if (room.rows.length === 0) {
        socket.emit('roomError', { message: 'Комната не существует' });
        return;
      }

      // Для личных комнат проверяем, что пользователь участник
      if (room.rows[0].type === 'private') {
        const part = await pool.query(
          'SELECT * FROM room_participants WHERE room_id = $1 AND username = $2',
          [roomId, username]
        );
        if (part.rows.length === 0) {
          socket.emit('roomError', { message: 'Вы не участник этой комнаты' });
          return;
        }
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.username = username;

      // Добавляем в активные
      if (!activeUsers.has(roomId)) {
        activeUsers.set(roomId, new Set());
      }
      activeUsers.get(roomId).add(username);

      // Отправляем историю сообщений
      const messages = await pool.query(
        'SELECT id, sender, text, timestamp FROM messages WHERE room_id = $1 ORDER BY timestamp ASC',
        [roomId]
      );
      socket.emit('roomJoined', {
        roomId,
        messages: messages.rows,
        userCount: activeUsers.get(roomId).size
      });

      // Уведомляем всех в комнате о новом пользователе
      io.to(roomId).emit('userCount', { count: activeUsers.get(roomId).size });
      console.log(`✅ Пользователь ${username} присоединился к комнате ${roomId}, участников: ${activeUsers.get(roomId).size}`);
    } catch (err) {
      console.error('❌ Ошибка joinRoom:', err);
      socket.emit('roomError', { message: 'Ошибка сервера при подключении' });
    }
  });

  socket.on('sendMessage', async ({ roomId, sender, text }) => {
    console.log(`📩 sendMessage в ${roomId} от ${sender}: ${text.substring(0,30)}...`);
    try {
      const result = await pool.query(
        'INSERT INTO messages (room_id, sender, text) VALUES ($1, $2, $3) RETURNING id',
        [roomId, sender, text]
      );
      const messageId = result.rows[0].id;
      await pool.query('UPDATE rooms SET last_active = NOW() WHERE id = $1', [roomId]);

      const newMessage = {
        id: messageId,
        roomId,
        sender,
        text,
        timestamp: new Date().toISOString()
      };

      io.to(roomId).emit('newMessage', newMessage);
      console.log(`✅ Сообщение сохранено (id: ${messageId})`);
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
