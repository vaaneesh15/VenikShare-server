const express=require('express'),http=require('http'),{Server}=require('socket.io'),cors=require('cors'),{Pool}=require('pg');
const app=express(); app.use(cors()); app.use(express.json());
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*',methods:['GET','POST']}});
const pool=new Pool({connectionString:'postgresql://chatx_db_wtlk_user:znr3oAy78EIqLR3FqXLHxYjnaqOYXT75@dpg-d6pna595pdvs739v2ou0-a/chatx_db_wtlk',ssl:{rejectUnauthorized:false}});
const ADMIN_SECRET='blesterModGive3319_boshshsh'; // можно оставить, но не используется в письмах

async function initDB(){
 try{
  // Таблица пользователей
  await pool.query(`CREATE TABLE IF NOT EXISTS users(username VARCHAR(50)PRIMARY KEY,password VARCHAR(100)NOT NULL,invisible BOOLEAN NOT NULL DEFAULT FALSE,last_seen TIMESTAMP,created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS user_settings(username VARCHAR(50)PRIMARY KEY REFERENCES users(username)ON DELETE CASCADE,settings JSONB NOT NULL DEFAULT '{}')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admins(username VARCHAR(50)PRIMARY KEY REFERENCES users(username)ON DELETE CASCADE)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rooms(id VARCHAR(50)PRIMARY KEY,name VARCHAR(100)NOT NULL,password VARCHAR(100),type VARCHAR(20)NOT NULL DEFAULT 'private',created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS room_participants(room_id VARCHAR(50)REFERENCES rooms(id)ON DELETE CASCADE,username VARCHAR(50)REFERENCES users(username)ON DELETE CASCADE,deleted BOOLEAN NOT NULL DEFAULT FALSE,joined_at TIMESTAMP NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,username))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY,room_id VARCHAR(50)REFERENCES rooms(id)ON DELETE CASCADE,username VARCHAR(50)REFERENCES users(username)ON DELETE SET NULL,sender VARCHAR(50)NOT NULL,text TEXT NOT NULL,timestamp TIMESTAMP NOT NULL DEFAULT NOW())`);
  
  // Таблица писем (с проверкой наличия поля is_read)
  await pool.query(`CREATE TABLE IF NOT EXISTS mails(id SERIAL PRIMARY KEY,from_user VARCHAR(50)REFERENCES users(username)ON DELETE CASCADE,to_user VARCHAR(50)REFERENCES users(username)ON DELETE CASCADE,text TEXT NOT NULL,timestamp TIMESTAMP NOT NULL DEFAULT NOW(),is_read BOOLEAN NOT NULL DEFAULT FALSE)`);
  
  // Миграция: добавить is_read, если вдруг таблица существовала без него
  await pool.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mails' AND column_name='is_read') THEN
            ALTER TABLE mails ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
    END $$;
  `);

  await pool.query(`INSERT INTO rooms(id,name,password,type)VALUES('public','Public Chat',NULL,'public')ON CONFLICT(id)DO NOTHING`);
  console.log('✅ База инициализирована');
 }catch(e){console.error('❌ Ошибка БД:',e);}
}
initDB();

const activeUsers=new Map();
async function isAdmin(u){let r=await pool.query('SELECT 1 FROM admins WHERE username=$1',[u]);return r.rows.length>0;}
async function updateLastSeen(u){
 let r=await pool.query('SELECT invisible FROM users WHERE username=$1',[u]);
 if(r.rows.length&&!r.rows[0].invisible) await pool.query('UPDATE users SET last_seen=NOW() WHERE username=$1',[u]);
}

// ... (остальные эндпоинты без изменений, см. предыдущий полный серверный код) ...

// ---------- Эндпоинты для писем ----------
app.get('/api/mails', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    const m = await pool.query(
      'SELECT id, from_user, text, timestamp, is_read FROM mails WHERE to_user = $1 ORDER BY timestamp DESC',
      [username]
    );
    res.json(m.rows);
  } catch (e) {
    console.error('Ошибка /api/mails:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/mails/send', async (req, res) => {
  const { from, to, text } = req.body;
  if (!from || !to || !text) return res.status(400).json({ error: 'Missing fields' });
  try {
    const recipient = await pool.query('SELECT username FROM users WHERE username = $1', [to]);
    if (recipient.rows.length === 0) return res.status(404).json({ error: 'Recipient not found' });
    await pool.query(
      'INSERT INTO mails (from_user, to_user, text) VALUES ($1, $2, $3)',
      [from, to, text]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('Ошибка /api/mails/send:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/mails/mark-read', async (req, res) => {
  const { username, ids } = req.body;
  if (!username || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid data' });
  try {
    await pool.query(
      'UPDATE mails SET is_read = TRUE WHERE id = ANY($1::int[]) AND to_user = $2',
      [ids, username]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('Ошибка /api/mails/mark-read:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// ... (остальной код) ...
