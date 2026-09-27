const SERVER_URL = 'https://cybershield-cyan.vercel.app';

document.addEventListener('DOMContentLoaded', () => {
  loadCurrentStatus();
  loadHistory();
  bindEvents();
});

function bindEvents() {
  document.getElementById('generateBtn').addEventListener('click', generatePassword);
  document.getElementById('copyBtn').addEventListener('click', copyPassword);
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
  document.getElementById('syncBtn').addEventListener('click', syncNow);
  document.getElementById('checkEmailBtn').addEventListener('click', checkEmail);
  document.getElementById('emailInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkEmail();
  });
  document.getElementById('openDashboardBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openDashboard' });
  });

  document.querySelectorAll('.menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openUrl', url: `${SERVER_URL}/#${btn.dataset.page}` });
      window.close();
    });
  });
}

// ===== Загрузка статуса с таймаутом =====
function loadCurrentStatus() {
  let responded = false;

  // Защитный таймер: если через 6 секунд ответа нет — показываем «неизвестно»
  const guardTimer = setTimeout(() => {
    if (responded) return;
    responded = true;
    renderStatus({
      verdict: 'unknown',
      reasons: ['Проверка заняла слишком много времени'],
      creationInfo: null,
      ipInfo: null
    });
  }, 6000);

  try {
    chrome.runtime.sendMessage({ action: 'getCurrentStatus' }, (response) => {
      if (responded) return;
      responded = true;
      clearTimeout(guardTimer);

      if (chrome.runtime.lastError || !response) {
        renderStatus({ verdict: 'unknown', reasons: ['Не удалось получить статус'], creationInfo: null, ipInfo: null });
        return;
      }
      renderStatus(response);
    });
  } catch (e) {
    clearTimeout(guardTimer);
    if (!responded) {
      responded = true;
      renderStatus({ verdict: 'unknown', reasons: ['Ошибка связи с background'], creationInfo: null, ipInfo: null });
    }
  }
}

function renderStatus(data) {
  const card = document.getElementById('statusCard');
  card.className = 'status-card ' + (data.verdict || 'unknown');

  const map = {
    safe: { icon: '✓', title: 'Сайт безопасен' },
    suspicious: { icon: '!', title: 'Подозрительный сайт' },
    dangerous: { icon: '✕', title: 'Опасный сайт!' },
    government: { icon: '★', title: 'Официальный сайт РФ' },
    unknown: { icon: '?', title: 'Статус неизвестен' }
  };
  const m = map[data.verdict] || map.unknown;
  document.getElementById('statusIcon').textContent = m.icon;
  document.getElementById('statusTitle').textContent = m.title;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      try { document.getElementById('statusDomain').textContent = new URL(tabs[0].url).hostname; }
      catch { document.getElementById('statusDomain').textContent = tabs[0].url; }
    }
  });

  const reasons = document.getElementById('statusReasons');
  if (data.verdict === 'government') {
    reasons.textContent = 'Не пугайся, это госсайт. Но не задерживайся тут долго 😉';
  } else {
    reasons.textContent = (data.reasons && data.reasons.length) ? data.reasons.join(' • ') : '';
  }

  renderTrackers(data.trackerCount || 0, data.trackersByDomain || {});
  renderSiteCard(data.creationInfo, data.ipInfo);
  renderCreation(data.creationInfo);
}

function renderTrackers(count, byDomain) {
  const section = document.getElementById('trackerSection');
  if (!count) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  document.getElementById('trackerCount').textContent = count;

  const list = document.getElementById('trackerList');
  const entries = Object.entries(byDomain).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    list.innerHTML = '<div style="opacity:0.8;">Трекеров не обнаружено</div>';
    return;
  }
  list.innerHTML = entries.map(([domain, cnt]) =>
    `<div class="tracker-item"><span>${domain}</span><span>${cnt}</span></div>`
  ).join('');
}

function renderSiteCard(creationInfo, ipInfo) {
  const section = document.getElementById('siteCardSection');
  const info = document.getElementById('siteInfo');
  const rows = [];

  if (ipInfo && ipInfo.ip) {
    rows.push(`<div class="site-row"><span class="site-label">IP-адрес</span><span class="site-value">${ipInfo.ip}</span></div>`);
  }
  if (ipInfo && ipInfo.country) {
    const flag = ipInfo.countryCode ? getFlagEmoji(ipInfo.countryCode) : '';
    rows.push(`<div class="site-row"><span class="site-label">Страна</span><span class="site-value">${flag} ${ipInfo.country}</span></div>`);
  }
  if (ipInfo && ipInfo.city) {
    rows.push(`<div class="site-row"><span class="site-label">Город</span><span class="site-value">${ipInfo.city}</span></div>`);
  }
  if (ipInfo && ipInfo.org) {
    rows.push(`<div class="site-row"><span class="site-label">Хостинг</span><span class="site-value">${ipInfo.org}</span></div>`);
  }
  if (creationInfo && creationInfo.fullDate) {
    rows.push(`<div class="site-row"><span class="site-label">Дата регистрации</span><span class="site-value">${creationInfo.fullDate}</span></div>`);
  }

  if (rows.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  info.innerHTML = rows.join('');
}

function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = countryCode.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function renderCreation(creationInfo) {
  const section = document.getElementById('creationSection');
  const year = document.getElementById('creationYear');
  const age = document.getElementById('creationAge');

  if (creationInfo && creationInfo.year) {
    section.style.display = 'block';
    year.textContent = creationInfo.year;
    const regDate = new Date(creationInfo.fullDate);
    const ageDays = Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24));
    let text = '', color = '';
    if (ageDays < 30) { text = `⚠️ ${ageDays} дн. — высокий риск`; color = '#e74c3c'; }
    else if (ageDays < 365) { text = `⏳ ${ageDays} дн. — молодой домен`; color = '#f39c12'; }
    else { text = `✅ ${Math.floor(ageDays / 365)} лет — надёжный`; color = '#2ecc71'; }
    age.textContent = text;
    age.style.color = color;
  } else {
    section.style.display = 'none';
  }
}

// ===== Email =====
async function checkEmail() {
  const email = document.getElementById('emailInput').value.trim();
  const result = document.getElementById('emailResult');
  if (!email || !email.includes('@')) {
    result.innerHTML = '<div style="color:#e74c3c;">Введите корректный email</div>';
    return;
  }
  result.innerHTML = '<div style="color:#64748b;">⏳ Проверяем...</div>';
  chrome.runtime.sendMessage({ action: 'checkEmail', email }, (response) => {
    if (!response || !response.success) {
      result.innerHTML = `<div style="color:#e74c3c;">Ошибка: ${response?.error || 'неизвестно'}</div>`;
      return;
    }
    if (!response.breaches || response.breaches.length === 0) {
      result.innerHTML = '<div class="no-breaches">✅ Email не найден в известных утечках</div>';
      return;
    }
    result.innerHTML = `
      <div style="margin-bottom:6px;font-weight:600;color:#991b1b;">Найден в ${response.breaches.length} утечках:</div>
      ${response.breaches.slice(0, 5).map(b => `
        <div class="breach-item">
          <strong>${b.Name || b.Title || 'Утечка'}</strong>
        </div>
      `).join('')}
    `;
  });
}

// ===== Генератор паролей =====
function generatePassword() {
  const length = parseInt(document.getElementById('passLength').value) || 16;
  const upper = document.getElementById('useUpper').checked;
  const lower = document.getElementById('useLower').checked;
  const digits = document.getElementById('useDigits').checked;
  const symbols = document.getElementById('useSymbols').checked;
  let chars = '';
  if (upper) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  if (lower) chars += 'abcdefghijkmnpqrstuvwxyz';
  if (digits) chars += '23456789';
  if (symbols) chars += '!@#$%^&*()-_=+[]{}';
  if (!chars) { document.getElementById('generatedPassword').value = 'Выберите набор'; return; }
  let pass = '';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) pass += chars[arr[i] % chars.length];
  document.getElementById('generatedPassword').value = pass;
}

function copyPassword() {
  const input = document.getElementById('generatedPassword');
  if (!input.value || input.value.startsWith('Нажмите') || input.value.startsWith('Выберите')) return;
  input.select();
  document.execCommand('copy');
  const btn = document.getElementById('copyBtn');
  const original = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => btn.textContent = original, 1500);
}

// ===== История =====
function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    const list = document.getElementById('historyList');
    const history = (response && response.history) || [];
    if (!history.length) {
      list.innerHTML = '<div class="empty">История пуста</div>';
      return;
    }
    list.innerHTML = history.slice(0, 15).map(item => `
      <div class="history-item" title="${item.url}">
        <div class="history-dot ${item.verdict}"></div>
        <div class="history-domain">${item.domain}</div>
      </div>
    `).join('');
  });
}

function clearHistory() {
  if (!confirm('Очистить историю?')) return;
  chrome.runtime.sendMessage({ action: 'clearHistory' }, () => loadHistory());
}

// ===== Синхронизация =====
function syncNow() {
  const btn = document.getElementById('syncBtn');
  btn.textContent = '⏳ Синхронизация...';
  btn.disabled = true;
  chrome.runtime.sendMessage({ action: 'syncWithServer' }, (response) => {
    btn.disabled = false;
    btn.textContent = (response && response.success) ? '✅ Синхронизировано' : '❌ ' + ((response && response.error) || 'Ошибка');
    setTimeout(() => btn.textContent = '🔄 Синхронизировать с сайтом', 2500);
  });
}