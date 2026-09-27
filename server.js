const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const XLSX = require('xlsx');
const tls = require('tls');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Поиск переменных окружения =====
function findDatabaseUrl() {
  const keys = ['STORAGE_URL','STORAGE__SE_URL','STORAGE_SE_URL','TURSO_DATABASE_URL','TURSO_URL','LIBSQL_URL','DATABASE_URL'];
  for (const key of keys) if (process.env[key]?.trim()) return process.env[key].trim();
  for (const key of Object.keys(process.env)) {
    const k = key.toUpperCase();
    if ((k.includes('STORAGE')||k.includes('TURSO')||k.includes('LIBSQL')) && k.includes('URL')) {
      const v = process.env[key]; if (v?.trim()) return v.trim();
    }
  }
  return null;
}
function findDatabaseToken() {
  const keys = ['STORAGE_AUTH_TOKEN','STORAGE__TOKEN','STORAGE_TOKEN','TURSO_AUTH_TOKEN','TURSO_TOKEN'];
  for (const key of keys) if (process.env[key]?.trim()) return process.env[key].trim();
  for (const key of Object.keys(process.env)) {
    const k = key.toUpperCase();
    if ((k.includes('STORAGE')||k.includes('TURSO')||k.includes('LIBSQL')) && (k.includes('TOKEN')||k.includes('AUTH'))) {
      const v = process.env[key]; if (v?.trim()) return v.trim();
    }
  }
  return null;
}

const dbUrl = findDatabaseUrl();
const dbToken = findDatabaseToken();
console.log('DB URL:', dbUrl ? '✅' : '❌', '| DB Token:', dbToken ? '✅' : '❌');

let db;
if (dbUrl && dbUrl.startsWith('file:')) db = createClient({ url: dbUrl });
else if (dbUrl) db = createClient({ url: dbUrl, authToken: dbToken });
else if (process.env.VERCEL) db = createClient({ url: 'file::memory:' });
else db = createClient({ url: 'file:./cybershield.db' });

// ===== Хелперы БД =====
async function dbGet(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] || null;
}
async function dbAll(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
async function dbRun(sql, args = []) {
  const r = await db.execute({ sql, args });
  return { lastID: r.lastInsertRowid ? Number(r.lastInsertRowid) : null, changes: r.rowsAffected || 0 };
}

// ===== Инициализация БД =====
async function initDB() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE, email TEXT UNIQUE,
      password_hash TEXT, role TEXT DEFAULT 'user'
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS software (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, icon TEXT, pros TEXT, cons TEXT
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, software_id INTEGER, text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, title TEXT, content TEXT,
      closed INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER, user_id INTEGER, content TEXT,
      pinned INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, name TEXT, description TEXT, download_url TEXT,
      status TEXT DEFAULT 'pending', review TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS check_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, url TEXT, domain TEXT, verdict TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT,
      date TEXT,
      pair_number INTEGER,
      subject TEXT,
      teacher TEXT,
      room TEXT,
      start_time TEXT,
      end_time TEXT,
      uploaded_by INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS groups_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    )`);

    const cnt = await dbGet('SELECT COUNT(*) as count FROM software');
    if (Number(cnt.count) === 0) {
      await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)',
        ['Kaspersky', 'shield', 'Высокий уровень детекции, Многофункциональный, Защита платежей', 'Платная версия, Нагрузка на систему']);
      await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)',
        ['Bitdefender', 'bug', 'Легкий, Отличная защита в реальном времени, VPN в комплекте', 'Интерфейс перегружен, Сканы медленные']);
      await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)',
        ['Malwarebytes', 'skull', 'Специализация на вредоносном ПО, Быстрое сканирование, Бесплатная версия', 'Нет постоянной защиты в бесплатной, Обнаруживает не все угрозы']);
    }
    console.log('✅ БД инициализирована');
  } catch (e) { console.error('❌ Ошибка initDB:', e); throw e; }
}

let dbInitPromise = null;
function ensureDBReady() {
  if (!dbInitPromise) dbInitPromise = initDB().catch(err => { dbInitPromise = null; throw err; });
  return dbInitPromise;
}

// ===== Store сессий =====
class TursoStore extends session.Store {
  get(sid, cb) {
    ensureDBReady()
      .then(() => dbGet('SELECT sess, expire FROM sessions WHERE sid = ?', [sid]))
      .then(row => {
        if (!row) return cb(null, null);
        if (row.expire && Date.now() > row.expire) { dbRun('DELETE FROM sessions WHERE sid = ?', [sid]).catch(()=>{}); return cb(null, null); }
        try { cb(null, JSON.parse(row.sess)); } catch { cb(null, null); }
      }).catch(cb);
  }
  set(sid, sess, cb) {
    ensureDBReady()
      .then(() => {
        const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
        return dbRun('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire',
          [sid, JSON.stringify(sess), exp]);
      }).then(() => cb(null)).catch(cb);
  }
  destroy(sid, cb) {
    ensureDBReady().then(() => dbRun('DELETE FROM sessions WHERE sid = ?', [sid])).then(() => cb(null)).catch(cb);
  }
  touch(sid, sess, cb) {
    ensureDBReady().then(() => {
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      return dbRun('UPDATE sessions SET expire = ? WHERE sid = ?', [exp, sid]);
    }).then(() => cb(null)).catch(cb);
  }
}

// ===== Middleware =====
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);
app.use(session({
  store: new TursoStore(),
  secret: 'secret-key-cybershield',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 86400000 }
}));

// ===== Легитимные бренды / фишинг =====
const LEGITIMATE_BRANDS = [
  'case-battle.lat','case-battle.cfd','steamcommunity.com','sberbank.ru','gosuslugi.ru',
  'vk.com','yandex.ru','mail.ru','avito.ru','ozon.ru','wildberries.ru','tinkoff.ru','alfabank.ru'
];
const DYNAMIC_HOSTING_PLATFORMS = [
  'jugem.jp','blogspot.com','blogspot.ru','blogspot.de','weebly.com','livejournal.com',
  'ucoz.com','ucoz.ru','homelinux.org','freedomain.thehost.com.ua','byethost.com',
  'byethost16.com','byethost7.com','000webhostapp.com','herokuapp.com','github.io',
  'netlify.app','pages.dev','glitch.me','repl.co'
];
const SUSPICIOUS_TLDS = ['icu','top','gq','ml','tk','cf','ga','click'];

function normalizeDomain(name) {
  let s = String(name).toLowerCase();
  const h = {'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','к':'k','в':'b','н':'h','м':'m','т':'t','і':'i','ї':'i','ё':'e','ѕ':'s','ј':'j','ԁ':'d'};
  return s.split('').map(c => h[c] || c).join('').replace(/[-_]/g, '');
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) for (let j = 1; j <= a.length; j++) {
    m[i][j] = b[i-1] === a[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  }
  return m[b.length][a.length];
}
function findLookalike(domain) {
  const clean = String(domain).toLowerCase().replace(/^www\./, '').split('.')[0];
  const norm = normalizeDomain(clean);
  let best = null;
  for (const b of LEGITIMATE_BRANDS) {
    const cb = normalizeDomain(String(b).toLowerCase().replace(/^www\./, '').split('.')[0]);
    if (norm === cb || cb.length < 4) continue;
    const d = levenshtein(norm, cb);
    if (!best || d < best.distance) best = { lookalike: b, distance: d };
  }
  return best && best.distance <= 2 ? best : null;
}
function isLegitimateBrand(d) {
  const c = d.toLowerCase().replace(/^www\./, '');
  return LEGITIMATE_BRANDS.some(b => { const cb = b.toLowerCase().replace(/^www\./, ''); return c === cb || c.endsWith('.'+cb); });
}
function isDynamicPhishing(d) {
  const c = d.toLowerCase().replace(/^www\./, '');
  for (const p of DYNAMIC_HOSTING_PLATFORMS) {
    if (c.endsWith('.'+p)) {
      const sub = c.slice(0, -(p.length+1));
      if (/^[a-z0-9]{4,20}$/.test(sub) && /\d/.test(sub) && !/(my|blog|test|dev|photo|travel|food|news|life|shop|site|home)/i.test(sub))
        return { platform: p, subdomain: sub, reason: 'Рандомный поддомен' };
      if (sub.length > 20) return { platform: p, subdomain: sub, reason: 'Длинный поддомен' };
    }
  }
  return null;
}
function hasSuspiciousTLD(d) {
  return SUSPICIOUS_TLDS.includes(d.toLowerCase().split('.').pop());
}

// ===== АВТОРИЗАЦИЯ =====
app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Все поля обязательны' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const userRole = (role === 'moderator') ? 'moderator' : 'user';
    let r;
    try {
      r = await dbRun('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [username, email, hash, userRole]);
    } catch (err) {
      if (err && err.message && err.message.toUpperCase().includes('UNIQUE'))
        return res.status(400).json({ error: 'Пользователь уже существует' });
      throw err;
    }
    req.session.userId = r.lastID;
    req.session.username = username;
    req.session.role = userRole;
    req.session.save(err => {
      if (err) console.error(err);
      res.json({ success: true, username, role: userRole });
    });
  } catch (e) { console.error('register error:', e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Введите email и пароль' });
  try {
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Неверный email или пароль' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.save(err => {
      if (err) console.error(err);
      res.json({ success: true, username: user.username, role: user.role });
    });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ success: true })); });

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  try {
    const row = await dbGet('SELECT username, role FROM users WHERE id = ?', [req.session.userId]);
    if (!row) { req.session.destroy(); return res.json({ authenticated: false }); }
    res.json({ authenticated: true, username: row.username, userId: req.session.userId, role: row.role });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== ПРОГРАММЫ =====
app.get('/api/software', async (req, res) => {
  try {
    const software = await dbAll('SELECT * FROM software');
    const result = [];
    for (const p of software) {
      const comments = await dbAll(`SELECT comments.*, users.username FROM comments JOIN users ON comments.user_id = users.id WHERE comments.software_id = ? ORDER BY comments.created_at DESC`, [p.id]);
      result.push({
        id: p.id, name: p.name, icon: p.icon,
        pros: p.pros ? p.pros.split(', ') : [],
        cons: p.cons ? p.cons.split(', ') : [],
        comments: comments.map(c => ({ id: c.id, userId: c.user_id, username: c.username, text: c.text, created_at: c.created_at }))
      });
    }
    result.sort((a,b) => a.id - b.id);
    res.json(result);
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/comments', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { softwareId, text } = req.body;
  if (!softwareId || !text) return res.status(400).json({ error: 'Не все поля' });
  try {
    const r = await dbRun('INSERT INTO comments (user_id, software_id, text) VALUES (?, ?, ?)', [req.session.userId, softwareId, text]);
    res.json({ success: true, commentId: r.lastID });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/comments/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const row = await dbGet('SELECT user_id FROM comments WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Не найден' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') return res.status(403).json({ error: 'Нет прав' });
    await dbRun('DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== ФОРУМ =====
app.get('/api/topics', async (req, res) => {
  try {
    const topics = await dbAll(`SELECT topics.*, users.username, (SELECT COUNT(*) FROM posts WHERE posts.topic_id = topics.id) as post_count FROM topics JOIN users ON topics.user_id = users.id ORDER BY topics.created_at DESC`);
    res.json(topics);
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/topics', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Заполните все поля' });
  try {
    const r = await dbRun('INSERT INTO topics (user_id, title, content) VALUES (?, ?, ?)', [req.session.userId, title, content]);
    res.json({ success: true, topicId: r.lastID });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/topics/:id', async (req, res) => {
  try {
    const topic = await dbGet('SELECT * FROM topics WHERE id = ?', [req.params.id]);
    if (!topic) return res.status(404).json({ error: 'Не найдена' });
    const posts = await dbAll(`SELECT posts.*, users.username FROM posts JOIN users ON posts.user_id = users.id WHERE posts.topic_id = ? ORDER BY posts.pinned DESC, posts.created_at ASC`, [req.params.id]);
    res.json({ topic, posts });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/posts', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { topicId, content } = req.body;
  if (!topicId || !content) return res.status(400).json({ error: 'Не все поля' });
  try {
    const topic = await dbGet('SELECT closed FROM topics WHERE id = ?', [topicId]);
    if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
    if (topic.closed === 1 && req.session.role !== 'moderator') return res.status(403).json({ error: 'Тема закрыта' });
    const r = await dbRun('INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)', [topicId, req.session.userId, content]);
    res.json({ success: true, postId: r.lastID });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/posts/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const row = await dbGet('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') return res.status(403).json({ error: 'Нет прав' });
    await dbRun('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.patch('/api/posts/:id/pin', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Только модератор' });
  const { pinned } = req.body;
  try {
    const r = await dbRun('UPDATE posts SET pinned = ? WHERE id = ?', [pinned, req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.patch('/api/topics/:id/close', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Только модератор' });
  const { closed } = req.body;
  try {
    const r = await dbRun('UPDATE topics SET closed = ? WHERE id = ?', [closed, req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/topics/:id', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Только модератор' });
  try {
    await dbRun('DELETE FROM posts WHERE topic_id = ?', [req.params.id]);
    const r = await dbRun('DELETE FROM topics WHERE id = ?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найдено' });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== ЗАЯВКИ =====
app.post('/api/submissions', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { name, description, download_url } = req.body;
  if (!name || !description || !download_url) return res.status(400).json({ error: 'Все поля обязательны' });
  try {
    const r = await dbRun('INSERT INTO submissions (user_id, name, description, download_url) VALUES (?, ?, ?, ?)',
      [req.session.userId, name, description, download_url]);
    res.json({ success: true, submissionId: r.lastID });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/submissions', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const isMod = req.session.role === 'moderator';
  try {
    const rows = isMod
      ? await dbAll(`SELECT submissions.*, users.username FROM submissions JOIN users ON submissions.user_id = users.id ORDER BY submissions.created_at DESC`)
      : await dbAll(`SELECT submissions.*, users.username FROM submissions JOIN users ON submissions.user_id = users.id WHERE submissions.user_id = ? ORDER BY submissions.created_at DESC`, [req.session.userId]);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/submissions/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const row = await dbGet(`SELECT submissions.*, users.username FROM submissions JOIN users ON submissions.user_id = users.id WHERE submissions.id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Не найдена' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') return res.status(403).json({ error: 'Нет доступа' });
    res.json(row);
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.patch('/api/submissions/:id', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Только модератор' });
  const { status, review } = req.body;
  if (!status || !['pending','approved','rejected','reviewed'].includes(status)) return res.status(400).json({ error: 'Неверный статус' });
  try {
    const r = await dbRun('UPDATE submissions SET status = ?, review = ? WHERE id = ?', [status, review || null, req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Не найдена' });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/submissions/:id/approve', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Только модератор' });
  const { pros, cons, review } = req.body;
  if (!pros || !cons) return res.status(400).json({ error: 'Укажите плюсы и минусы' });
  try {
    const s = await dbGet('SELECT name FROM submissions WHERE id = ?', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Не найдена' });
    const r = await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)', [s.name, 'shield', pros, cons]);
    await dbRun('UPDATE submissions SET status = ?, review = ? WHERE id = ?', ['approved', review || null, req.params.id]);
    res.json({ success: true, softwareId: r.lastID });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===================================================================
// ===== РАСПИСАНИЕ — новый парсер под реальную структуру XLSX =====
// ===================================================================

// Номер пары по времени старта. Слоты: 1=08:00, 2=09:50, 3=11:40, 4=14:00, 5=15:50, 6=17:40.
// Сдвоенные (10:40, 12:30, 14:50) округляем к ближайшему слоту.
function startTimeToSlot(startTime) {
  const m = String(startTime).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  const slots = [480, 590, 700, 840, 950, 1060]; // 08:00, 09:50, 11:40, 14:00, 15:50, 17:40
  let best = 1, bestDist = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const d = Math.abs(minutes - slots[i]);
    if (d < bestDist) { bestDist = d; best = i + 1; }
  }
  return best;
}

// Из даты "2026-09-26" делает имя листа "260926" (DDMMYY)
function dateToSheetName(dateStr) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${d}${mo}${y.slice(2)}`;
}

// Парсит лист XLSX и возвращает пары только для указанной группы.
function parseScheduleRows(rows, targetGroup) {
  const pairs = [];
  let collecting = false;
  const DAY_ABBRS = /^(СБ|ПН|ВТ|СР|ЧТ|ПТ|ВС)$/i;
  const TIME_RANGE = /^\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}$/;
  const target = targetGroup ? String(targetGroup).toLowerCase().trim() : null;

  for (const row of rows) {
    if (!row) continue;
    const A = String(row[0] || '').trim();
    const B = String(row[1] || '').trim();
    const C = String(row[2] || '').trim();
    const E = String(row[4] || '').trim();
    const F = String(row[5] || '').trim();

    // Строки, где A заполнена, а B пуста — заголовки/маркеры
    if (A && !B && !DAY_ABBRS.test(A)) {
      if (/^Расписани/i.test(A)) continue;      // "Расписания учебных занятий ..."
      if (/^Курс\s+\d+/i.test(A)) continue;      // "Курс 2", "Курс 3"
      if (!target) continue;
      // Проверяем: начинается ли строка с выбранной группы
      if (A.toLowerCase().startsWith(target)) {
        collecting = true;
      } else if (/СТУДЕНТ/i.test(A)) {
        // Другая группа началась — прекращаем сбор
        collecting = false;
      }
      continue;
    }

    // Строка с парой: B = "08:00-09:35"
    if (!TIME_RANGE.test(B)) continue;
    if (!collecting) continue;
    if (!C) continue; // пустая дисциплина (окно) — пропускаем

    const tm = B.match(/^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/);
    if (!tm) continue;
    const startTime = `${tm[1].padStart(2,'0')}:${tm[2]}`;
    const endTime = `${tm[3].padStart(2,'0')}:${tm[4]}`;

    pairs.push({
      pair_number: startTimeToSlot(startTime),
      subject: C,
      teacher: E || '—',
      room: F || '—',
      start_time: startTime,
      end_time: endTime
    });
  }
  return pairs;
}

app.post('/api/schedule/upload', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { group, date, filename, data } = req.body;
  if (!group || !date || !data) return res.status(400).json({ error: 'Нужны group, date и файл' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Дата должна быть в формате YYYY-MM-DD' });

  try {
    const clean = data.replace(/^data:.*?;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    if (buffer.length > 15 * 1024 * 1024) return res.status(400).json({ error: 'Файл больше 15 МБ' });
    if (buffer.length < 100) return res.status(400).json({ error: 'Файл пустой или повреждён' });

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    console.log('📄 Листы XLSX:', workbook.SheetNames);
    console.log('📌 Ищем группу:', group, '| Дата:', date);

    // Пытаемся найти лист под нужную дату (имя вида "260926")
    const expected = dateToSheetName(date);
    let targetSheet = null;
    if (expected) {
      targetSheet = workbook.SheetNames.find(s => s === expected)
        || workbook.SheetNames.find(s => s.includes(expected))
        || workbook.SheetNames.find(s => s.replace(/\D/g, '') === expected);
    }
    const sheetsToParse = targetSheet ? [targetSheet] : workbook.SheetNames;
    console.log('📄 Парсим листы:', sheetsToParse, targetSheet ? '(точное совпадение по дате ✅)' : '(дата не найдена в именах листов — парсим все ⚠️)');

    let allPairs = [];
    for (const sheetName of sheetsToParse) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const pairs = parseScheduleRows(rows, group);
      if (pairs.length > 0) console.log(`  ✅ Лист ${sheetName}: ${pairs.length} пар для ${group}`);
      else console.log(`  ⚠️ Лист ${sheetName}: пар для ${group} не найдено`);
      allPairs = allPairs.concat(pairs);
    }

    if (allPairs.length === 0) {
      return res.status(400).json({
        error: `В файле не найдена группа «${group}» на дату ${date}. Листы в файле: ${workbook.SheetNames.join(', ')}. Проверь, что группа в расписании написана так же, как в списке (например «КИТ-ОИБАС-26»).`
      });
    }

    // Перезаписываем расписание для этой группы/даты
    await dbRun('DELETE FROM schedule WHERE group_name = ? AND date = ?', [group, date]);

    for (const p of allPairs) {
      await dbRun(
        'INSERT INTO schedule (group_name, date, pair_number, subject, teacher, room, start_time, end_time, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [group, date, p.pair_number, p.subject, p.teacher, p.room, p.start_time, p.end_time, req.session.userId]
      );
    }

    await dbRun('INSERT OR IGNORE INTO groups_list (name) VALUES (?)', [group]);

    res.json({ success: true, saved: allPairs.length, group, date, filename: filename || null });
  } catch (e) {
    console.error('Ошибка загрузки расписания:', e);
    res.status(500).json({ error: 'Не удалось распарсить файл', details: e.message });
  }
});

app.get('/api/schedule/groups', async (req, res) => {
  try {
    const rows = await dbAll('SELECT name FROM groups_list ORDER BY name');
    res.json(rows.map(r => r.name));
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/schedule/dates', async (req, res) => {
  const { group } = req.query;
  if (!group) return res.status(400).json({ error: 'Укажите group' });
  try {
    const rows = await dbAll('SELECT DISTINCT date FROM schedule WHERE group_name = ? ORDER BY date DESC LIMIT 30', [group]);
    res.json(rows.map(r => r.date));
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/schedule', async (req, res) => {
  const { group, date } = req.query;
  if (!group || !date) return res.status(400).json({ error: 'Укажите group и date' });

  try {
    const dayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    const d = new Date(date);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Неверная дата' });
    const jsDay = d.getDay();
    const dow = jsDay === 0 ? 7 : jsDay;

    const pairs = await dbAll(
      'SELECT * FROM schedule WHERE group_name = ? AND date = ? ORDER BY pair_number, start_time',
      [group, date]
    );

    res.json({
      group,
      date,
      dayOfWeek: dow,
      dayName: dayNames[dow],
      pairs: pairs.map(p => ({
        pair_number: p.pair_number,
        subject: p.subject,
        teacher: p.teacher,
        room: p.room,
        start_time: p.start_time,
        end_time: p.end_time
      })),
      count: pairs.length
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера', details: e.message });
  }
});

app.get('/api/schedule/analyze', async (req, res) => {
  const { group } = req.query;
  if (!group) return res.status(400).json({ error: 'Укажите group' });

  const dayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  try {
    const allRows = await dbAll(
      'SELECT * FROM schedule WHERE group_name = ? ORDER BY date DESC, pair_number',
      [group]
    );

    if (allRows.length === 0) {
      return res.json({
        group, days: [], bestDay: null,
        recommendation: 'Пока нет данных для анализа. Загрузите расписание хотя бы на несколько дней.'
      });
    }

    const byDow = { 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
    const seen = {};
    for (let i = 1; i <= 6; i++) seen[i] = new Set();

    for (const r of allRows) {
      const d = new Date(r.date);
      if (isNaN(d.getTime())) continue;
      const js = d.getDay();
      const dow = js === 0 ? 7 : js;
      if (dow < 1 || dow > 6) continue;

      const key = `${r.pair_number}|${r.start_time}`;
      if (seen[dow].has(key)) continue;
      seen[dow].add(key);
      byDow[dow].push(r);
    }

    const days = [];
    for (let dow = 1; dow <= 6; dow++) {
      const pairs = byDow[dow].sort((a, b) => a.pair_number - b.pair_number);
      if (pairs.length === 0) {
        days.push({ dayOfWeek: dow, dayName: dayNames[dow], count: 0, firstStart: null, lastEnd: null, gaps: 0, score: 0, verdict: 'свободен' });
        continue;
      }

      const toMin = t => { if (!t || t === '—') return 0; const [h,m] = String(t).split(':').map(Number); return (h||0)*60+(m||0); };
      const firstStart = pairs[0].start_time;
      const lastEnd = pairs[pairs.length - 1].end_time;

      let gaps = 0;
      for (let i = 1; i < pairs.length; i++) {
        const prevEnd = toMin(pairs[i-1].end_time);
        const curStart = toMin(pairs[i].start_time);
        if (prevEnd && curStart && curStart - prevEnd > 25) gaps++;
      }

      const endMin = toMin(lastEnd);
      const score = pairs.length * 100 + endMin + gaps * 50;

      let verdict = 'средний';
      if (pairs.length <= 2 && endMin && endMin <= 15*60) verdict = 'идеален для работы';
      else if (pairs.length <= 3 && endMin && endMin <= 16*60) verdict = 'хорош для работы';
      else if (pairs.length >= 4) verdict = 'загруженный';

      days.push({ dayOfWeek: dow, dayName: dayNames[dow], count: pairs.length, firstStart, lastEnd, gaps, score, verdict });
    }

    const working = days.filter(d => d.count > 0).sort((a,b) => a.score - b.score);
    const bestDay = working[0] || null;

    res.json({
      group, days, bestDay,
      recommendation: bestDay
        ? `Лучший день для подработки — ${bestDay.dayName} (${bestDay.count} пар, до ${bestDay.lastEnd}).`
        : 'Нет данных для анализа.'
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка анализа', details: e.message });
  }
});

// ===== SSL / WHOIS / EMAIL / CHECK =====
function getSslCert(domain) {
  return new Promise((resolve, reject) => {
    let fin = false;
    const sock = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: 6000 }, () => {
      if (fin) return; fin = true;
      try {
        const cert = sock.getPeerCertificate(); sock.end();
        if (!cert || !cert.subject || Object.keys(cert).length === 0) return reject(new Error('Нет сертификата'));
        const now = Date.now();
        const toTs = cert.valid_to ? new Date(cert.valid_to).getTime() : 0;
        const san = (cert.subjectaltname || '').split(',').map(s => s.trim().replace(/^DNS:/, '')).filter(Boolean);
        resolve({
          issuer: cert.issuer?.O || cert.issuer?.CN || 'Неизвестно',
          subject: cert.subject?.CN || domain,
          validFrom: cert.valid_from || '', validTo: cert.valid_to || '',
          daysLeft: toTs ? Math.floor((toTs - now) / 86400000) : 0,
          san, isWildcard: san.some(s => s.startsWith('*.')),
          fingerprint: cert.fingerprint || ''
        });
      } catch (e) { reject(e); }
    });
    sock.on('error', e => { if (fin) return; fin = true; reject(e); });
    sock.on('timeout', () => { if (fin) return; fin = true; sock.destroy(); reject(new Error('Таймаут')); });
  });
}

app.get('/api/ssl/:domain', async (req, res) => {
  const d = req.params.domain;
  if (!d) return res.status(400).json({ error: 'Домен не указан' });
  const clean = d.toLowerCase().replace(/^www\./, '');
  if (clean === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) return res.status(404).json({ error: 'Локальный адрес' });
  try {
    const info = await getSslCert(d);
    res.json({ success: true, domain: d, ...info });
  } catch (e) { res.status(500).json({ error: 'Ошибка SSL', details: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/api/whois/:domain', async (req, res) => {
  const d = req.params.domain;
  if (!d) return res.status(400).json({ error: 'Домен не указан' });
  const c = d.toLowerCase();
  if (c === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(c)) return res.status(404).json({ error: 'Локальный адрес' });
  try {
    const r = await fetch(`https://rdap.org/domain/${d}`, { headers: { Accept: 'application/json' }, redirect: 'follow' });
    if (!r.ok) return res.status(404).json({ error: 'Нет данных' });
    const data = await r.json();
    const reg = (data.events || []).find(e => e.eventAction === 'registration');
    if (!reg || !reg.eventDate) return res.status(404).json({ error: 'Дата не найдена' });
    res.json({ success: true, domain: d, year: new Date(reg.eventDate).getFullYear(), fullDate: reg.eventDate.slice(0, 10) });
  } catch (e) { res.status(500).json({ error: 'Ошибка WHOIS', details: e.message }); }
});

app.get('/api/hibp/email/:email', async (req, res) => {
  const email = req.params.email;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Некорректный email' });
  try {
    const r = await fetch(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`, { headers: { Accept: 'application/json' } });
    if (r.status === 404) return res.json({ success: true, breaches: [] });
    if (!r.ok) return res.status(500).json({ error: 'Ошибка сервиса' });
    const data = await r.json();
    const names = data.breaches || data.Breaches || [];
    res.json({ success: true, breaches: names.map(n => ({ Name: n, Title: n, BreachDate: '', PwnCount: null })) });
  } catch (e) { res.status(500).json({ error: 'Ошибка', details: e.message }); }
});

app.post('/api/check', (req, res) => {
  const { url, domain } = req.body;
  if (!url || !domain) return res.status(400).json({ error: 'Не указан URL' });
  const clean = domain.toLowerCase().replace(/^www\./, '');
  const LOCAL = ['localhost','127.0.0.1','0.0.0.0','::1'];
  const isLocal = LOCAL.includes(clean) || /^192\.168\./.test(clean) || /^10\./.test(clean) || clean.endsWith('.local') || clean.endsWith('.test');
  if (isLocal) return res.json({ verdict: 'safe', reasons: ['Локальный адрес'] });

  const GOV = ['fsb.ru','mvd.ru','mil.ru','kremlin.ru','government.ru','gov.ru','gosuslugi.ru','nalog.gov.ru','pfr.gov.ru','cbr.ru','vsrf.ru','genproc.gov.ru','sudrf.ru','rkn.gov.ru','edu.gov.ru','minzdrav.gov.ru','duma.gov.ru','cikrf.ru','mchs.gov.ru'];
  if (GOV.some(s => clean === s || clean.endsWith('.'+s))) return res.json({ verdict: 'government', reasons: ['Официальный сайт госоргана РФ'] });

  let verdict = 'safe';
  const reasons = [];
  const BLACKLIST = ['phishing-example.com','casebatle.id','casbatle.com','casebattle.red','brevis.by','moneyatphone.top','fastrefund.website','spleth.icu','driveron.ru','drp.su','1progs.ru','boxprograms.ru','kryptex.org','softportal.com','filehorse.com','updatestar.com'];
  const PATTERNS = ['free-money','login-verify','account-confirm','paypal-secure','sberbank-online','gosuslugi-vhod'];

  if (BLACKLIST.some(b => clean.includes(b))) { verdict = 'dangerous'; reasons.push('Домен в чёрном списке'); }
  if (verdict !== 'dangerous' && !isLegitimateBrand(clean)) {
    const la = findLookalike(clean);
    if (la) {
      if (la.distance <= 1) { verdict = 'dangerous'; reasons.push(`Двойник «${la.lookalike}»`); }
      else { if (verdict === 'safe') verdict = 'suspicious'; reasons.push(`Похож на «${la.lookalike}»`); }
    }
  }
  if (verdict === 'safe' && !isLegitimateBrand(clean)) {
    const dyn = isDynamicPhishing(clean);
    if (dyn) { verdict = 'suspicious'; reasons.push(`Фишинг на ${dyn.platform}`); }
  }
  if (verdict === 'safe' && hasSuspiciousTLD(clean)) { verdict = 'suspicious'; reasons.push(`Зона .${clean.split('.').pop()}`); }
  if (PATTERNS.some(p => clean.includes(p))) { if (verdict === 'safe') verdict = 'suspicious'; reasons.push('Подозрительное имя'); }
  if (url.startsWith('http://')) { if (verdict === 'safe') verdict = 'suspicious'; reasons.push('Без HTTPS'); }

  res.json({ verdict, reasons: [...new Set(reasons)] });
});

app.post('/api/check/sync', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { history } = req.body;
  if (!Array.isArray(history)) return res.status(400).json({ error: 'Неверные данные' });
  try {
    const lim = history.slice(0, 50);
    for (const item of lim) {
      await dbRun('INSERT INTO check_logs (user_id, url, domain, verdict) VALUES (?, ?, ?, ?)',
        [req.session.userId, item.url || '', item.domain || '', item.verdict || 'unknown']);
    }
    res.json({ success: true, synced: lim.length });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/check/history', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const rows = await dbAll('SELECT * FROM check_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.userId]);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/check/history', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const r = await dbRun('DELETE FROM check_logs WHERE user_id = ?', [req.session.userId]);
    res.json({ success: true, deleted: r.changes });
  } catch { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== SPA fallback =====
app.get('*', (req, res, next) => {
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureDBReady()
  .then(() => console.log('✅ БД готова'))
  .catch(err => console.error('❌ Ошибка БД:', err.message));

app.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));

module.exports = app;