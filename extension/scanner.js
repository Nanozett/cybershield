// scanner.js — сканер безопасности браузера

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refreshBtn').addEventListener('click', runScan);
  runScan();
});

let allChecks = [];

async function runScan() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Сканируем...';
  document.getElementById('checksContainer').innerHTML = '<div class="loading">⏳ Собираем данные о браузере...</div>';
  document.getElementById('scoreNum').textContent = '—';
  document.getElementById('scoreVerdict').textContent = 'Сканируем...';

  try {
    allChecks = [];
    await checkPrivacy();
    await checkBrowsing();
    await checkPasswords();
    await checkExtensions();
    await checkBrowser();
    renderResults();
  } catch (e) {
    console.error('Ошибка сканирования:', e);
    document.getElementById('checksContainer').innerHTML = '<div class="loading">Ошибка сканирования. Попробуйте ещё раз.</div>';
  }

  btn.disabled = false;
  btn.textContent = '🔄 Пересканировать';
}

// ===== Хелпер для чтения chrome.privacy =====
function privacyGet(apiObj) {
  return new Promise((resolve) => {
    try {
      apiObj.get({}, (d) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(d ? d.value : null);
      });
    } catch (e) { resolve(null); }
  });
}

function addCheck(category, id, title, status, description, recommendation) {
  allChecks.push({ category, id, title, status, description, recommendation });
}

// ===== ПРИВАТНОСТЬ =====
async function checkPrivacy() {
  // 1. Сторонние cookies
  const tpc = await privacyGet(chrome.privacy.websites.thirdPartyCookiesAllowed);
  if (tpc === null) {
    addCheck('Приватность', 'thirdPartyCookies', 'Сторонние cookies', 'na', 'Не удалось проверить', '');
  } else if (tpc === false) {
    addCheck('Приватность', 'thirdPartyCookies', 'Сторонние cookies', 'ok',
      '✓ Сторонние cookies заблокированы', '');
  } else {
    addCheck('Приватность', 'thirdPartyCookies', 'Сторонние cookies', 'fail',
      '✗ Сторонние cookies разрешены',
      'Настройки → Конфиденциальность и безопасность → Сторонние cookies → «Заблокировать сторонние cookies». Это мешает рекламным сетям следить за вами между сайтами.');
  }

  // 2. Do Not Track
  const dnt = await privacyGet(chrome.privacy.websites.doNotTrackEnabled);
  if (dnt === null) {
    addCheck('Приватность', 'dnt', 'Do Not Track', 'na', 'Не удалось проверить', '');
  } else if (dnt === true) {
    addCheck('Приватность', 'dnt', 'Do Not Track', 'ok', '✓ DNT отправляется сайтам', '');
  } else {
    addCheck('Приватность', 'dnt', 'Do Not Track', 'warn',
      '⚠️ DNT не отправляется',
      'Настройки → Конфиденциальность → «Отправлять сайтам запрос «Не отслеживать»». Большинство сайтов игнорируют, но некоторые уважают.');
  }

  // 3. Referrers
  const ref = await privacyGet(chrome.privacy.websites.referrersEnabled);
  if (ref === null) {
    addCheck('Приватность', 'referrers', 'HTTP Referrers', 'na', 'Не удалось проверить', '');
  } else if (ref === false) {
    addCheck('Приватность', 'referrers', 'HTTP Referrers', 'ok', '✓ Referrer не передаётся', '');
  } else {
    addCheck('Приватность', 'referrers', 'HTTP Referrers', 'warn',
      '⚠️ Referrer передаётся сайтам',
      'Сайты видят, откуда вы пришли. Отключить: Настройки → Приватность → «Передавать URL страницы, с которой вы перешли».');
  }

  // 4. Hyperlink Auditing
  const audit = await privacyGet(chrome.privacy.websites.hyperlinkAuditingEnabled);
  if (audit === null) {
    addCheck('Приватность', 'hyperlinkAudit', 'Hyperlink Auditing', 'na', 'Не удалось проверить', '');
  } else if (audit === false) {
    addCheck('Приватность', 'hyperlinkAudit', 'Hyperlink Auditing', 'ok', '✓ Аудит ссылок отключён', '');
  } else {
    addCheck('Приватность', 'hyperlinkAudit', 'Hyperlink Auditing', 'warn',
      '⚠️ Аудит ссылок включён',
      'Сайты узнают, что вы кликнули по их ссылке. Отключить: Настройки → Приватность → «Аудит гиперссылок».');
  }

  // 5. WebRTC IP Handling
  const webrtc = await privacyGet(chrome.privacy.network.webRTCIPHandlingPolicy);
  if (webrtc === null) {
    addCheck('Приватность', 'webrtc', 'WebRTC IP-политика', 'na', 'Не удалось проверить', '');
  } else if (webrtc === 'disable_non_proxied_udp' || webrtc === 'default_public_interface_only') {
    addCheck('Приватность', 'webrtc', 'WebRTC IP-политика', 'ok', `✓ Политика: ${webrtc}`, '');
  } else {
    addCheck('Приватность', 'webrtc', 'WebRTC IP-политика', 'warn',
      `⚠️ Политика: ${webrtc}`,
      'WebRTC может выдавать ваш реальный IP даже через VPN. Расширения типа WebRTC Leak Prevent или настройка в chrome://flags помогут.');
  }

  // 6. Network Prediction
  const netPred = await privacyGet(chrome.privacy.network.networkPredictionEnabled);
  if (netPred === null) {
    addCheck('Приватность', 'netPrediction', 'Предсказание сети', 'na', 'Не удалось проверить', '');
  } else if (netPred === false) {
    addCheck('Приватность', 'netPrediction', 'Предсказание сети', 'ok', '✓ Предсказание отключено', '');
  } else {
    addCheck('Приватность', 'netPrediction', 'Предсказание сети', 'warn',
      '⚠️ Предсказание включено',
      'Chrome заранее подгружает домены, которые вы, возможно, откроете. Это немного сливает историю. Можно отключить в Настройках → Приватность → «Предварительная загрузка».');
  }
}

// ===== БЕЗОПАСНОСТЬ СЕРФИНГА =====
async function checkBrowsing() {
  // Safe Browsing
  const sb = await privacyGet(chrome.privacy.services.safeBrowsingEnabled);
  if (sb === null) {
    addCheck('Безопасность серфинга', 'safeBrowsing', 'Безопасный просмотр', 'na', 'Не удалось проверить', '');
  } else if (sb === true) {
    addCheck('Безопасность серфинга', 'safeBrowsing', 'Безопасный просмотр', 'ok',
      '✓ Safe Browsing включён', '');
  } else {
    addCheck('Безопасность серфинга', 'safeBrowsing', 'Безопасный просмотр', 'fail',
      '✗ Safe Browsing отключён!',
      'Это критично. Настройки → Конфиденциальность → Безопасность → «Усиленная защита». Chrome будет предупреждать о фишинге и вредоносных сайтах.');
  }

  // Password Manager
  const pwdMgr = await privacyGet(chrome.privacy.services.passwordSavingEnabled);
  if (pwdMgr === null) {
    addCheck('Безопасность серфинга', 'pwdMgr', 'Менеджер паролей Chrome', 'na', 'Не удалось проверить', '');
  } else if (pwdMgr === true) {
    addCheck('Безопасность серфинга', 'pwdMgr', 'Менеджер паролей Chrome', 'ok',
      '✓ Встроенный менеджер паролей включён', '');
  } else {
    addCheck('Безопасность серфинга', 'pwdMgr', 'Менеджер паролей Chrome', 'warn',
      '⚠️ Встроенный менеджер паролей отключён',
      'Если у вас не установлен сторонний менеджер (Bitwarden, 1Password), включите встроенный. Это лучше, чем запоминать пароли в голове.');
  }
}

// ===== ПАРОЛИ И АВТОЗАПОЛНЕНИЕ =====
async function checkPasswords() {
  // Autofill credit cards
  const cc = await privacyGet(chrome.privacy.services.autofillCreditCardEnabled);
  if (cc === null) {
    addCheck('Пароли и автозаполнение', 'autofillCC', 'Автозаполнение карт', 'na', 'Не удалось проверить', '');
  } else if (cc === false) {
    addCheck('Пароли и автозаполнение', 'autofillCC', 'Автозаполнение карт', 'ok',
      '✓ Автозаполнение банковских карт отключено', '');
  } else {
    addCheck('Пароли и автозаполнение', 'autofillCC', 'Автозаполнение карт', 'warn',
      '⚠️ Автозаполнение банковских карт включено',
      'Если ноутбук украдут или вы оставите его открытым — карта «сама» введётся на любом сайте. Отключите: Настройки → Автозаполнение → Платёжные методы.');
  }

  // Autofill addresses
  const addr = await privacyGet(chrome.privacy.services.autofillAddressEnabled);
  if (addr === null) {
    addCheck('Пароли и автозаполнение', 'autofillAddr', 'Автозаполнение адресов', 'na', 'Не удалось проверить', '');
  } else if (addr === false) {
    addCheck('Пароли и автозаполнение', 'autofillAddr', 'Автозаполнение адресов', 'ok',
      '✓ Автозаполнение адресов отключено', '');
  } else {
    addCheck('Пароли и автозаполнение', 'autofillAddr', 'Автозаполнение адресов', 'warn',
      '⚠️ Автозаполнение адресов включено',
      'Адрес и телефон попадают на сайты автоматически. Если неудобно выключать — оставьте только для доверенных сайтов.');
  }
}

// ===== РАСШИРЕНИЯ =====
async function checkExtensions() {
  return new Promise((resolve) => {
    if (!chrome.management || !chrome.management.getAll) {
      addCheck('Расширения', 'extCount', 'Список расширений', 'na', 'Management API недоступен', '');
      return resolve();
    }

    try {
      chrome.management.getAll((exts) => {
        if (chrome.runtime.lastError || !exts) {
          addCheck('Расширения', 'extCount', 'Список расширений', 'na', 'Не удалось получить список', '');
          return resolve();
        }

        // Находим наше расширение по ID
        const myId = chrome.runtime.id;
        const others = exts.filter(e => e.id !== myId && e.type === 'extension' && e.enabled);

        // Опасные разрешения
        const riskyPerms = ['<all_urls>', 'cookies', 'tabs', 'webRequest', 'declarativeNetRequest', 'history', 'bookmarks', 'downloads', 'proxy', 'management', 'nativeMessaging'];
        const riskyExts = others.filter(e => {
          const perms = (e.permissions || []).concat(e.hostPermissions || []);
          return perms.some(p => riskyPerms.includes(p) || p === '<all_urls>');
        });

        // Adblock?
        const adblockNames = ['adblock', 'ublock', 'adguard', 'ghostery', 'privacy badger', 'ublock origin'];
        const hasAdblock = others.some(e => adblockNames.some(n => (e.name || '').toLowerCase().includes(n)));

        // 1) Количество
        if (others.length === 0) {
          addCheck('Расширения', 'extCount', 'Количество расширений', 'ok', '✓ Расширений нет (кроме КиберЩит)', '');
        } else if (others.length <= 5) {
          addCheck('Расширения', 'extCount', 'Количество расширений', 'ok',
            `✓ Установлено: ${others.length}`, '');
        } else if (others.length <= 10) {
          addCheck('Расширения', 'extCount', 'Количество расширений', 'warn',
            `⚠️ Установлено: ${others.length} — многовато`,
            'Чем больше расширений, тем больше способов взлома. Удалите те, что не используете. Проверьте: chrome://extensions/.');
        } else {
          addCheck('Расширения', 'extCount', 'Количество расширений', 'fail',
            `✗ Установлено: ${others.length} — очень много`,
            'Слишком много расширений. Каждое видит ваши данные. Оставьте только необходимые.');
        }

        // 2) Опасные разрешения
        if (riskyExts.length === 0) {
          addCheck('Расширения', 'extRisky', 'Опасные разрешения', 'ok',
            '✓ Расширения с полным доступом не найдены', '');
        } else if (riskyExts.length <= 2) {
          addCheck('Расширения', 'extRisky', 'Опасные разрешения', 'warn',
            `⚠️ Расширения с полным доступом: ${riskyExts.length}`,
            `Список: ${riskyExts.map(e => e.name).join(', ')}. Эти расширения могут читать любые ваши вкладки. Убедитесь, что доверяете им.`);
        } else {
          addCheck('Расширения', 'extRisky', 'Опасные разрешения', 'fail',
            `✗ Расширений с полным доступом: ${riskyExts.length}`,
            `Список: ${riskyExts.map(e => e.name).join(', ')}. Это высокий риск: любое из них может украсть пароли или переписку.`);
        }

        // 3) Adblock
        if (hasAdblock) {
          addCheck('Расширения', 'adblock', 'Блокировщик рекламы', 'ok', '✓ Установлен adblock', '');
        } else {
          addCheck('Расширения', 'adblock', 'Блокировщик рекламы', 'warn',
            '⚠️ Блокировщик рекламы не найден',
            'Рекомендуется uBlock Origin — он блокирует рекламу, трекеры и майнеры. Бесплатный, с открытым исходным кодом.');
        }

        resolve();
      });
    } catch (e) {
      addCheck('Расширения', 'extError', 'Список расширений', 'na', 'Ошибка API', '');
      resolve();
    }
  });
}

// ===== ОБЩЕЕ О БРАУЗЕРЕ =====
async function checkBrowser() {
  // Версия Chrome
  const ua = navigator.userAgent;
  const match = ua.match(/Chrome\/(\d+)\./);
  if (match) {
    const version = parseInt(match[1], 10);
    if (version >= 120) {
      addCheck('Общее', 'chromeVer', 'Версия Chrome', 'ok',
        `✓ Chrome ${version} — актуальная`, '');
    } else if (version >= 100) {
      addCheck('Общее', 'chromeVer', 'Версия Chrome', 'warn',
        `⚠️ Chrome ${version} — устаревшая`,
        'Обновите Chrome: значок ⋮ справа сверху → Справка → «О Google Chrome». Регулярно выходят патчи безопасности.');
    } else {
      addCheck('Общее', 'chromeVer', 'Версия Chrome', 'fail',
        `✗ Chrome ${version} — очень старая версия!`,
        'Срочно обновите Chrome! Старые версии содержат известные уязвимости, которые активно используют хакеры.');
    }
  } else {
    addCheck('Общее', 'chromeVer', 'Версия Chrome', 'na', 'Не удалось определить версию', '');
  }

  // Incognito
  return new Promise((resolve) => {
    try {
      chrome.extension.isAllowedIncognitoAccess((allowed) => {
        if (chrome.runtime.lastError) {
          addCheck('Общее', 'incognito', 'Режим инкогнито', 'na', 'Не удалось проверить', '');
          return resolve();
        }
        if (allowed) {
          addCheck('Общее', 'incognito', 'Режим инкогнито', 'ok',
            '✓ Расширение работает в инкогнито', '');
        } else {
          addCheck('Общее', 'incognito', 'Режим инкогнито', 'warn',
            '⚠️ КиберЩит не работает в инкогнито',
            'Включите: chrome://extensions/ → КиберЩит → Детали → «Разрешить использование в режиме инкогнито». Тогда защита будет и в приватных окнах.');
        }
        resolve();
      });
    } catch (e) {
      addCheck('Общее', 'incognito', 'Режим инкогнито', 'na', 'Ошибка', '');
      resolve();
    }
  });
}

// ===== РЕНДЕР =====
function renderResults() {
  // Общий счёт
  let points = 0;
  let maxPoints = 0;
  allChecks.forEach(c => {
    if (c.status === 'na') return;
    maxPoints += 1;
    if (c.status === 'ok') points += 1;
    else if (c.status === 'warn') points += 0.5;
    // fail = 0
  });

  const score = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : 0;

  // Круг
  const circle = document.getElementById('scoreCircle');
  let color = '#2ecc71';
  if (score < 50) color = '#e74c3c';
  else if (score < 75) color = '#f39c12';
  const deg = (score / 100) * 360;
  circle.style.background = `conic-gradient(${color} ${deg}deg, #334155 ${deg}deg 360deg)`;

  // Число
  document.getElementById('scoreNum').textContent = score;

  // Вердикт
  let verdict = '';
  if (score >= 90) verdict = '🏆 Отлично! Браузер хорошо защищён.';
  else if (score >= 75) verdict = '✅ Хорошо. Есть небольшие улучшения.';
  else if (score >= 50) verdict = '⚠️ Средне. Рекомендуем заняться настройками.';
  else verdict = '🚨 Плохо. Браузер уязвим — исправьте срочно!';
  document.getElementById('scoreVerdict').textContent = verdict;

  // Группируем по категориям
  const categories = {};
  allChecks.forEach(c => {
    if (!categories[c.category]) categories[c.category] = [];
    categories[c.category].push(c);
  });

  const categoryEmoji = {
    'Приватность': '🕵️',
    'Безопасность серфинга': '🛡️',
    'Пароли и автозаполнение': '🔑',
    'Расширения': '🧩',
    'Общее': '⚙️'
  };

  const container = document.getElementById('checksContainer');
  let html = '';
  Object.keys(categories).forEach(cat => {
    const items = categories[cat];
    const okCount = items.filter(i => i.status === 'ok').length;
    const failCount = items.filter(i => i.status === 'fail').length;
    const countClass = failCount > 0 ? 'bad' : (okCount === items.length ? 'good' : '');

    html += `
      <div class="category">
        <div class="category-header">
          <span class="cat-emoji">${categoryEmoji[cat] || '📋'}</span>
          <span>${cat}</span>
          <span class="cat-count ${countClass}">${okCount}/${items.length}</span>
        </div>
    `;

    items.forEach(c => {
      const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : c.status === 'fail' ? '✕' : '?';
      html += `
        <div class="check-item ${c.status}">
          <div class="check-icon">${icon}</div>
          <div class="check-content">
            <div class="check-title">${escapeHtml(c.title)}</div>
            <div class="check-status">${escapeHtml(c.description)}</div>
            ${c.recommendation ? `<div class="check-recommendation">💡 ${escapeHtml(c.recommendation)}</div>` : ''}
          </div>
        </div>
      `;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}