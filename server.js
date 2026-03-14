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

// Тест подключения к базе данных
async function testDB() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Подключение к БД работает');
  } catch (err) {
    console.error('❌ Ошибка подключения к БД:', err);
  }
}
testDB();

// Инициализация таблиц (без invisible и admins)
async function initDB() {
  try {
    // Таблица пользователей (без поля invisible)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(50) PRIMARY KEY,
        password VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Таблица настроек пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        username VARCHAR(50) PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
        settings JSONB NOT NULL DEFAULT '{}'
      )
    `);

    // Таблица комнат
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        password VARCHAR(100),
        type VARCHAR(20) NOT NULL DEFAULT 'private',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Таблица участников комнат
    await pool.query(`
      CREATE TABLE IF NOT EXISTS room_participants (
        room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE CASCADE,
        username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        deleted BOOLEAN NOT NULL DEFAULT FALSE,
        joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (room_id, username)
      )
    `);

    // Таблица сообщений
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(50) REFERENCES rooms(id) ON DELETE CASCADE,
        username VARCHAR(50) REFERENCES users(username) ON DELETE SET NULL,
        sender VARCHAR(50) NOT NULL,
        text TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Таблица писем
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mails (
        id SERIAL PRIMARY KEY,
        from_user VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        to_user VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        text TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        is_read BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);

    // Создаём публичную комнату, если её нет
    await pool.query(`
      INSERT INTO rooms (id, name, password, type) 
      VALUES ('public', 'Public Chat', NULL, 'public')
      ON CONFLICT (id) DO NOTHING
    `);

    console.log('✅ База данных успешно инициализирована');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
  }
}
initDB();

// Хранилище активных пользователей для отображения онлайн
const activeUsers = new Map(); // roomId -> Set of usernames

// -------------------- API для аккаунтов --------------------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Имя и пароль обязательны' });
  }
  try {
    const existing = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Пользователь уже существует' });
    }
    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
    // Настройки по умолчанию
    await pool.query(
      'INSERT INTO user_settings (username, settings) VALUES ($1, $2)',
      [username, JSON.stringify({ requirePassword: false, passwordTimeout: 0 })]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка регистрации:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Имя и пароль обязательны' });
  }
  try {
    const user = await pool.query('SELECT password FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0 || user.rows[0].password !== password) {
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }
    res.json({ success: true, username });
  } catch (err) {
    console.error('Ошибка входа:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/change-username', async (req, res) => {
  const { oldUsername, newUsername, password } = req.body;
  if (!oldUsername || !newUsername || !password) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  try {
    const user = await pool.query('SELECT password FROM users WHERE username = $1', [oldUsername]);
    if (user.rows.length === 0 || user.rows[0].password !== password) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    const existing = await pool.query('SELECT username FROM users WHERE username = $1', [newUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Имя уже занято' });
    }
    // Обновляем во всех связанных таблицах
    await pool.query('UPDATE users SET username = $1 WHERE username = $2', [newUsername, oldUsername]);
    await pool.query('UPDATE messages SET username = $1, sender = $1 WHERE username = $2', [newUsername, oldUsername]);
    await pool.query('UPDATE room_participants SET username = $1 WHERE username = $2', [newUsername, oldUsername]);
    await pool.query('UPDATE user_settings SET username = $1 WHERE username = $2', [newUsername, oldUsername]);
    await pool.query('UPDATE mails SET from_user = $1 WHERE from_user = $2', [newUsername, oldUsername]);
    await pool.query('UPDATE mails SET to_user = $1 WHERE to_user = $2', [newUsername, oldUsername]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка смены имени:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;
  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  try {
    const user = await pool.query('SELECT password FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0 || user.rows[0].password !== oldPassword) {
      return res.status(401).json({ error: 'Неверный старый пароль' });
    }
    await pool.query('UPDATE users SET password = $1 WHERE username = $2', [newPassword, username]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка смены пароля:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/delete-account', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  try {
    const user = await pool.query('SELECT password FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0 || user.rows[0].password !== password) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    await pool.query('DELETE FROM users WHERE username = $1', [username]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления аккаунта:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// -------------------- API для настроек пользователя --------------------
app.get('/api/user-settings', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Не указан пользователь' });
  try {
    let settings = await pool.query('SELECT settings FROM user_settings WHERE username = $1', [username]);
    if (settings.rows.length === 0) {
      const defaultSettings = { requirePassword: false, passwordTimeout: 0 };
      await pool.query('INSERT INTO user_settings (username, settings) VALUES ($1, $2)', [username, JSON.stringify(defaultSettings)]);
      return res.json(defaultSettings);
    }
    res.json(settings.rows[0].settings);
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/user-settings', async (req, res) => {
  const { username, settings } = req.body;
  if (!username || !settings) return res.status(400).json({ error: 'Не все поля заполнены' });
  try {
    await pool.query(
      'INSERT INTO user_settings (username, settings) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET settings = $2',
      [username, JSON.stringify(settings)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// -------------------- API для писем --------------------
app.get('/api/mails', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Не указан пользователь' });
  try {
    const mails = await pool.query(
      'SELECT id, from_user, text, timestamp, is_read FROM mails WHERE to_user = $1 ORDER BY timestamp DESC',
      [username]
    );
    res.json(mails.rows);
  } catch (err) {
    console.error('Ошибка загрузки писем:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/mails/send', async (req, res) => {
  const { from, to, text } = req.body;
  if (!from || !to || !text) return res.status(400).json({ error: 'Не все поля заполнены' });
  try {
    const recipient = await pool.query('SELECT username FROM users WHERE username = $1', [to]);
    if (recipient.rows.length === 0) {
      return res.status(404).json({ error: 'Получатель не найден' });
    }
    await pool.query(
      'INSERT INTO mails (from_user, to_user, text) VALUES ($1, $2, $3)',
      [from, to, text]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отправки письма:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/mails/mark-read', async (req, res) => {
  const { username, ids } = req.body;
  if (!username || !Array.isArray(ids)) return res.status(400).json({ error: 'Неверные данные' });
  try {
    await pool.query(
      'UPDATE mails SET is_read = TRUE WHERE id = ANY($1::int[]) AND to_user = $2',
      [ids, username]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка отметки писем:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// -------------------- API для комнат --------------------
app.post('/api/rooms/create', async (req, res) => {
  const { roomId, roomName, password, creator } = req.body;
  if (!roomId || !roomName || !password || !creator) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  try {
    const existing = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Комната с таким ID уже существует' });
    }
    await pool.query(
      'INSERT INTO rooms (id, name, password, type) VALUES ($1, $2, $3, $4)',
      [roomId, roomName, password, 'private']
    );
    await pool.query(
      'INSERT INTO room_participants (room_id, username, deleted) VALUES ($1, $2, false)',
      [roomId, creator]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка создания комнаты:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/rooms/check-password', async (req, res) => {
  const { roomId, password } = req.body;
  try {
    const room = await pool.query('SELECT password FROM rooms WHERE id = $1 AND type = $2', [roomId, 'private']);
    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Комната не найдена' });
    }
    if (room.rows[0].password !== password) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка проверки пароля:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/rooms/join', async (req, res) => {
  const { roomId, username } = req.body;
  try {
    await pool.query(
      `INSERT INTO room_participants (room_id, username, deleted) 
       VALUES ($1, $2, false)
       ON CONFLICT (room_id, username) 
       DO UPDATE SET deleted = false`,
      [roomId, username]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка входа в комнату:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/rooms/rename', async (req, res) => {
  const { roomId, username, newName } = req.body;
  if (!roomId || !username || !newName) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  try {
    const participant = await pool.query(
      'SELECT * FROM room_participants WHERE room_id = $1 AND username = $2',
      [roomId, username]
    );
    if (participant.rows.length === 0) {
      return res.status(403).json({ error: 'Вы не участник этой комнаты' });
    }
    await pool.query('UPDATE rooms SET name = $1 WHERE id = $2', [newName, roomId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка переименования комнаты:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/rooms/delete', async (req, res) => {
  const { roomId, username } = req.body;
  try {
    await pool.query(
      'UPDATE room_participants SET deleted = true WHERE room_id = $1 AND username = $2',
      [roomId, username]
    );
    const remaining = await pool.query(
      'SELECT COUNT(*) FROM room_participants WHERE room_id = $1 AND deleted = false',
      [roomId]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка удаления комнаты:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
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
    console.error('Ошибка получения списка комнат:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.get('/api/rooms/info/:roomId', async (req, res) => {
  const { roomId } = req.params;
  try {
    const room = await pool.query('SELECT id, name, password FROM rooms WHERE id = $1', [roomId]);
    if (room.rows.length === 0) {
      return res.status(404).json({ error: 'Комната не найдена' });
    }
    res.json(room.rows[0]);
  } catch (err) {
    console.error('Ошибка получения информации о комнате:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.get('/api/rooms/participants/:roomId', (req, res) => {
  const users = activeUsers.get(req.params.roomId);
  res.json(users ? Array.from(users) : []);
});

app.get('/api/rooms/participants/public', (req, res) => {
  const users = activeUsers.get('public');
  res.json(users ? Array.from(users) : []);
});

// -------------------- Socket.IO --------------------
io.on('connection', (socket) => {
  console.log('🔗 Клиент подключился:', socket.id);

  socket.on('joinRoom', async ({ roomId, username }) => {
    console.log(`📩 joinRoom: ${roomId}, пользователь ${username}`);
    try {
      const room = await pool.query('SELECT id, type FROM rooms WHERE id = $1', [roomId]);
      if (room.rows.length === 0) {
        socket.emit('roomError', { message: 'Комната не существует' });
        return;
      }

      if (room.rows[0].type === 'private') {
        const participant = await pool.query(
          'SELECT * FROM room_participants WHERE room_id = $1 AND username = $2',
          [roomId, username]
        );
        if (participant.rows.length === 0) {
          socket.emit('roomError', { message: 'Вы не участник этой комнаты' });
          return;
        }
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.username = username;

      if (!activeUsers.has(roomId)) {
        activeUsers.set(roomId, new Set());
      }
      activeUsers.get(roomId).add(username);

      const messages = await pool.query(
        'SELECT id, sender, text, timestamp FROM messages WHERE room_id = $1 ORDER BY timestamp ASC',
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
      console.error('❌ Детальная ошибка joinRoom:', err);
      socket.emit('roomError', { message: 'Ошибка сервера при подключении: ' + err.message });
    }
  });

  socket.on('sendMessage', async ({ roomId, sender, text }) => {
    console.log(`📩 sendMessage в ${roomId} от ${sender}: ${text.substring(0, 30)}...`);
    try {
      const result = await pool.query(
        'INSERT INTO messages (room_id, username, sender, text) VALUES ($1, $2, $3, $4) RETURNING id',
        [roomId, sender, sender, text]
      );
      const messageId = result.rows[0].id;
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

// Обработка 404 – всегда возвращаем JSON
app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
