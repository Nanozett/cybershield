const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const PORT = 3000;

const db = new sqlite3.Database('./cybershield.db');
db.run('PRAGMA foreign_keys = ON');

db.serialize(() => {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'user'
  )`, (err) => {
    if (err) console.error('Ошибка создания users:', err.message);
  });
  db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'", (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Ошибка добавления role:', err.message);
    }
  });

  // Программы
  db.run(`CREATE TABLE IF NOT EXISTS software (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    icon TEXT,
    pros TEXT,
    cons TEXT
  )`);

  // Комментарии к программам
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    software_id INTEGER,
    text TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(software_id) REFERENCES software(id)
  )`);

  // Темы форума
  db.run(`CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    content TEXT,
    closed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Сообщения форума
  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER,
    user_id INTEGER,
    content TEXT,
    pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(topic_id) REFERENCES topics(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  db.run("ALTER TABLE posts ADD COLUMN pinned INTEGER DEFAULT 0", (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Ошибка добавления pinned:', err.message);
    }
  });

  // Заявки на проверку программ
  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    description TEXT,
    download_url TEXT,
    status TEXT DEFAULT 'pending',
    review TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // История проверок из расширения
  db.run(`CREATE TABLE IF NOT EXISTS check_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    url TEXT,
    domain TEXT,
    verdict TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`, (err) => {
    if (err) console.error('Ошибка создания check_logs:', err.message);
  });

  // Начальные данные для программ
  db.get('SELECT COUNT(*) as count FROM software', (err, row) => {
    if (err) return console.error(err);
    if (row.count === 0) {
      const stmt = db.prepare(`INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)`);
      stmt.run('Kaspersky', 'shield', 'Высокий уровень детекции, Многофункциональный, Защита платежей', 'Платная версия, Нагрузка на систему');
      stmt.run('Bitdefender', 'bug', 'Легкий, Отличная защита в реальном времени, VPN в комплекте', 'Интерфейс перегружен, Сканы медленные');
      stmt.run('Malwarebytes', 'skull', 'Специализация на вредоносном ПО, Быстрое сканирование, Бесплатная версия', 'Нет постоянной защиты в бесплатной, Обнаруживает не все угрозы');
      stmt.finalize();
    }
  });
});

app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: 'secret-key-cybershield',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

// ===== АВТОРИЗАЦИЯ =====
app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const userRole = (role === 'moderator') ? 'moderator' : 'user';
    db.run(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, hash, userRole],
      function(err) {
        if (err) {
          console.error('Ошибка регистрации:', err.message);
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Пользователь с таким email или именем уже существует' });
          }
          return res.status(500).json({ error: 'Ошибка сервера при регистрации' });
        }
        req.session.userId = this.lastID;
        req.session.username = username;
        req.session.role = userRole;
        res.json({ success: true, username, role: userRole });
      }
    );
  } catch (err) {
    console.error('Ошибка хеширования:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Введите email и пароль' });
  }
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error('Ошибка входа:', err.message);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Неверный email или пароль' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    res.json({ success: true, username: user.username, role: user.role });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session.userId) {
    db.get('SELECT username, role FROM users WHERE id = ?', [req.session.userId], (err, row) => {
      if (err) {
        console.error('Ошибка получения пользователя:', err.message);
        return res.status(500).json({ error: 'Ошибка сервера' });
      }
      if (!row) {
        req.session.destroy();
        return res.json({ authenticated: false });
      }
      res.json({ authenticated: true, username: row.username, userId: req.session.userId, role: row.role });
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ===== ПРОГРАММЫ И КОММЕНТАРИИ =====
app.get('/api/software', (req, res) => {
  db.all('SELECT * FROM software', (err, software) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    let completed = 0;
    const result = [];

    software.forEach((prog, index) => {
      db.all(
        `SELECT comments.*, users.username 
         FROM comments 
         JOIN users ON comments.user_id = users.id 
         WHERE comments.software_id = ? 
         ORDER BY comments.created_at DESC`,
        [prog.id],
        (err, comments) => {
          if (err) comments = [];
          const progObj = {
            id: prog.id,
            name: prog.name,
            icon: prog.icon,
            pros: prog.pros ? prog.pros.split(', ') : [],
            cons: prog.cons ? prog.cons.split(', ') : [],
            comments: comments.map(c => ({
              id: c.id,
              userId: c.user_id,
              username: c.username,
              text: c.text,
              created_at: c.created_at
            }))
          };
          result[index] = progObj;
          completed++;
          if (completed === software.length) {
            result.sort((a, b) => a.id - b.id);
            res.json(result);
          }
        }
      );
    });
  });
});

app.post('/api/comments', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const { softwareId, text } = req.body;
  if (!softwareId || !text) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  db.run(
    'INSERT INTO comments (user_id, software_id, text) VALUES (?, ?, ?)',
    [req.session.userId, softwareId, text],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ success: true, commentId: this.lastID });
    }
  );
});

app.delete('/api/comments/:id', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const commentId = req.params.id;
  db.get('SELECT user_id FROM comments WHERE id = ?', [commentId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!row) return res.status(404).json({ error: 'Комментарий не найден' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    db.run('DELETE FROM comments WHERE id = ?', [commentId], function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ success: true });
    });
  });
});

// ===== ФОРУМ =====
app.get('/api/topics', (req, res) => {
  db.all(`
    SELECT topics.*, users.username,
      (SELECT COUNT(*) FROM posts WHERE posts.topic_id = topics.id) as post_count
    FROM topics
    JOIN users ON topics.user_id = users.id
    ORDER BY topics.created_at DESC
  `, (err, topics) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(topics);
  });
});

app.post('/api/topics', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Заполните заголовок и содержание' });
  }
  db.run(
    'INSERT INTO topics (user_id, title, content) VALUES (?, ?, ?)',
    [req.session.userId, title, content],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ success: true, topicId: this.lastID });
    }
  );
});

app.get('/api/topics/:id', (req, res) => {
  const topicId = req.params.id;
  db.get('SELECT * FROM topics WHERE id = ?', [topicId], (err, topic) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!topic) return res.status(404).json({ error: 'Тема не найдена' });
    db.all(`
      SELECT posts.*, users.username
      FROM posts
      JOIN users ON posts.user_id = users.id
      WHERE posts.topic_id = ?
      ORDER BY posts.pinned DESC, posts.created_at ASC
    `, [topicId], (err, posts) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ topic, posts });
    });
  });
});

app.post('/api/posts', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const { topicId, content } = req.body;
  if (!topicId || !content) {
    return res.status(400).json({ error: 'Не все поля заполнены' });
  }
  db.get('SELECT closed FROM topics WHERE id = ?', [topicId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!row) return res.status(404).json({ error: 'Тема не найдена' });
    if (row.closed === 1 && req.session.role !== 'moderator') {
      return res.status(403).json({ error: 'Тема закрыта для ответов' });
    }
    db.run(
      'INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)',
      [topicId, req.session.userId, content],
      function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        res.json({ success: true, postId: this.lastID });
      }
    );
  });
});

app.delete('/api/posts/:id', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const postId = req.params.id;
  db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!row) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    db.run('DELETE FROM posts WHERE id = ?', [postId], function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ success: true });
    });
  });
});

app.patch('/api/posts/:id/pin', (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') {
    return res.status(403).json({ error: 'Доступ только для модераторов' });
  }
  const postId = req.params.id;
  const { pinned } = req.body;
  db.run('UPDATE posts SET pinned = ? WHERE id = ?', [pinned, postId], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (this.changes === 0) return res.status(404).json({ error: 'Сообщение не найдено' });
    res.json({ success: true });
  });
});

app.patch('/api/topics/:id/close', (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') {
    return res.status(403).json({ error: 'Доступ только для модераторов' });
  }
  const topicId = req.params.id;
  const { closed } = req.body;
  db.run('UPDATE topics SET closed = ? WHERE id = ?', [closed, topicId], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (this.changes === 0) return res.status(404).json({ error: 'Тема не найдена' });
    res.json({ success: true });
  });
});

app.delete('/api/topics/:id', (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') {
    return res.status(403).json({ error: 'Доступ только для модераторов' });
  }
  const topicId = req.params.id;
  db.run('DELETE FROM posts WHERE topic_id = ?', [topicId], (err) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    db.run('DELETE FROM topics WHERE id = ?', [topicId], function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (this.changes === 0) return res.status(404).json({ error: 'Тема не найдена' });
      res.json({ success: true });
    });
  });
});

// ===== ЗАЯВКИ НА ПРОВЕРКУ ПРОГРАММ =====
app.post('/api/submissions', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const { name, description, download_url } = req.body;
  if (!name || !description || !download_url) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  db.run(
    'INSERT INTO submissions (user_id, name, description, download_url) VALUES (?, ?, ?, ?)',
    [req.session.userId, name, description, download_url],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json({ success: true, submissionId: this.lastID });
    }
  );
});

app.get('/api/submissions', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const isModerator = req.session.role === 'moderator';
  let query = `
    SELECT submissions.*, users.username 
    FROM submissions 
    JOIN users ON submissions.user_id = users.id
  `;
  if (!isModerator) {
    query += ' WHERE submissions.user_id = ?';
  }
  query += ' ORDER BY submissions.created_at DESC';
  const params = isModerator ? [] : [req.session.userId];
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json(rows);
  });
});

app.get('/api/submissions/:id', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const id = req.params.id;
  db.get(`
    SELECT submissions.*, users.username 
    FROM submissions 
    JOIN users ON submissions.user_id = users.id 
    WHERE submissions.id = ?
  `, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
    if (row.user_id !== req.session.userId && req.session.role !== 'moderator') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    res.json(row);
  });
});

app.patch('/api/submissions/:id', (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') {
    return res.status(403).json({ error: 'Только модератор может изменять статус' });
  }
  const id = req.params.id;
  const { status, review } = req.body;
  if (!status || !['pending', 'approved', 'rejected', 'reviewed'].includes(status)) {
    return res.status(400).json({ error: 'Некорректный статус' });
  }
  db.run(
    'UPDATE submissions SET status = ?, review = ? WHERE id = ?',
    [status, review || null, id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      if (this.changes === 0) return res.status(404).json({ error: 'Заявка не найдена' });
      res.json({ success: true });
    }
  );
});

app.post('/api/submissions/:id/approve', (req, res) => {
  if (!req.session.userId || req.session.role !== 'moderator') {
    return res.status(403).json({ error: 'Только модератор может одобрить' });
  }
  const id = req.params.id;
  const { pros, cons, review } = req.body;
  if (!pros || !cons) {
    return res.status(400).json({ error: 'Укажите плюсы и минусы' });
  }
  db.get('SELECT name FROM submissions WHERE id = ?', [id], (err, submission) => {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    if (!submission) return res.status(404).json({ error: 'Заявка не найдена' });
    db.run(
      'INSERT INTO software (name, icon, pros, cons) VALUES (?, ?, ?, ?)',
      [submission.name, 'shield', pros, cons],
      function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка при добавлении программы' });
        db.run(
          'UPDATE submissions SET status = ?, review = ? WHERE id = ?',
          ['approved', review || null, id],
          function(err) {
            if (err) return res.status(500).json({ error: 'Ошибка обновления заявки' });
            res.json({ success: true, softwareId: this.lastID });
          }
        );
      }
    );
  });
});

// ===== WHOIS/RDAP — получение даты регистрации домена =====
app.get('/api/whois/:domain', async (req, res) => {
  const domain = req.params.domain;
  if (!domain) return res.status(400).json({ error: 'Домен не указан' });

  // Локальные адреса не проверяем
  const cleanDomain = domain.toLowerCase();
  if (cleanDomain === 'localhost' || cleanDomain === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(cleanDomain)) {
    return res.status(404).json({ error: 'Локальный адрес — WHOIS не применим' });
  }

  try {
    const rdapUrl = `https://rdap.org/domain/${domain}`;
    const response = await fetch(rdapUrl, {
      headers: { 'Accept': 'application/json' },
      redirect: 'follow'
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'RDAP не вернул данные', status: response.status });
    }

    const data = await response.json();
    const events = data.events || [];
    const registration = events.find(e => e.eventAction === 'registration');

    if (!registration || !registration.eventDate) {
      return res.status(404).json({ error: 'Дата регистрации не найдена' });
    }

    res.json({
      success: true,
      domain,
      year: new Date(registration.eventDate).getFullYear(),
      fullDate: registration.eventDate.slice(0, 10)
    });
  } catch (e) {
    console.error('WHOIS ошибка для', domain, ':', e.message);
    res.status(500).json({ error: 'Не удалось получить данные', details: e.message });
  }
});

// ===== ПРОВЕРКА САЙТОВ (для расширения) =====
app.post('/api/check', (req, res) => {
  const { url, domain } = req.body;
  if (!url || !domain) return res.status(400).json({ error: 'Не указан URL' });

  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');

  // ===== 0. ЛОКАЛЬНЫЕ АДРЕСА — сразу в белый список =====
  const LOCAL_SITES = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  const isLocal =
    LOCAL_SITES.includes(cleanDomain) ||
    /^192\.168\.\d+\.\d+$/.test(cleanDomain) ||
    /^10\.\d+\.\d+\.\d+$/.test(cleanDomain) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(cleanDomain) ||
    cleanDomain.endsWith('.local') ||
    cleanDomain.endsWith('.test') ||
    cleanDomain.endsWith('.localhost');

  if (isLocal) {
    return res.json({
      verdict: 'safe',
      reasons: ['Локальный адрес — свой проект']
    });
  }

  // ===== 1. ГОССАЙТЫ =====
  const GOVERNMENT_SITES = [
    'fsb.ru', 'mvd.ru', 'mil.ru', 'rosguard.gov.ru',
    'kremlin.ru', 'government.ru', 'gov.ru',
    'gosuslugi.ru', 'nalog.gov.ru', 'nalog.ru',
    'pfr.gov.ru', 'sfr.gov.ru', 'cbr.ru',
    'vsrf.ru', 'genproc.gov.ru', 'sudrf.ru',
    'rkn.gov.ru', 'rospotrebnadzor.ru',
    'edu.gov.ru', 'minzdrav.gov.ru',
    'duma.gov.ru', 'cikrf.ru', 'mchs.gov.ru'
  ];

  const isGov = GOVERNMENT_SITES.some(site => {
    const cleanSite = site.toLowerCase().replace(/^www\./, '');
    return cleanDomain === cleanSite || cleanDomain.endsWith('.' + cleanSite);
  });

  if (isGov) {
    return res.json({
      verdict: 'government',
      reasons: ['Официальный сайт государственного органа РФ']
    });
  }

  // ===== 2. ОБЫЧНАЯ ПРОВЕРКА =====
  let verdict = 'safe';
  const reasons = [];

  const BLACKLIST = [
    'phishing-example.com',
    'malware-site.ru',
    'free-vbucks.net',
    'steam-communlty.com',
    'sberbank-online-vhod.ru'
  ];
  const SUSPICIOUS_PATTERNS = [
    'free-money', 'login-verify', 'account-confirm',
    'paypal-secure', 'sberbank-online', 'gosuslugi-vhod'
  ];

  if (BLACKLIST.some(b => cleanDomain.includes(b))) {
    verdict = 'dangerous';
    reasons.push('Домен в чёрном списке КиберЩит');
  }

  if (SUSPICIOUS_PATTERNS.some(p => cleanDomain.includes(p))) {
    if (verdict === 'safe') verdict = 'suspicious';
    reasons.push('Подозрительное имя домена');
  }

  if (url.startsWith('http://')) {
    if (verdict === 'safe') verdict = 'suspicious';
    reasons.push('Соединение без HTTPS');
  }

  res.json({ verdict, reasons });
});

// ===== СИНХРОНИЗАЦИЯ ИСТОРИИ ИЗ РАСШИРЕНИЯ =====
app.post('/api/check/sync', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  const { history } = req.body;
  if (!Array.isArray(history)) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  const stmt = db.prepare('INSERT INTO check_logs (user_id, url, domain, verdict) VALUES (?, ?, ?, ?)');
  const limited = history.slice(0, 50);
  limited.forEach(item => {
    stmt.run(req.session.userId, item.url || '', item.domain || '', item.verdict || 'unknown');
  });
  stmt.finalize();

  res.json({ success: true, synced: limited.length });
});

// ===== ИСТОРИЯ ПРОВЕРОК ПОЛЬЗОВАТЕЛЯ =====
app.get('/api/check/history', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  db.all(
    'SELECT * FROM check_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.session.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Ошибка сервера' });
      res.json(rows);
    }
  );
});

app.delete('/api/check/history', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  db.run('DELETE FROM check_logs WHERE user_id = ?', [req.session.userId], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка сервера' });
    res.json({ success: true, deleted: this.changes });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});