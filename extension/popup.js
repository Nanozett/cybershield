const SERVER_URL = 'https://cybershield-cyan.vercel.app';

document.addEventListener('DOMContentLoaded', () => {
  loadCurrentStatus();
  loadHistory();
  loadCookiesForCurrentTab();
  loadSslForCurrentTab();
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
    document.getElementById('openScannerBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('scanner.html') });
});
  });
  document.getElementById('deleteCookiesBtn').addEventListener('click', deleteAllCookies);

  document.querySelectorAll('.menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openUrl', url: `${SERVER_URL}/#${btn.dataset.page}` });
      window.close();
    });
  });
}

// ========== СТАТУС ==========
function loadCurrentStatus() {
  let responded = false;
  const guardTimer = setTimeout(() => {
    if (responded) return;
    responded = true;
    renderStatus({ verdict: 'unknown', reasons: ['Проверка заняла слишком много времени'], creationInfo: null, ipInfo: null });
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
      renderStatus({ verdict: 'unknown', reasons: ['Ошибка связи'], creationInfo: null, ipInfo: null });
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

// ========== ТРЕКЕРЫ ==========
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

// ========== COOKIES ==========
function loadCookiesForCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
      renderCookies([], null);
      return;
    }
    let siteDomain = '';
    try { siteDomain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch (e) {}

    chrome.cookies.getAll({ url: tab.url }, (cookies) => {
      if (chrome.runtime.lastError) { renderCookies([], siteDomain); return; }
      const list = (cookies || []).map(c => {
        const cDomain = (c.domain || '').replace(/^\./, '');
        const isThirdParty = !(siteDomain === cDomain || siteDomain.endsWith('.' + cDomain) || cDomain.endsWith('.' + siteDomain));
        return {
          name: c.name,
          domain: c.domain,
          secure: c.secure,
          httpOnly: c.httpOnly,
          session: c.session,
          expirationDate: c.expirationDate || null,
          isThirdParty
        };
      });
      renderCookies(list, siteDomain);
    });
  });
}

function renderCookies(cookies, siteDomain) {
  const section = document.getElementById('cookiesSection');
  if (!siteDomain) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const total = cookies.length;
  const third = cookies.filter(c => c.isThirdParty).length;
  const first = total - third;

  document.getElementById('cookieStats').innerHTML = `
    <div class="cookie-stat-box">
      <div class="cookie-stat-num">${total}</div>
      <div class="cookie-stat-label">Всего</div>
    </div>
    <div class="cookie-stat-box ${first > 0 ? 'ok' : ''}">
      <div class="cookie-stat-num">${first}</div>
      <div class="cookie-stat-label">Свои</div>
    </div>
    <div class="cookie-stat-box ${third > 0 ? 'danger' : ''}">
      <div class="cookie-stat-num">${third}</div>
      <div class="cookie-stat-label">Чужие</div>
    </div>
  `;

  const list = document.getElementById('cookieList');
  if (cookies.length === 0) {
    list.innerHTML = '<div class="cookie-empty">Cookies не найдены</div>';
    return;
  }
  // Сортируем: сначала третьесторонние
  cookies.sort((a, b) => (b.isThirdParty ? 1 : 0) - (a.isThirdParty ? 1 : 0));
  list.innerHTML = cookies.slice(0, 30).map(c => `
    <div class="cookie-item" title="${c.domain}">
      <div class="cookie-dot ${c.isThirdParty ? 'third' : ''}"></div>
      <div class="cookie-name">${escapeHtml(c.name)}</div>
      <div class="cookie-domain">${escapeHtml((c.domain || '').slice(0, 20))}</div>
    </div>
  `).join('');
}

function deleteAllCookies() {
  if (!confirm('Удалить все cookies этого сайта?')) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;
    chrome.cookies.getAll({ url: tab.url }, (cookies) => {
      if (!cookies || !cookies.length) {
        alert('Нет cookies для удаления');
        return;
      }
      let done = 0, deleted = 0;
      cookies.forEach(c => {
        const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
        chrome.cookies.remove({ url, name: c.name }, () => {
          done++;
          if (!chrome.runtime.lastError) deleted++;
          if (done === cookies.length) {
            alert(`Удалено cookies: ${deleted}`);
            loadCookiesForCurrentTab();
          }
        });
      });
    });
  });
}

// ========== SSL ==========
function loadSslForCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.startsWith('https://')) {
      document.getElementById('sslSection').style.display = 'none';
      return;
    }
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch (e) { return; }
    if (!domain) return;

    fetch(`${SERVER_URL}/api/ssl/${domain}`)
      .then(r => r.json())
      .then(data => {
        if (data && data.success) renderSsl(data);
        else document.getElementById('sslSection').style.display = 'none';
      })
      .catch(() => document.getElementById('sslSection').style.display = 'none');
  });
}

function renderSsl(data) {
  const section = document.getElementById('sslSection');
  section.style.display = 'block';

  const daysLeft = data.daysLeft || 0;
  let badge = { text: 'OK', class: 'ok' };
  let daysClass = 'ok';
  if (daysLeft < 0) { badge = { text: 'Истёк', class: 'danger' }; daysClass = 'danger'; }
  else if (daysLeft < 14) { badge = { text: 'Скоро истечёт', class: 'warn' }; daysClass = 'warn'; }

  const badgeEl = document.getElementById('sslBadge');
  badgeEl.textContent = badge.text;
  badgeEl.className = 'ssl-badge ' + badge.class;

  const knownIssuers = [
    "Let's Encrypt", 'DigiCert', 'GlobalSign', 'Sectigo', 'Comodo',
    'Cloudflare', 'Google Trust Services', 'GoDaddy', 'Amazon',
    'Microsoft', 'Certum', 'Buypass', 'ZeroSSL'
  ];
  const issuer = data.issuer || 'Неизвестно';
  const isKnownIssuer = knownIssuers.some(k => issuer.toLowerCase().includes(k.toLowerCase()));
  const issuerClass = isKnownIssuer ? 'ok' : 'warn';

  const sanList = (data.san || []).slice(0, 3).join(', ');
  const moreSan = (data.san || []).length > 3 ? ` +${data.san.length - 3}` : '';

  document.getElementById('sslInfo').innerHTML = `
    <div class="ssl-row">
      <span class="ssl-label">Издатель</span>
      <span class="ssl-value ${issuerClass}">${escapeHtml(issuer)}</span>
    </div>
    <div class="ssl-row">
      <span class="ssl-label">Выдан для</span>
      <span class="ssl-value">${escapeHtml(data.subject || '—')}</span>
    </div>
    <div class="ssl-row">
      <span class="ssl-label">Действует до</span>
      <span class="ssl-value">${escapeHtml(data.validTo || '—')}</span>
    </div>
    <div class="ssl-row">
      <span class="ssl-label">Осталось дней</span>
      <span class="ssl-value ${daysClass}">${daysLeft}</span>
    </div>
    ${data.isWildcard ? `
    <div class="ssl-row">
      <span class="ssl-label">Wildcard</span>
      <span class="ssl-value warn">⚠️ *.${escapeHtml(data.subject || '')}</span>
    </div>` : ''}
    ${sanList ? `
    <div class="ssl-row">
      <span class="ssl-label">Покрывает</span>
      <span class="ssl-value">${escapeHtml(sanList)}${moreSan}</span>
    </div>` : ''}
  `;
}

// ========== SITE CARD ==========
function renderSiteCard(creationInfo, ipInfo) {
  const section = document.getElementById('siteCardSection');
  const info = document.getElementById('siteInfo');
  const rows = [];
  if (ipInfo && ipInfo.ip) rows.push(`<div class="site-row"><span class="site-label">IP-адрес</span><span class="site-value">${ipInfo.ip}</span></div>`);
  if (ipInfo && ipInfo.country) {
    const flag = ipInfo.countryCode ? getFlagEmoji(ipInfo.countryCode) : '';
    rows.push(`<div class="site-row"><span class="site-label">Страна</span><span class="site-value">${flag} ${ipInfo.country}</span></div>`);
  }
  if (ipInfo && ipInfo.city) rows.push(`<div class="site-row"><span class="site-label">Город</span><span class="site-value">${ipInfo.city}</span></div>`);
  if (ipInfo && ipInfo.org) rows.push(`<div class="site-row"><span class="site-label">Хостинг</span><span class="site-value">${ipInfo.org}</span></div>`);
  if (creationInfo && creationInfo.fullDate) rows.push(`<div class="site-row"><span class="site-label">Дата регистрации</span><span class="site-value">${creationInfo.fullDate}</span></div>`);

  if (rows.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  info.innerHTML = rows.join('');
}

function getFlagEmoji(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)));
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

// ========== EMAIL ==========
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
        <div class="breach-item"><strong>${escapeHtml(b.Name || b.Title || 'Утечка')}</strong></div>
      `).join('')}
    `;
  });
}

// ========== PASSWORD GENERATOR ==========
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

// ========== HISTORY ==========
function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    const list = document.getElementById('historyList');
    const history = (response && response.history) || [];
    if (!history.length) {
      list.innerHTML = '<div class="empty">История пуста</div>';
      return;
    }
    list.innerHTML = history.slice(0, 15).map(item => `
      <div class="history-item" title="${escapeHtml(item.url || '')}">
        <div class="history-dot ${item.verdict}"></div>
        <div class="history-domain">${escapeHtml(item.domain || '')}</div>
      </div>
    `).join('');
  });
}

function clearHistory() {
  if (!confirm('Очистить историю?')) return;
  chrome.runtime.sendMessage({ action: 'clearHistory' }, () => loadHistory());
}

// ========== SYNC ==========
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

// ========== HELPERS ==========
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}