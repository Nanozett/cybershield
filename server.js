const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const tls = require('tls');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Умный поиск переменных окружения =====
function findDatabaseUrl() {
  const explicitKeys = [
    'STORAGE_URL', 'STORAGE__SE_URL', 'STORAGE_SE_URL',
    'TURSO_DATABASE_URL', 'TURSO_URL', 'LIBSQL_URL', 'DATABASE_URL'
  ];
  for (const key of explicitKeys) {
    if (process.env[key] && process.env[key].trim()) return process.env[key].trim();
  }
  for (const key of Object.keys(process.env)) {
    const k = key.toUpperCase();
    if ((k.includes('STORAGE') || k.includes('TURSO') || k.includes('LIBSQL')) && k.includes('URL')) {
      const v = process.env[key];
      if (v && v.trim()) return v.trim();
    }
  }
  return null;
}

function findDatabaseToken() {
  const explicitKeys = [
    'STORAGE_AUTH_TOKEN', 'STORAGE__TOKEN', 'STORAGE_TOKEN',
    'TURSO_AUTH_TOKEN', 'TURSO_TOKEN'
  ];
  for (const key of explicitKeys) {
    if (process.env[key] && process.env[key].trim()) return process.env[key].trim();
  }
  for (const key of Object.keys(process.env)) {
    const k = key.toUpperCase();
    if ((k.includes('STORAGE') || k.includes('TURSO') || k.includes('LIBSQL')) && (k.includes('TOKEN') || k.includes('AUTH'))) {
      const v = process.env[key];
      if (v && v.trim()) return v.trim();
    }
  }
  return null;
}

const dbUrl = findDatabaseUrl();
const dbToken = findDatabaseToken();

console.log('=============================================');
console.log('🔍 КиберЩит: проверка окружения');
console.log('DB URL найден:', dbUrl ? '✅' : '❌');
console.log('DB Token найден:', dbToken ? '✅' : '❌');
console.log('VERCEL:', process.env.VERCEL || 'нет');
console.log('=============================================');

let db;
if (dbUrl && dbUrl.startsWith('file:')) {
  db = createClient({ url: dbUrl });
} else if (dbUrl) {
  db = createClient({ url: dbUrl, authToken: dbToken });
} else if (process.env.VERCEL) {
  console.error('❌ На Vercel нет переменных для БД!');
  db = createClient({ url: 'file::memory:' });
} else {
  db = createClient({ url: 'file:./cybershield.db' });
}

// ===== Хелперы для работы с БД =====
async function dbGet(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}
async function dbAll(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}
async function dbRun(sql, args = []) {
  const result = await db.execute({ sql, args });
  return {
    lastID: result.lastInsertRowid ? Number(result.lastInsertRowid) : null,
    changes: result.rowsAffected || 0
  };
}

// ===== Инициализация таблиц =====
async function initDB() {
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'user'
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
      closed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER, user_id INTEGER, content TEXT,
      pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    )`);

    const countRow = await dbGet('SELECT COUNT(*) as count FROM software');
    if (Number(countRow.count) === 0) {
      await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)',
        ['Kaspersky', 'shield', 'Высокий уровень детекции, Многофункциональный, Защита платежей', 'Платная версия, Нагрузка на систему']);
      await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)',
        ['Bitdefender', 'bug', 'Легкий, Отличная защита в реальном времени, VPN в комплекте', 'Интерфейс перегружен, Сканы медленные']);
      await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)',
        ['Malwarebytes', 'skull', 'Специализация на вредоносном ПО, Быстрое сканирование, Бесплатная версия', 'Нет постоянной защиты в бесплатной, Обнаруживает не все угрозы']);
    }
    console.log('✅ База данных инициализирована');
  } catch (e) {
    console.error('❌ Ошибка инициализации БД:', e);
    throw e;
  }
}

// ===== Гарантия инициализации БД =====
let dbInitPromise = null;
function ensureDBReady() {
  if (!dbInitPromise) {
    dbInitPromise = initDB().catch(err => {
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

// ===== Кастомный Store для express-session на Turso =====
class TursoStore extends session.Store {
  get(sid, callback) {
    ensureDBReady()
      .then(() => dbGet('SELECT sess, expire FROM sessions WHERE sid = ?', [sid]))
      .then(row => {
        if (!row) return callback(null, null);
        if (row.expire && Date.now() > row.expire) {
          dbRun('DELETE FROM sessions WHERE sid = ?', [sid]).catch(() => {});
          return callback(null, null);
        }
        try { callback(null, JSON.parse(row.sess)); }
        catch (e) { callback(null, null); }
      })
      .catch(err => callback(err));
  }

  set(sid, sess, callback) {
    ensureDBReady()
      .then(() => {
        const expire = sess.cookie && sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + 24 * 60 * 60 * 1000;
        return dbRun(
          'INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire',
          [sid, JSON.stringify(sess), expire]
        );
      })
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  destroy(sid, callback) {
    ensureDBReady()
      .then(() => dbRun('DELETE FROM sessions WHERE sid = ?', [sid]))
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  touch(sid, sess, callback) {
    ensureDBReady()
      .then(() => {
        const expire = sess.cookie && sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + 24 * 60 * 60 * 1000;
        return dbRun('UPDATE sessions SET expire = ? WHERE sid = ?', [expire, sid]);
      })
      .then(() => callback(null))
      .catch(err => callback(err));
  }
}

// ===== Middleware =====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

app.use(session({
  store: new TursoStore(),
  secret: 'secret-key-cybershield',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

// ===== ЛЕГИТИМНЫЕ БРЕНДЫ =====
const LEGITIMATE_BRANDS = [
  'case-battle.lat', 'case-battle.cfd', 'steamcommunity.com',
  'sberbank.ru', 'gosuslugi.ru', 'vk.com', 'yandex.ru',
  'mail.ru', 'avito.ru', 'ozon.ru', 'wildberries.ru',
  'tinkoff.ru', 'alfabank.ru'
];

// ===== Динамические платформы (часто используются мошенниками) =====
const DYNAMIC_HOSTING_PLATFORMS = [
  'jugem.jp',
  'blogspot.com', 'blogspot.nl', 'blogspot.ru', 'blogspot.de', 'blogspot.co.uk',
  'weebly.com',
  'livejournal.com',
  'ucoz.com', 'ucoz.ru',
  'homelinux.org',
  'freedomain.thehost.com.ua',
  'byethost.com', 'byethost16.com', 'byethost7.com',
  '000webhostapp.com',
  'herokuapp.com',
  'github.io',
  'netlify.app',
  'pages.dev',
  'glitch.me',
  'repl.co'
];

// ===== Подозрительные TLD =====
const SUSPICIOUS_TLDS = [
  'icu', 'top', 'gq', 'ml', 'tk', 'cf', 'ga', 'click'
];

// ===== Нормализация домена =====
function normalizeDomain(name) {
  let s = String(name).toLowerCase();
  const homoglyphs = { 'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','к':'k','в':'b','н':'h','м':'m','т':'t','і':'i','ї':'i','ё':'e','ѕ':'s','ј':'j','ԁ':'d' };
  s = s.split('').map(c => homoglyphs[c] || c).join('');
  return s.replace(/[-_]/g, '');
}

// ===== Расстояние Левенштейна =====
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
    }
  }
  return matrix[b.length][a.length];
}

function findLookalike(domain) {
  const cleanDomain = String(domain).toLowerCase().replace(/^www\./, '').split('.')[0];
  const normalizedInput = normalizeDomain(cleanDomain);
  let bestMatch = null;
  for (const brand of LEGITIMATE_BRANDS) {
    const cleanBrand = String(brand).toLowerCase().replace(/^www\./, '').split('.')[0];
    const normalizedBrand = normalizeDomain(cleanBrand);
    if (normalizedInput === normalizedBrand) continue;
    if (normalizedBrand.length < 4) continue;
    const distance = levenshtein(normalizedInput, normalizedBrand);
    if (!bestMatch || distance < bestMatch.distance) bestMatch = { lookalike: brand, distance };
  }
  if (bestMatch && bestMatch.distance <= 2) return bestMatch;
  return null;
}

function isLegitimateBrand(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  return LEGITIMATE_BRANDS.some(brand => {
    const cleanBrand = brand.toLowerCase().replace(/^www\./, '');
    return cleanDomain === cleanBrand || cleanDomain.endsWith('.' + cleanBrand);
  });
}

// ===== НОВОЕ: Детект рандомного поддомена на бесплатной платформе =====
function isDynamicPhishing(domain) {
  const clean = domain.toLowerCase().replace(/^www\./, '');
  for (const platform of DYNAMIC_HOSTING_PLATFORMS) {
    if (clean.endsWith('.' + platform)) {
      const subdomain = clean.slice(0, -(platform.length + 1));
      // 1) Чисто буквенно-цифровая строка 4–20 символов с цифрами — рандом
      if (/^[a-z0-9]{4,20}$/.test(subdomain) && /\d/.test(subdomain)) {
        if (!/(my|blog|test|dev|photo|travel|food|news|life|shop|site|home)/i.test(subdomain)) {
          return { platform, subdomain, reason: 'Рандомный поддомен на бесплатной платформе' };
        }
      }
      // 2) Длинный поддомен (> 20 символов) — тоже часто рандом
      if (subdomain.length > 20) {
        return { platform, subdomain, reason: 'Подозрительно длинный поддомен' };
      }
    }
  }
  return null;
}

// ===== НОВОЕ: Проверка TLD =====
function hasSuspiciousTLD(domain) {
  const parts = domain.toLowerCase().split('.');
  const tld = parts[parts.length - 1];
  return SUSPICIOUS_TLDS.includes(tld);
}

// ===== АВТОРИЗАЦИЯ =====
app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Все поля обязательны' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const userRole = (role === 'moderator') ? 'moderator' : 'user';
    try {
      const result = await dbRun(
        'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [username, email, hash, userRole]
      );
      req.session.userId = result.lastID;
      req.session.username = username;
      req.session.role = userRole;
      req.session.save(err => {
        if (err) console.error('Session save error:', err);
        res.json({ success: true, username, role: userRole });
      });
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Пользователь с таким email или именем уже существует' });
      return res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
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
      if (err) console.error('Session save error:', err);
      res.json({ success: true, username: user.username, role: user.role });
    });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('Session destroy error:', err);
    res.json({ success: true });
  });
});

app.get('/api/me', async (req, res) => {
  if (req.session.userId) {
    try {
      const row = await dbGet('SELECT username, role FROM users WHERE id = ?', [req.session.userId]);
      if (!row) { req.session.destroy(); return res.json({ authenticated: false }); }
      res.json({ authenticated: true, username: row.username, userId: req.session.userId, role: row.role });
    } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
  } else { res.json({ authenticated: false }); }
});

// ===== ПРОГРАММЫ И КОММЕНТАРИИ =====
app.get('/api/software', async (req, res) => {
  try {
    const software = await dbAll('SELECT * FROM software');
    const result = [];
    for (const prog of software) {
      const comments = await dbAll(`SELECT comments.*, users.username FROM comments JOIN users ON comments.user_id = users.id WHERE comments.software_id = ? ORDER BY comments.created_at DESC`, [prog.id]);
      result.push({
        id: prog.id, name: prog.name, icon: prog.icon,
        pros: prog.pros ? prog.pros.split(', ') : [],
        cons: prog.cons ? prog.cons.split(', ') : [],
        comments: comments.map(c => ({ id: c.id, userId: c.user_id, username: c.username, text: c.text, created_at: c.created_at }))
      });
    }
    result.sort((a, b) => a.id - b.id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/comments', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { softwareId, text } = req.body;
  if (!softwareId || !text) return res.status(400).json({ error: 'Не все поля заполнены' });
  try {
    const result = await dbRun('INSERT INTO comments (user_id, software_id, text) VALUES (?, ?, ?)', [req.session.userId, softwareId, text]);
    res.json({ success: true, commentId: result.lastID });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/comments/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const row = await dbGet('SELECT user_id FROM comments WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Комментарий не найден' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') return res.status(403).json({ error: 'Недостаточно прав' });
    await dbRun('DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== ФОРУМ =====
app.get('/api/topics', async (req, res) => {
  try {
    const topics = await dbAll(`SELECT topics.*, users.username, (SELECT COUNT(*) FROM posts WHERE posts.topic_id = topics.id) as post_count FROM topics JOIN users ON topics.user_id = users.id ORDER BY topics.created_at DESC`);
    res.json(topics);
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/topics', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Заполните заголовок и содержание' });
  try {
    const result = await dbRun('INSERT INTO topics (user_id, title, content) VALUES (?, ?, ?)', [req.session.userId, title, content]);
    res.json({ success: true, topicId: result.lastID });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/topics/:id', async (req, res) => {
  try {
    const topic = await dbGet('SELECT * FROM topics WHERE id = ?', [req.params.id]);
    if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
    const posts = await dbAll(`SELECT posts.*, users.username FROM posts JOIN users ON posts.user_id = users.id WHERE posts.topic_id = ? ORDER BY posts.pinned DESC, posts.created_at ASC`, [req.params.id]);
    res.json({ topic, posts });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/posts', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { topicId, content } = req.body;
  if (!topicId || !content) return res.status(400).json({ error: 'Не все поля заполнены' });
  try {
    const topic = await dbGet('SELECT closed FROM topics WHERE id = ?', [topicId]);
    if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
    if (topic.closed === 1 && req.session.role !== 'moderator') return res.status(403).json({ error: 'Тема закрыта для ответов' });
    const result = await dbRun('INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)', [topicId, req.session.userId, content]);
    res.json({ success: true, postId: result.lastID });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/posts/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const row = await dbGet('SELECT user_id FROM posts WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') return res.status(403).json({ error: 'Недостаточно прав' });
    await dbRun('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.patch('/api/posts/:id/pin', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Доступ только для модераторов' });
  const { pinned } = req.body;
  try {
    const result = await dbRun('UPDATE posts SET pinned = ? WHERE id = ?', [pinned, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Сообщение не найдено' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.patch('/api/topics/:id/close', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Доступ только для модераторов' });
  const { closed } = req.body;
  try {
    const result = await dbRun('UPDATE topics SET closed = ? WHERE id = ?', [closed, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Тема не найдена' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/topics/:id', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Доступ только для модераторов' });
  try {
    await dbRun('DELETE FROM posts WHERE topic_id = ?', [req.params.id]);
    const result = await dbRun('DELETE FROM topics WHERE id = ?', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Тема не найдена' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== ЗАЯВКИ =====
app.post('/api/submissions', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { name, description, download_url } = req.body;
  if (!name || !description || !download_url) return res.status(400).json({ error: 'Все поля обязательны' });
  try {
    const result = await dbRun('INSERT INTO submissions (user_id, name, description, download_url) VALUES (?, ?, ?, ?)', [req.session.userId, name, description, download_url]);
    res.json({ success: true, submissionId: result.lastID });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/submissions', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const isModerator = req.session.role === 'moderator';
  try {
    let rows;
    if (isModerator) {
      rows = await dbAll(`SELECT submissions.*, users.username FROM submissions JOIN users ON submissions.user_id = users.id ORDER BY submissions.created_at DESC`);
    } else {
      rows = await dbAll(`SELECT submissions.*, users.username FROM submissions JOIN users ON submissions.user_id = users.id WHERE submissions.user_id = ? ORDER BY submissions.created_at DESC`, [req.session.userId]);
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/submissions/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const row = await dbGet(`SELECT submissions.*, users.username FROM submissions JOIN users ON submissions.user_id = users.id WHERE submissions.id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') return res.status(403).json({ error: 'Доступ запрещён' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.patch('/api/submissions/:id', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Только модератор может изменять статус' });
  const { status, review } = req.body;
  if (!status || !['pending', 'approved', 'rejected', 'reviewed'].includes(status)) return res.status(400).json({ error: 'Некорректный статус' });
  try {
    const result = await dbRun('UPDATE submissions SET status = ?, review = ? WHERE id = ?', [status, review || null, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/api/submissions/:id/approve', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') return res.status(403).json({ error: 'Только модератор может одобрить' });
  const { pros, cons, review } = req.body;
  if (!pros || !cons) return res.status(400).json({ error: 'Укажите плюсы и минусы' });
  try {
    const submission = await dbGet('SELECT name FROM submissions WHERE id = ?', [req.params.id]);
    if (!submission) return res.status(404).json({ error: 'Заявка не найдена' });
    const insertResult = await dbRun('INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)', [submission.name, 'shield', pros, cons]);
    await dbRun('UPDATE submissions SET status = ?, review = ? WHERE id = ?', ['approved', review || null, req.params.id]);
    res.json({ success: true, softwareId: insertResult.lastID });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== SSL-сертификат =====
function getSslCert(domain) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const socket = tls.connect({
      host: domain,
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
      timeout: 6000,
    }, () => {
      if (finished) return;
      finished = true;
      try {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.subject || Object.keys(cert).length === 0) {
          return reject(new Error('Не удалось получить сертификат'));
        }

        const now = Date.now();
        const validFromTs = cert.valid_from ? new Date(cert.valid_from).getTime() : 0;
        const validToTs = cert.valid_to ? new Date(cert.valid_to).getTime() : 0;
        const daysLeft = validToTs ? Math.floor((validToTs - now) / (1000 * 60 * 60 * 24)) : 0;

        const sanRaw = cert.subjectaltname || '';
        const san = sanRaw.split(',').map(s => s.trim().replace(/^DNS:/, '')).filter(Boolean);
        const isWildcard = san.some(s => s.startsWith('*.'));

        resolve({
          issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || 'Неизвестно',
          issuerCN: (cert.issuer && cert.issuer.CN) || '',
          subject: (cert.subject && cert.subject.CN) || domain,
          validFrom: cert.valid_from || '',
          validTo: cert.valid_to || '',
          daysLeft,
          san,
          isWildcard,
          fingerprint: cert.fingerprint || ''
        });
      } catch (e) {
        reject(e);
      }
    });

    socket.on('error', (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    });
    socket.on('timeout', () => {
      if (finished) return;
      finished = true;
      socket.destroy();
      reject(new Error('Превышено время ожидания SSL'));
    });
  });
}

app.get('/api/ssl/:domain', async (req, res) => {
  const domain = req.params.domain;
  if (!domain) return res.status(400).json({ error: 'Домен не указан' });
  const clean = domain.toLowerCase().replace(/^www\./, '');
  if (clean === 'localhost' || clean === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(clean)) {
    return res.status(404).json({ error: 'Локальный адрес' });
  }
  try {
    const info = await getSslCert(domain);
    res.json({ success: true, domain, ...info });
  } catch (e) {
    console.error('SSL ошибка для', domain, ':', e.message);
    res.status(500).json({ error: 'Не удалось получить сертификат', details: e.message });
  }
});

// ===== Health Check (для keep-warm) =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== WHOIS =====
app.get('/api/whois/:domain', async (req, res) => {
  const domain = req.params.domain;
  if (!domain) return res.status(400).json({ error: 'Домен не указан' });
  const cleanDomain = domain.toLowerCase();
  if (cleanDomain === 'localhost' || cleanDomain === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(cleanDomain)) {
    return res.status(404).json({ error: 'Локальный адрес — WHOIS не применим' });
  }
  try {
    const response = await fetch(`https://rdap.org/domain/${domain}`, { headers: { 'Accept': 'application/json' }, redirect: 'follow' });
    if (!response.ok) return res.status(404).json({ error: 'RDAP не вернул данные', status: response.status });
    const data = await response.json();
    const registration = (data.events || []).find(e => e.eventAction === 'registration');
    if (!registration || !registration.eventDate) return res.status(404).json({ error: 'Дата регистрации не найдена' });
    res.json({ success: true, domain, year: new Date(registration.eventDate).getFullYear(), fullDate: registration.eventDate.slice(0, 10) });
  } catch (e) {
    console.error('WHOIS ошибка для', domain, ':', e.message);
    res.status(500).json({ error: 'Не удалось получить данные', details: e.message });
  }
});

// ===== ПРОВЕРКА EMAIL ЧЕРЕЗ XPOSEDORNOT =====
app.get('/api/hibp/email/:email', async (req, res) => {
  const email = req.params.email;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Некорректный email' });
  }

  try {
    const xonUrl = `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`;
    const response = await fetch(xonUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'KiberShield-Extension' }
    });

    if (response.status === 404) {
      return res.json({ success: true, breaches: [] });
    }

    if (!response.ok) {
      console.error('XposedOrNot вернул статус', response.status);
      return res.status(500).json({ error: 'Ошибка сервиса проверки', status: response.status });
    }

    const data = await response.json();
    const breachNames = data.breaches || data.Breaches || [];

    const breaches = breachNames.map(name => ({
      Name: name,
      Title: name,
      BreachDate: '',
      PwnCount: null
    }));

    res.json({ success: true, breaches });
  } catch (e) {
    console.error('XposedOrNot ошибка для', email, ':', e.message);
    res.status(500).json({ error: 'Не удалось проверить email', details: e.message });
  }
});

// ===== ПРОВЕРКА САЙТОВ =====
app.post('/api/check', (req, res) => {
  const { url, domain } = req.body;
  if (!url || !domain) return res.status(400).json({ error: 'Не указан URL' });
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  const LOCAL_SITES = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  const isLocal =
    LOCAL_SITES.includes(cleanDomain) ||
    /^192\.168\.\d+\.\d+$/.test(cleanDomain) ||
    /^10\.\d+\.\d+\.\d+$/.test(cleanDomain) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(cleanDomain) ||
    cleanDomain.endsWith('.local') || cleanDomain.endsWith('.test') || cleanDomain.endsWith('.localhost');
  if (isLocal) return res.json({ verdict: 'safe', reasons: ['Локальный адрес — свой проект'] });

  const GOVERNMENT_SITES = [
    'fsb.ru','mvd.ru','mil.ru','rosguard.gov.ru','kremlin.ru','government.ru','gov.ru',
    'gosuslugi.ru','nalog.gov.ru','nalog.ru','pfr.gov.ru','sfr.gov.ru','cbr.ru',
    'vsrf.ru','genproc.gov.ru','sudrf.ru','rkn.gov.ru','rospotrebnadzor.ru',
    'edu.gov.ru','minzdrav.gov.ru','duma.gov.ru','cikrf.ru','mchs.gov.ru'
  ];
  const isGov = GOVERNMENT_SITES.some(site => {
    const cleanSite = site.toLowerCase().replace(/^www\./, '');
    return cleanDomain === cleanSite || cleanDomain.endsWith('.' + cleanSite);
  });
  if (isGov) return res.json({ verdict: 'government', reasons: ['Официальный сайт государственного органа РФ'] });

  let verdict = 'safe';
  const reasons = [];
  const BLACKLIST = [
    // Примеры / базовые
    'phishing-example.com','malware-site.ru','free-vbucks.net','steam-communlty.com','sberbank-online-vhod.ru',
    // Двойники case-battle
    'casebatle.id','casbatle.com','casebattle.red','case-batlte.com','cases-batle.ru',
    // Фишинг
    'brevis.by','moneyatphone.top',
    // Лотереи/опросы
    'fastrefund.website','hmail1009.blogspot.nl','prizeme.com.ua','spleth.icu',
    // SMS-разводы
    'jugem.jp','100linksdvgpn.avafedors.freedomain.thehost.com.ua','6gyf.sionas.homelinux.org','driveron.ru','drivers.byethost16.com','files.truetds.icu','forum.jokke.ru','fqevj.kolomnatrud.ru','fsfll.fgawudownsyfuf.info','geforcesh.preumnoj.ru','gsmsignal.ru','hit-kino.com','hjpzt.rtk-sales.ru','ikbsk.bear-hunt.ru','maksiko.ru','msaav.radiofaiz.ru','opendrivers.ru','orav.info','pravoholding.ru','qsiub.atomproduction.ru','qwcxp.elcoleso.ru','vernaconsco.rutopik.ru','vihce.wilgood63.ru','xagoc.geo-meter.ru',
    // Фейковые загрузки
    'apponic.com','download-windows.org','downloadastro.com','1progs.ru','advanced-systemcare-com.ru','aktiv-windows.ucoz.com','andyroid.net','antikeys.org','bandicam-pro.ru','botdilofce.bandcamp.com','boxprograms.ru','chelcenter.ru','computta.com','crackheaps.com','crackpluskeygen.org','doublegames.ru','downloadelements.com','driveridentifier.com','drivers.org.ru','driverunpaid.ru','drp.su','filesdatabase4u.com','filehorse.com','freecrackpatch.com','fsm-portal.net','get.cryptobrowser.site','installpack.net','jeweell.com','kichkas.biz','kryptex.org','listid.ru','mediagetsite.com','mirsofta.ru','moiprogrammy.com','mwfix.ru','nikask.ru','nullthemedownload.com','nvidiadrivers.net','oneindir.com','oneprogs.ru','removal-virusguide.com','savow.com','serialms.com','smojem.ru','softkumir.ru','softportal.com','solvusoft.com','teramissu-hom.com','top-best-browser.ru','tvoiprogrammy.ru','ubar-pro4.ru','upantool.com','updatestar.com','vipmolik.net','virus4remove.com','w10-digital-activation-program.ru','winxpsoft.com','xeplayer.com','youtube.net.ua',
    // Вирусы
    'imei-poisk.ru','programmi-dlya-vzloma.com','17ebook.com','aladel.net','bpwhamburgorchardpark.org','clicnews.com','dfwdiesel.net','divineenterprises.net','fantasticfilms.ru','gardensrestaurantandcatering.com','ginedis.com','gncr.org','hdvideoforums.org','hihanin.com','kingfamilyphotoalbum.com','likaraoke.com','mactep.org','magic4you.nu','marbling.pe.kr','nacjalneg.info','pronline.ru','purplehoodie.com','qsng.cn','seksburada.net','sportsmansclub.net','stock888.cn','tathli.com','teamclouds.com','texaswhitetailfever.com','wadefamilytree.org','xnescat.info','yt118.com',
    // Подозрительные
    'unvesouver39238.weebly.com'
  ];
  const SUSPICIOUS_PATTERNS = ['free-money','login-verify','account-confirm','paypal-secure','sberbank-online','gosuslugi-vhod'];

  // 1. Чёрный список
  if (BLACKLIST.some(b => cleanDomain.includes(b))) {
    verdict = 'dangerous';
    reasons.push('Домен в чёрном списке КиберЩит');
  }

  // 2. Двойники
  if (verdict !== 'dangerous' && !isLegitimateBrand(cleanDomain)) {
    const lookalike = findLookalike(cleanDomain);
    if (lookalike) {
      if (lookalike.distance <= 1) {
        verdict = 'dangerous';
        reasons.push(`Домен-двойник «${lookalike.lookalike}» (разница ${lookalike.distance} симв.)`);
      } else {
        if (verdict === 'safe') verdict = 'suspicious';
        reasons.push(`Похож на «${lookalike.lookalike}» (разница ${lookalike.distance} симв.)`);
      }
    }
  }

  // 3. НОВОЕ: Рандомный поддомен на бесплатной платформе
  if (verdict === 'safe' && !isLegitimateBrand(cleanDomain)) {
    const dyn = isDynamicPhishing(cleanDomain);
    if (dyn) {
      verdict = 'suspicious';
      reasons.push(`Похоже на фишинг на платформе ${dyn.platform} (${dyn.reason})`);
    }
  }

  // 4. НОВОЕ: Подозрительный TLD
  if (verdict === 'safe' && hasSuspiciousTLD(cleanDomain)) {
    verdict = 'suspicious';
    reasons.push(`Зона .${cleanDomain.split('.').pop()} часто используется мошенниками`);
  }

  // 5. Подозрительные паттерны в имени
  if (SUSPICIOUS_PATTERNS.some(p => cleanDomain.includes(p))) {
    if (verdict === 'safe') verdict = 'suspicious';
    reasons.push('Подозрительное имя домена');
  }

  // 6. HTTPS
  if (url.startsWith('http://')) {
    if (verdict === 'safe') verdict = 'suspicious';
    reasons.push('Соединение без HTTPS');
  }

  res.json({ verdict, reasons: [...new Set(reasons)] });
});

// ===== СИНХРОНИЗАЦИЯ =====
app.post('/api/check/sync', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const { history } = req.body;
  if (!Array.isArray(history)) return res.status(400).json({ error: 'Некорректные данные' });
  try {
    const limited = history.slice(0, 50);
    for (const item of limited) {
      await dbRun('INSERT INTO check_logs (user_id, url, domain, verdict) VALUES (?, ?, ?, ?)', [req.session.userId, item.url || '', item.domain || '', item.verdict || 'unknown']);
    }
    res.json({ success: true, synced: limited.length });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/api/check/history', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const rows = await dbAll('SELECT * FROM check_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.session.userId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.delete('/api/check/history', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const result = await dbRun('DELETE FROM check_logs WHERE user_id = ?', [req.session.userId]);
    res.json({ success: true, deleted: result.changes });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ===== SPA fallback =====
app.get('*', (req, res, next) => {
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== Запуск =====
ensureDBReady()
  .then(() => console.log('✅ Стартовая инициализация БД завершена'))
  .catch(err => console.error('⚠️ Стартовая инициализация БД не удалась, повторим при запросе:', err.message));

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});

module.exports = app;