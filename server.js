const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const XLSX = require('xlsx');
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

// ===== Константы для Яндекс.Диска =====
const YANDEX_PUBLIC_KEY = 'eSjfjNM06Zcyzwqv5124yiPegnqahzm72s0qoIz-cKg6Y1haOWRpYXFSZw';
const YANDEX_DOWNLOAD_API = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${YANDEX_PUBLIC_KEY}`;

// Кэш расписания
let scheduleCache = {
  data: null,
  rawRows: null,
  debug: null,
  lastUpdate: 0
};
const SCHEDULE_CACHE_TTL = 60 * 60 * 1000; // 1 час

// ===== Словарь дней недели =====
const DAY_NAME_TO_NUM = {
  'понедельник': 1, 'пн': 1, 'monday': 1, 'mon': 1,
  'вторник': 2, 'вт': 2, 'tuesday': 2, 'tue': 2,
  'среда': 3, 'ср': 3, 'wednesday': 3, 'wed': 3,
  'четверг': 4, 'чт': 4, 'thursday': 4, 'thu': 4,
  'пятница': 5, 'пт': 5, 'friday': 5, 'fri': 5,
  'суббота': 6, 'сб': 6, 'saturday': 6, 'sat': 6,
  'воскресенье': 7, 'вс': 7, 'sunday': 7, 'sun': 7
};

// ===== Парсинг одной ячейки с парой =====
function parsePairCell(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  let subject = '', teacher = '', room = '', startTime = '', endTime = '';

  const timeMatch = String(text).match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
  if (timeMatch) {
    startTime = timeMatch[1].replace('.', ':');
    endTime = timeMatch[2].replace('.', ':');
  }

  const roomMatch = String(text).match(/(?:ауд\.?|каб\.?|аудитория)\s*([\w\-/А-Яа-я]+)/i);
  if (roomMatch) room = roomMatch[1];

  for (const line of lines) {
    if (!/^\d{1,2}[:.]\d{2}/.test(line) && !/^ауд/i.test(line) && !/^каб/i.test(line)) {
      subject = line;
      break;
    }
  }

  for (const line of lines) {
    if (line === subject) continue;
    if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\./.test(line)) {
      teacher = line;
      break;
    }
  }
  if (!teacher) {
    for (const line of lines) {
      if (line === subject) continue;
      if (line.split(/\s+/).length >= 2 && /^[А-ЯЁ]/.test(line) && !/^\d/.test(line)) {
        teacher = line;
        break;
      }
    }
  }

  return {
    subject: subject || lines[0].slice(0, 80),
    teacher: teacher || 'Не указан',
    room: room || '—',
    start_time: startTime || '—',
    end_time: endTime || '—'
  };
}

// ===== Стратегия A: дни недели в столбцах, номера пар в первом столбце =====
function parseSheetStrategyA(sheetName, rows) {
  let headerRowIdx = -1;
  const dayCols = {};

  for (let i = 0; i < rows.length && headerRowIdx === -1; i++) {
    const row = rows[i];
    if (!row) continue;
    const detected = {};
    let count = 0;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase().trim();
      for (const [key, num] of Object.entries(DAY_NAME_TO_NUM)) {
        if (cell === key || cell.includes(key)) {
          if (!detected[j]) { detected[j] = num; count++; }
          break;
        }
      }
    }
    if (count >= 3) {
      headerRowIdx = i;
      Object.assign(dayCols, detected);
    }
  }

  if (headerRowIdx === -1) return null;

  const pairs = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const first = String(row[0] || '').trim();
    const pairNum = parseInt(first, 10);
    if (!pairNum || pairNum < 1 || pairNum > 10) continue;

    for (const colIdxStr of Object.keys(dayCols)) {
      const colIdx = parseInt(colIdxStr, 10);
      const dayNum = dayCols[colIdxStr];
      const cellText = String(row[colIdx] || '').trim();
      if (!cellText || cellText === '—' || cellText === '-' || cellText === '–') continue;

      const parsed = parsePairCell(cellText);
      if (!parsed) continue;

      pairs.push({
        day_of_week: dayNum,
        pair_number: pairNum,
        subject: parsed.subject,
        teacher: parsed.teacher,
        room: parsed.room,
        start_time: parsed.start_time,
        end_time: parsed.end_time
      });
    }
  }

  return pairs;
}

// ===== Стратегия B: таблица с колонками Группа / День / Пара / Предмет / ... =====
function parseSheetStrategyB(rows) {
  const KEYWORDS = {
    group: ['группа', 'group', 'поток'],
    day: ['день', 'дня', 'дню', 'day', 'дни'],
    pair: ['пара', 'номер пары', '№ пары', 'pair'],
    subject: ['предмет', 'дисциплина', 'subject', 'название'],
    teacher: ['преподаватель', 'учитель', 'teacher', 'фио', 'препод'],
    room: ['аудитория', 'кабинет', 'room', 'ауд'],
    time: ['время', 'time', 'часы']
  };

  let headerIdx = -1;
  const colMap = {};

  for (let i = 0; i < rows.length && headerIdx === -1; i++) {
    const row = rows[i];
    if (!row) continue;
    const detected = {};
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase().trim();
      for (const [role, keys] of Object.entries(KEYWORDS)) {
        if (keys.some(k => cell.includes(k))) {
          if (detected[role] === undefined) detected[role] = j;
          break;
        }
      }
    }
    if (detected.group !== undefined && detected.day !== undefined && detected.subject !== undefined) {
      headerIdx = i;
      Object.assign(colMap, detected);
    }
  }

  if (headerIdx === -1) return null;

  const groupsMap = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const groupName = String(row[colMap.group] || '').trim();
    const dayStr = String(row[colMap.day] || '').toLowerCase().trim();

    if (!groupName || !dayStr) continue;

    let dayNum = null;
    for (const [key, num] of Object.entries(DAY_NAME_TO_NUM)) {
      if (dayStr === key || dayStr.includes(key)) { dayNum = num; break; }
    }
    if (!dayNum) continue;

    const pairNumRaw = colMap.pair !== undefined ? parseInt(String(row[colMap.pair] || '').trim(), 10) : null;
    const pairNum = pairNumRaw && !isNaN(pairNumRaw) ? pairNumRaw : 0;
    const subject = String(row[colMap.subject] || '').trim();
    const teacher = colMap.teacher !== undefined ? String(row[colMap.teacher] || '').trim() : 'Не указан';
    const room = colMap.room !== undefined ? String(row[colMap.room] || '').trim() : '—';
    const timeStr = colMap.time !== undefined ? String(row[colMap.time] || '').trim() : '';

    let startTime = '', endTime = '';
    if (timeStr) {
      const m = timeStr.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
      if (m) { startTime = m[1].replace('.', ':'); endTime = m[2].replace('.', ':'); }
    }

    if (!groupsMap[groupName]) groupsMap[groupName] = [];
    groupsMap[groupName].push({
      day_of_week: dayNum,
      pair_number: pairNum,
      subject: subject || '—',
      teacher: teacher || 'Не указан',
      room: room || '—',
      start_time: startTime || '—',
      end_time: endTime || '—'
    });
  }

  if (Object.keys(groupsMap).length === 0) return null;
  return groupsMap;
}

// ===== Загрузка и парсинг XLSX =====
async function fetchScheduleFromYandex() {
  console.log('📥 Загрузка расписания с Яндекс.Диска...');

  const metaRes = await fetch(YANDEX_DOWNLOAD_API);
  if (!metaRes.ok) throw new Error(`Яндекс API: ${metaRes.status}`);
  const meta = await metaRes.json();
  if (!meta.href) throw new Error('Нет поля href в ответе Яндекс.Диска');

  const fileRes = await fetch(meta.href);
  if (!fileRes.ok) throw new Error(`Не удалось скачать файл: ${fileRes.status}`);
  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  console.log('📄 Листы:', workbook.SheetNames);

  // Собираем сырые данные для отладки
  const rawRows = [];
  const debug = { sheets: [] };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    rawRows.push({ sheetName, rows: rows.slice(0, 50) });
    debug.sheets.push({
      name: sheetName,
      totalRows: rows.length,
      firstRows: rows.slice(0, 15)
    });
  }

  const groups = [];
  const schedule = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Стратегия A
    const strategyA = parseSheetStrategyA(sheetName, rows);
    if (strategyA && strategyA.length > 0) {
      groups.push(sheetName.trim());
      schedule[sheetName.trim()] = strategyA;
      console.log(`  ✅ A → ${sheetName}: ${strategyA.length} пар`);
      continue;
    }

    // Стратегия B
    const strategyB = parseSheetStrategyB(rows);
    if (strategyB) {
      for (const [g, pairs] of Object.entries(strategyB)) {
        if (!groups.includes(g)) groups.push(g);
        schedule[g] = (schedule[g] || []).concat(pairs);
      }
      console.log(`  ✅ B → ${sheetName}: ${Object.keys(strategyB).length} групп`);
      continue;
    }

    // Не распарсили — оставляем имя листа как группу с пустым массивом
    console.warn(`  ⚠️ Не распарсили лист "${sheetName}" (${rows.length} строк)`);
    groups.push(sheetName.trim());
    schedule[sheetName.trim()] = [];
  }

  return { groups, schedule, rawRows, debug };
}

// ===== Обновление кэша =====
async function updateScheduleCache(force = false) {
  const now = Date.now();
  if (!force && scheduleCache.data && (now - scheduleCache.lastUpdate) < SCHEDULE_CACHE_TTL) {
    return scheduleCache.data;
  }
  try {
    const fresh = await fetchScheduleFromYandex();
    scheduleCache.data = { groups: fresh.groups, schedule: fresh.schedule };
    scheduleCache.rawRows = fresh.rawRows;
    scheduleCache.debug = fresh.debug;
    scheduleCache.lastUpdate = now;
    console.log('✅ Расписание обновлено');
    return scheduleCache.data;
  } catch (e) {
    console.error('❌ Ошибка загрузки расписания:', e.message);
    if (scheduleCache.data) return scheduleCache.data;
    throw e;
  }
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

// ===== Store сессий =====
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

const DYNAMIC_HOSTING_PLATFORMS = [
  'jugem.jp',
  'blogspot.com', 'blogspot.nl', 'blogspot.ru', 'blogspot.de', 'blogspot.co.uk',
  'weebly.com', 'livejournal.com',
  'ucoz.com', 'ucoz.ru', 'homelinux.org',
  'freedomain.thehost.com.ua',
  'byethost.com', 'byethost16.com', 'byethost7.com',
  '000webhostapp.com', 'herokuapp.com', 'github.io',
  'netlify.app', 'pages.dev', 'glitch.me', 'repl.co'
];

const SUSPICIOUS_TLDS = ['icu', 'top', 'gq', 'ml', 'tk', 'cf', 'ga', 'click'];

function normalizeDomain(name) {
  let s = String(name).toLowerCase();
  const homoglyphs = { 'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','к':'k','в':'b','н':'h','м':'m','т':'t','і':'i','ї':'i','ё':'e','ѕ':'s','ј':'j','ԁ':'d' };
  s = s.split('').map(c => homoglyphs[c] || c).join('');
  return s.replace(/[-_]/g, '');
}

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

function isDynamicPhishing(domain) {
  const clean = domain.toLowerCase().replace(/^www\./, '');
  for (const platform of DYNAMIC_HOSTING_PLATFORMS) {
    if (clean.endsWith('.' + platform)) {
      const subdomain = clean.slice(0, -(platform.length + 1));
      if (/^[a-z0-9]{4,20}$/.test(subdomain) && /\d/.test(subdomain)) {
        if (!/(my|blog|test|dev|photo|travel|food|news|life|shop|site|home)/i.test(subdomain)) {
          return { platform, subdomain, reason: 'Рандомный поддомен на бесплатной платформе' };
        }
      }
      if (subdomain.length > 20) return { platform, subdomain, reason: 'Подозрительно длинный поддомен' };
    }
  }
  return null;
}

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

// ===== РАСПИСАНИЕ =====
app.get('/api/schedule/raw', async (req, res) => {
  try {
    await updateScheduleCache();
    res.json({ success: true, sheets: scheduleCache.rawRows });
  } catch (e) {
    res.status(500).json({ error: 'Не удалось загрузить файл', details: e.message });
  }
});

app.get('/api/schedule/debug', async (req, res) => {
  try {
    await updateScheduleCache();
    res.json({
      success: true,
      cache: {
        lastUpdate: scheduleCache.lastUpdate,
        groupsCount: scheduleCache.data ? scheduleCache.data.groups.length : 0,
        groups: scheduleCache.data ? scheduleCache.data.groups : []
      },
      debug: scheduleCache.debug
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка', details: e.message });
  }
});

app.get('/api/groups', async (req, res) => {
  try {
    const data = await updateScheduleCache();
    res.json(data.groups || []);
  } catch (e) {
    console.error('Ошибка /api/groups:', e.message);
    res.status(500).json({ error: 'Не удалось загрузить расписание', details: e.message });
  }
});

app.get('/api/schedule', async (req, res) => {
  const { group, date } = req.query;
  if (!group || !date) return res.status(400).json({ error: 'Укажите group и date' });

  const d = new Date(date);
  if (isNaN(d.getTime())) return res.status(400).json({ error: 'Некорректная дата' });
  const jsDay = d.getDay();
  const dow = jsDay === 0 ? 7 : jsDay;

  const dayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

  try {
    const data = await updateScheduleCache();
    const allPairs = (data.schedule && data.schedule[group]) || [];
    const pairs = allPairs
      .filter(p => p.day_of_week === dow)
      .sort((a, b) => a.pair_number - b.pair_number);

    res.json({
      group,
      date,
      dayOfWeek: dow,
      dayName: dayNames[dow],
      pairs,
      count: pairs.length
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка загрузки', details: e.message });
  }
});

app.get('/api/schedule/analyze', async (req, res) => {
  const { group } = req.query;
  if (!group) return res.status(400).json({ error: 'Укажите group' });

  const dayNames = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  try {
    const data = await updateScheduleCache();
    const allPairs = (data.schedule && data.schedule[group]) || [];
    const days = [];

    const toMin = t => {
      if (!t || t === '—') return 0;
      const [h, m] = String(t).split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };

    for (let dow = 1; dow <= 6; dow++) {
      const pairs = allPairs
        .filter(p => p.day_of_week === dow)
        .sort((a, b) => a.pair_number - b.pair_number);

      if (pairs.length === 0) {
        days.push({
          dayOfWeek: dow, dayName: dayNames[dow],
          count: 0, firstStart: null, lastEnd: null,
          gaps: 0, score: 0, verdict: 'свободен'
        });
        continue;
      }

      const firstStart = pairs[0].start_time;
      const lastEnd = pairs[pairs.length - 1].end_time;

      let gaps = 0;
      for (let i = 1; i < pairs.length; i++) {
        const prevEnd = toMin(pairs[i - 1].end_time);
        const curStart = toMin(pairs[i].start_time);
        if (prevEnd && curStart && curStart - prevEnd > 25) gaps++;
      }

      const endMinutes = toMin(lastEnd);
      const score = pairs.length * 100 + endMinutes + gaps * 50;

      let verdict = 'средний';
      if (pairs.length <= 2 && endMinutes && endMinutes <= 15 * 60) verdict = 'идеален для работы';
      else if (pairs.length <= 3 && endMinutes && endMinutes <= 16 * 60) verdict = 'хорош для работы';
      else if (pairs.length >= 4) verdict = 'загруженный';

      days.push({
        dayOfWeek: dow, dayName: dayNames[dow],
        count: pairs.length, firstStart, lastEnd,
        gaps, score, verdict
      });
    }

    const working = days.filter(d => d.count > 0).sort((a, b) => a.score - b.score);
    const bestDay = working[0] || null;

    res.json({
      group,
      days,
      bestDay,
      recommendation: bestDay
        ? `Лучший день для подработки — ${bestDay.dayName} (${bestDay.count} пар, до ${bestDay.lastEnd}).`
        : 'Нет данных для анализа.'
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка анализа', details: e.message });
  }
});

// ===== SSL-сертификат =====
function getSslCert(domain) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const socket = tls.connect({
      host: domain, port: 443, servername: domain,
      rejectUnauthorized: false, timeout: 6000
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
          daysLeft, san, isWildcard,
          fingerprint: cert.fingerprint || ''
        });
      } catch (e) { reject(e); }
    });
    socket.on('error', err => { if (finished) return; finished = true; reject(err); });
    socket.on('timeout', () => {
      if (finished) return; finished = true;
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

// ===== Health Check =====
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

// ===== EMAIL =====
app.get('/api/hibp/email/:email', async (req, res) => {
  const email = req.params.email;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Некорректный email' });
  try {
    const xonUrl = `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`;
    const response = await fetch(xonUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'KiberShield-Extension' }
    });
    if (response.status === 404) return res.json({ success: true, breaches: [] });
    if (!response.ok) return res.status(500).json({ error: 'Ошибка сервиса', status: response.status });
    const data = await response.json();
    const breachNames = data.breaches || data.Breaches || [];
    const breaches = breachNames.map(name => ({ Name: name, Title: name, BreachDate: '', PwnCount: null }));
    res.json({ success: true, breaches });
  } catch (e) {
    console.error('XposedOrNot ошибка:', e.message);
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
    'phishing-example.com','malware-site.ru','free-vbucks.net','steam-communlty.com','sberbank-online-vhod.ru',
    'casebatle.id','casbatle.com','casebattle.red','case-batlte.com','cases-batle.ru',
    'brevis.by','moneyatphone.top',
    'fastrefund.website','hmail1009.blogspot.nl','prizeme.com.ua','spleth.icu',
    'jugem.jp','100linksdvgpn.avafedors.freedomain.thehost.com.ua','6gyf.sionas.homelinux.org','driveron.ru','drivers.byethost16.com','files.truetds.icu','forum.jokke.ru','fqevj.kolomnatrud.ru','fsfll.fgawudownsyfuf.info','geforcesh.preumnoj.ru','gsmsignal.ru','hit-kino.com','hjpzt.rtk-sales.ru','ikbsk.bear-hunt.ru','maksiko.ru','msaav.radiofaiz.ru','opendrivers.ru','orav.info','pravoholding.ru','qsiub.atomproduction.ru','qwcxp.elcoleso.ru','vernaconsco.rutopik.ru','vihce.wilgood63.ru','xagoc.geo-meter.ru',
    'apponic.com','download-windows.org','downloadastro.com','1progs.ru','advanced-systemcare-com.ru','aktiv-windows.ucoz.com','andyroid.net','antikeys.org','bandicam-pro.ru','botdilofce.bandcamp.com','boxprograms.ru','chelcenter.ru','computta.com','crackheaps.com','crackpluskeygen.org','doublegames.ru','downloadelements.com','driveridentifier.com','drivers.org.ru','driverunpaid.ru','drp.su','filesdatabase4u.com','filehorse.com','freecrackpatch.com','fsm-portal.net','get.cryptobrowser.site','installpack.net','jeweell.com','kichkas.biz','kryptex.org','listid.ru','mediagetsite.com','mirsofta.ru','moiprogrammy.com','mwfix.ru','nikask.ru','nullthemedownload.com','nvidiadrivers.net','oneindir.com','oneprogs.ru','removal-virusguide.com','savow.com','serialms.com','smojem.ru','softkumir.ru','softportal.com','solvusoft.com','teramissu-hom.com','top-best-browser.ru','tvoiprogrammy.ru','ubar-pro4.ru','upantool.com','updatestar.com','vipmolik.net','virus4remove.com','w10-digital-activation-program.ru','winxpsoft.com','xeplayer.com','youtube.net.ua',
    'imei-poisk.ru','programmi-dlya-vzloma.com','17ebook.com','aladel.net','bpwhamburgorchardpark.org','clicnews.com','dfwdiesel.net','divineenterprises.net','fantasticfilms.ru','gardensrestaurantandcatering.com','ginedis.com','gncr.org','hdvideoforums.org','hihanin.com','kingfamilyphotoalbum.com','likaraoke.com','mactep.org','magic4you.nu','marbling.pe.kr','nacjalneg.info','pronline.ru','purplehoodie.com','qsng.cn','seksburada.net','sportsmansclub.net','stock888.cn','tathli.com','teamclouds.com','texaswhitetailfever.com','wadefamilytree.org','xnescat.info','yt118.com',
    'unvesouver39238.weebly.com'
  ];
  const SUSPICIOUS_PATTERNS = ['free-money','login-verify','account-confirm','paypal-secure','sberbank-online','gosuslugi-vhod'];

  if (BLACKLIST.some(b => cleanDomain.includes(b))) {
    verdict = 'dangerous';
    reasons.push('Домен в чёрном списке КиберЩит');
  }

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

  if (verdict === 'safe' && !isLegitimateBrand(cleanDomain)) {
    const dyn = isDynamicPhishing(cleanDomain);
    if (dyn) {
      verdict = 'suspicious';
      reasons.push(`Похоже на фишинг на платформе ${dyn.platform} (${dyn.reason})`);
    }
  }

  if (verdict === 'safe' && hasSuspiciousTLD(cleanDomain)) {
    verdict = 'suspicious';
    reasons.push(`Зона .${cleanDomain.split('.').pop()} часто используется мошенниками`);
  }

  if (SUSPICIOUS_PATTERNS.some(p => cleanDomain.includes(p))) {
    if (verdict === 'safe') verdict = 'suspicious';
    reasons.push('Подозрительное имя домена');
  }

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