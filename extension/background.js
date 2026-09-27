// background.js — сервис-воркер расширения КиберЩит

const SERVER_URL = 'http://localhost:3000';

// ===== БЕЛЫЙ СПИСОК: государственные и правоохранительные сайты =====
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

const LOCAL_SITES = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

const BLACKLIST = [
  'phishing-example.com', 'malware-site.ru', 'free-vbucks.net',
  'steam-communlty.com', 'sberbank-online-vhod.ru',
  'casebatle.id', 'casbatle.com', 'casebattle.red',
  'case-batlte.com', 'cases-batle.ru'
];

const SUSPICIOUS_PATTERNS = [
  'free-money', 'login-verify', 'account-confirm',
  'paypal-secure', 'sberbank-online', 'gosuslugi-vhod'
];

const LEGITIMATE_BRANDS = [
  'case-battle.lat',
  'case-battle.cfd',
  'steamcommunity.com',
  'sberbank.ru',
  'gosuslugi.ru',
  'vk.com',
  'yandex.ru',
  'mail.ru',
  'avito.ru',
  'ozon.ru',
  'wildberries.ru',
  'tinkoff.ru',
  'alfabank.ru'
];

// ===== Нормализация домена (гомоглифы, дефисы) =====
function normalizeDomain(name) {
  let s = String(name).toLowerCase();
  const homoglyphs = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
    'х': 'x', 'у': 'y', 'к': 'k', 'в': 'b', 'н': 'h',
    'м': 'm', 'т': 't', 'і': 'i', 'ї': 'i', 'ё': 'e',
    'ѕ': 's', 'ј': 'j', 'ԁ': 'd'
  };
  s = s.split('').map(c => homoglyphs[c] || c).join('');
  s = s.replace(/[-_]/g, '');
  return s;
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
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// ===== Поиск домена-двойника =====
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
    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { lookalike: brand, distance };
    }
  }
  if (bestMatch && bestMatch.distance <= 2) return bestMatch;
  return null;
}

// ===== Безопасная отправка сообщения в таб =====
function safeSendMessage(tabId, message) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      // Поглощаем ошибку "Could not establish connection" / "No tab"
      if (chrome.runtime.lastError) { /* таб закрыт или контент-скрипт не загружен */ }
    });
  } catch (e) { /* на всякий случай */ }
}

// ===== Безопасное обновление значка =====
function safeUpdateBadge(tabId, verdict) {
  if (!tabId) return;
  const colors = {
    safe: '#2ecc71', suspicious: '#f39c12', dangerous: '#e74c3c',
    government: '#1e40af', unknown: '#95a5a6'
  };
  const text = {
    safe: '✓', suspicious: '!', dangerous: '✕',
    government: '★', unknown: '?'
  };
  try {
    chrome.action.setBadgeBackgroundColor({ color: colors[verdict] || colors.unknown, tabId }, () => {
      if (chrome.runtime.lastError) { /* таб закрыт */ }
    });
    chrome.action.setBadgeText({ text: text[verdict] || '', tabId }, () => {
      if (chrome.runtime.lastError) { /* таб закрыт */ }
    });
  } catch (e) { /* игнор */ }
}

// ===== Безопасное уведомление =====
function safeNotify(title, message, priority = 1) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title,
      message,
      priority
    }, () => {
      if (chrome.runtime.lastError) { /* игнор */ }
    });
  } catch (e) { /* игнор */ }
}

// ===== Установка =====
chrome.runtime.onInstalled.addListener(() => {
  safeNotify('КиберЩит активирован', 'Защита в реальном времени включена. Все сайты проверяются автоматически.', 1);
  chrome.storage.local.set({ history: [], settings: { notifications: true } });
});

// ===== Слушаем открытие вкладок =====
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
    checkUrl(tab.url, tabId);
  }
});

// ===== Слушаем переключение вкладок =====
chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => {
    // ВАЖНО: проверяем lastError, иначе "No tab with id"
    if (chrome.runtime.lastError) return;
    if (tab && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
      checkUrl(tab.url, tab.id);
    }
  });
});

// ===== Проверка домена на принадлежность к госсайтам =====
function isGovernmentSite(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  return GOVERNMENT_SITES.some(site => {
    const cleanSite = site.toLowerCase().replace(/^www\./, '');
    return cleanDomain === cleanSite || cleanDomain.endsWith('.' + cleanSite);
  });
}

// ===== Проверка на локальный адрес =====
function isLocalSite(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  if (LOCAL_SITES.includes(cleanDomain)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (cleanDomain.endsWith('.local') || cleanDomain.endsWith('.test') || cleanDomain.endsWith('.localhost')) return true;
  return false;
}

// ===== Проверка, легитимный ли это бренд =====
function isLegitimateBrand(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  return LEGITIMATE_BRANDS.some(brand => {
    const cleanBrand = brand.toLowerCase().replace(/^www\./, '');
    return cleanDomain === cleanBrand || cleanDomain.endsWith('.' + cleanBrand);
  });
}

// ===== Получение года создания домена через сервер =====
async function getDomainCreationDate(domain) {
  if (isLocalSite(domain)) return null;

  try {
    const res = await fetch(`${SERVER_URL}/api/whois/${domain}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.year) {
        return { year: data.year, fullDate: data.fullDate, source: 'server' };
      }
    }
  } catch (e) { /* сервер недоступен */ }

  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const registration = (data.events || []).find(e => e.eventAction === 'registration');
    if (!registration || !registration.eventDate) return null;
    const date = new Date(registration.eventDate);
    return {
      year: date.getFullYear(),
      fullDate: registration.eventDate.slice(0, 10),
      source: 'rdap.org'
    };
  } catch (e) {
    return null;
  }
}

// ===== Основная функция проверки =====
async function checkUrl(url, tabId) {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    let verdict = 'safe';
    let reasons = [];

    // 0. Локальные
    if (isLocalSite(domain)) {
      verdict = 'safe';
      reasons.push('Официальный сайт "КиберЩит" (Локальный адрес — свой проект)');
      safeUpdateBadge(tabId, verdict);
      saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo: null });
      safeSendMessage(tabId, { action: 'verdictUpdate', verdict, reasons, domain, creationInfo: null });
      return { verdict, reasons, creationInfo: null };
    }

    const creationInfo = await getDomainCreationDate(domain);

    // 1. Госсайты
    if (isGovernmentSite(domain)) {
      verdict = 'government';
      reasons.push('Официальный сайт государственного органа РФ');
      safeUpdateBadge(tabId, verdict);
      saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo });
      safeSendMessage(tabId, { action: 'verdictUpdate', verdict, reasons, domain, creationInfo });
      return { verdict, reasons, creationInfo };
    }

    // 2. Чёрный список
    if (BLACKLIST.some(b => domain.includes(b))) {
      verdict = 'dangerous';
      reasons.push('Домен в чёрном списке КиберЩит');
    }

    // 3. Проверка на двойника
    if (verdict !== 'dangerous' && !isLegitimateBrand(domain)) {
      const lookalike = findLookalike(domain);
      if (lookalike) {
        if (lookalike.distance <= 1) {
          verdict = 'dangerous';
          reasons.push(`Домен-двойник официального сайта «${lookalike.lookalike}» (разница ${lookalike.distance} симв.)`);
        } else {
          if (verdict === 'safe') verdict = 'suspicious';
          reasons.push(`Домен похож на «${lookalike.lookalike}» (разница ${lookalike.distance} симв.)`);
        }
      }
    }

    // 4. Подозрительные паттерны
    if (SUSPICIOUS_PATTERNS.some(p => domain.toLowerCase().includes(p))) {
      if (verdict === 'safe') verdict = 'suspicious';
      reasons.push('Подозрительное имя домена');
    }

    // 5. HTTPS
    if (url.startsWith('http://')) {
      if (verdict === 'safe') verdict = 'suspicious';
      reasons.push('Соединение без HTTPS');
    }

    // 6. Возраст домена
    if (creationInfo && creationInfo.fullDate) {
      const regDate = new Date(creationInfo.fullDate);
      const ageDays = Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays < 30 && verdict === 'safe') {
        verdict = 'suspicious';
        reasons.push(`Домен зарегистрирован всего ${ageDays} дн. назад`);
      }
    }

    // 7. Запрос к серверу КиберЩит
    try {
      const res = await fetch(`${SERVER_URL}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, domain })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.verdict && data.verdict !== 'safe') {
          const rank = { safe: 0, government: 1, suspicious: 2, dangerous: 3 };
          if ((rank[data.verdict] || 0) > (rank[verdict] || 0)) {
            verdict = data.verdict;
          }
          if (data.reasons) reasons = reasons.concat(data.reasons);
        }
      }
    } catch (e) { /* сервер недоступен */ }

    reasons = [...new Set(reasons)];

    safeUpdateBadge(tabId, verdict);
    saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo });

    if (verdict === 'dangerous') {
      safeNotify('⚠️ Опасный сайт!', `${domain} — возможен фишинг. Не вводите данные!`, 2);
    } else if (verdict === 'suspicious') {
      safeNotify('Подозрительный сайт', `Будьте осторожны: ${domain}`, 1);
    }

    safeSendMessage(tabId, { action: 'verdictUpdate', verdict, reasons, domain, creationInfo });

    return { verdict, reasons, creationInfo };
  } catch (e) {
    console.error('Ошибка проверки:', e);
    return { verdict: 'unknown', reasons: [], creationInfo: null };
  }
}

// ===== История =====
function saveToHistory(entry) {
  chrome.storage.local.get(['history'], (data) => {
    const history = data.history || [];
    history.unshift(entry);
    chrome.storage.local.set({ history: history.slice(0, 100) });
  });
}

// ===== Сообщения =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentStatus') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        return sendResponse({ verdict: 'unknown', reasons: ['Ошибка получения вкладки'], creationInfo: null });
      }
      if (tabs[0] && tabs[0].url) {
        checkUrl(tabs[0].url, tabs[0].id).then(sendResponse);
      } else {
        sendResponse({ verdict: 'unknown', reasons: ['Нет активной вкладки'], creationInfo: null });
      }
    });
    return true;
  }
  if (message.action === 'getHistory') {
    chrome.storage.local.get(['history'], (d) => sendResponse({ history: d.history || [] }));
    return true;
  }
  if (message.action === 'clearHistory') {
    chrome.storage.local.set({ history: [] }, () => sendResponse({ success: true }));
    return true;
  }
  if (message.action === 'openUrl') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'syncWithServer') {
    syncWithServer().then(sendResponse);
    return true;
  }
});

// ===== Синхронизация =====
async function syncWithServer() {
  try {
    const data = await new Promise(r => chrome.storage.local.get(['history'], r));
    const res = await fetch(`${SERVER_URL}/api/check/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ history: data.history || [] })
    });
    if (res.ok) return { success: true };
    if (res.status === 401) return { success: false, error: 'Войдите на сайте' };
    return { success: false, error: 'Ошибка сервера' };
  } catch (e) {
    return { success: false, error: 'Сервер недоступен' };
  }
}

chrome.alarms.create('sync', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') syncWithServer();
});