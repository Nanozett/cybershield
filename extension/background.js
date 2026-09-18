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

// ===== ЛОКАЛЬНЫЕ АДРЕСА (наши и свои проекты) =====
const LOCAL_SITES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1'
];

const BLACKLIST = [
  'phishing-example.com', 'malware-site.ru', 'free-vbucks.net',
  'steam-communlty.com', 'sberbank-online-vhod.ru'
];

const SUSPICIOUS_PATTERNS = [
  'free-money', 'login-verify', 'account-confirm',
  'paypal-secure', 'sberbank-online', 'gosuslugi-vhod'
];

// ===== Установка =====
chrome.runtime.onInstalled.addListener(() => {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'КиберЩит активирован',
    message: 'Защита в реальном времени включена. Все сайты проверяются автоматически.'
  });
  chrome.storage.local.set({ history: [], settings: { notifications: true } });
});

// ===== Слушаем открытие/переключение вкладок =====
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
    checkUrl(tab.url, tabId);
  }
});

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => {
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
  // Прямое совпадение с известными локальными
  if (LOCAL_SITES.includes(cleanDomain)) return true;
  // localhost:3000 → domain = "localhost", порт отсекается парсером
  // 192.168.x.x и 10.x.x.x — приватные
  if (/^192\.168\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(cleanDomain)) return true;
  // .local, .test, .localhost — зарезервированные
  if (cleanDomain.endsWith('.local') || cleanDomain.endsWith('.test') || cleanDomain.endsWith('.localhost')) return true;
  return false;
}

// ===== Получение года создания домена через сервер =====
async function getDomainCreationDate(domain) {
  // Локальные адреса не проверяем через RDAP
  if (isLocalSite(domain)) {
    console.log('[КиберЩит] Локальный адрес, WHOIS пропускаем:', domain);
    return null;
  }

  // Способ 1: через сервер (надёжно)
  try {
    const res = await fetch(`${SERVER_URL}/api/whois/${domain}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.year) {
        console.log('[КиберЩит] WHOIS через сервер:', domain, '→', data.year);
        return {
          year: data.year,
          fullDate: data.fullDate,
          source: 'server'
        };
      }
    } else {
      console.warn('[КиберЩит] Сервер вернул статус', res.status, 'для', domain);
    }
  } catch (e) {
    console.warn('[КиберЩит] Сервер недоступен:', e.message);
  }

  // Способ 2: напрямую через rdap.org (запасной)
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
    console.log('[КиберЩит] WHOIS через rdap.org:', domain, '→', date.getFullYear());
    return {
      year: date.getFullYear(),
      fullDate: registration.eventDate.slice(0, 10),
      source: 'rdap.org'
    };
  } catch (e) {
    console.warn('[КиберЩит] RDAP напрямую недоступен:', e.message);
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

    // 0. ЛОКАЛЬНЫЕ АДРЕСА — сразу в белый список
    if (isLocalSite(domain)) {
      verdict = 'safe';
      reasons.push('Официальный сайт "КиберЩит" (Локальный адрес — свой проект)');

      updateBadge(tabId, verdict);
      saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo: null });

      chrome.tabs.sendMessage(tabId, {
        action: 'verdictUpdate', verdict, reasons, domain, creationInfo: null
      }).catch(() => {});

      return { verdict, reasons, creationInfo: null };
    }

    // Получаем дату создания домена
    const creationInfo = await getDomainCreationDate(domain);

    // 1. Госсайты — особый случай
    if (isGovernmentSite(domain)) {
      verdict = 'government';
      reasons.push('Официальный сайт государственного органа РФ');

      updateBadge(tabId, verdict);
      saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo });

      chrome.tabs.sendMessage(tabId, {
        action: 'verdictUpdate', verdict, reasons, domain, creationInfo
      }).catch(() => {});

      return { verdict, reasons, creationInfo };
    }

    // 2. Чёрный список
    if (BLACKLIST.some(b => domain.includes(b))) {
      verdict = 'dangerous';
      reasons.push('Домен в чёрном списке КиберЩит');
    }

    // 3. Подозрительные паттерны
    if (SUSPICIOUS_PATTERNS.some(p => domain.toLowerCase().includes(p))) {
      if (verdict === 'safe') verdict = 'suspicious';
      reasons.push('Подозрительное имя домена');
    }

    // 4. HTTPS
    if (url.startsWith('http://')) {
      if (verdict === 'safe') verdict = 'suspicious';
      reasons.push('Соединение без HTTPS');
    }

    // 5. Возраст домена
    if (creationInfo && creationInfo.fullDate) {
      const regDate = new Date(creationInfo.fullDate);
      const ageDays = Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays < 30 && verdict === 'safe') {
        verdict = 'suspicious';
        reasons.push(`Домен зарегистрирован всего ${ageDays} дн. назад`);
      }
    }

    // 6. Запрос к серверу КиберЩит
    try {
      const res = await fetch(`${SERVER_URL}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, domain })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.verdict && data.verdict !== 'safe') {
          verdict = data.verdict;
          if (data.reasons) reasons = reasons.concat(data.reasons);
        }
      }
    } catch (e) { /* сервер недоступен */ }

    updateBadge(tabId, verdict);
    saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo });

    if (verdict === 'dangerous') {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: '⚠️ Опасный сайт!',
        message: `${domain} — возможен фишинг. Не вводите данные!`,
        priority: 2
      });
    } else if (verdict === 'suspicious') {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'Подозрительный сайт',
        message: `Будьте осторожны: ${domain}`,
        priority: 1
      });
    }

    chrome.tabs.sendMessage(tabId, {
      action: 'verdictUpdate', verdict, reasons, domain, creationInfo
    }).catch(() => {});

    return { verdict, reasons, creationInfo };
  } catch (e) {
    console.error('Ошибка проверки:', e);
    return { verdict: 'unknown', reasons: [], creationInfo: null };
  }
}

// ===== Значок =====
function updateBadge(tabId, verdict) {
  const colors = {
    safe: '#2ecc71', suspicious: '#f39c12', dangerous: '#e74c3c',
    government: '#1e40af', unknown: '#95a5a6'
  };
  const text = {
    safe: '✓', suspicious: '!', dangerous: '✕',
    government: '★', unknown: '?'
  };
  chrome.action.setBadgeBackgroundColor({ color: colors[verdict] || colors.unknown, tabId });
  chrome.action.setBadgeText({ text: text[verdict] || '', tabId });
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