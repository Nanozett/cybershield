// background.js — сервис-воркер расширения КиберЩит v4.5

const SERVER_URL = 'https://cybershield-cyan.vercel.app';

// ===== БЕЛЫЙ СПИСОК =====
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

// ===== ЧЁРНЫЙ СПИСОК =====
const BLACKLIST = [
  // Примеры / базовые
  'phishing-example.com', 'malware-site.ru', 'free-vbucks.net',
  'steam-communlty.com', 'sberbank-online-vhod.ru',
  // Двойники case-battle
  'casebatle.id', 'casbatle.com', 'casebattle.red',
  'case-batlte.com', 'cases-batle.ru',
  // Фишинг
  'brevis.by', 'moneyatphone.top',
  // Лотереи/опросы
  'fastrefund.website', 'hmail1009.blogspot.nl', 'prizeme.com.ua', 'spleth.icu',
  // SMS-разводы
  '100linksdvgpn.avafedors.freedomain.thehost.com.ua',
  '6gyf.sionas.homelinux.org',
  'driveron.ru', 'drivers.byethost16.com', 'files.truetds.icu',
  'forum.jokke.ru', 'fqevj.kolomnatrud.ru', 'fsfll.fgawudownsyfuf.info',
  'geforcesh.preumnoj.ru', 'gsmsignal.ru', 'hit-kino.com',
  'hjpzt.rtk-sales.ru', 'ikbsk.bear-hunt.ru', 'maksiko.ru',
  'msaav.radiofaiz.ru', 'opendrivers.ru', 'orav.info',
  'pravoholding.ru', 'qsiub.atomproduction.ru', 'qwcxp.elcoleso.ru',
  'vernaconsco.rutopik.ru', 'vihce.wilgood63.ru', 'xagoc.geo-meter.ru',
  // Фейковые загрузки
  'apponic.com', 'download-windows.org', 'downloadastro.com',
  '1progs.ru', 'advanced-systemcare-com.ru', 'aktiv-windows.ucoz.com',
  'andyroid.net', 'antikeys.org', 'bandicam-pro.ru',
  'botdilofce.bandcamp.com', 'boxprograms.ru', 'chelcenter.ru',
  'computta.com', 'crackheaps.com', 'crackpluskeygen.org',
  'doublegames.ru', 'downloadelements.com', 'driveridentifier.com',
  'drivers.org.ru', 'driverunpaid.ru', 'drp.su',
  'filesdatabase4u.com', 'filehorse.com', 'freecrackpatch.com',
  'fsm-portal.net', 'get.cryptobrowser.site', 'installpack.net',
  'jeweell.com', 'kichkas.biz', 'kryptex.org',
  'listid.ru', 'mediagetsite.com', 'mirsofta.ru',
  'moiprogrammy.com', 'mwfix.ru', 'nikask.ru',
  'nullthemedownload.com', 'nvidiadrivers.net', 'oneindir.com',
  'oneprogs.ru', 'removal-virusguide.com', 'savow.com',
  'serialms.com', 'smojem.ru', 'softkumir.ru',
  'softportal.com', 'solvusoft.com', 'teramissu-hom.com',
  'top-best-browser.ru', 'tvoiprogrammy.ru', 'ubar-pro4.ru',
  'upantool.com', 'updatestar.com', 'vipmolik.net',
  'virus4remove.com', 'w10-digital-activation-program.ru',
  'winxpsoft.com', 'xeplayer.com', 'youtube.net.ua',
  // Вирусы
  'imei-poisk.ru', 'programmi-dlya-vzloma.com',
  '17ebook.com', 'aladel.net', 'bpwhamburgorchardpark.org',
  'clicnews.com', 'dfwdiesel.net', 'divineenterprises.net',
  'fantasticfilms.ru', 'gardensrestaurantandcatering.com',
  'ginedis.com', 'gncr.org', 'hdvideoforums.org',
  'hihanin.com', 'kingfamilyphotoalbum.com', 'likaraoke.com',
  'mactep.org', 'magic4you.nu', 'marbling.pe.kr',
  'nacjalneg.info', 'pronline.ru', 'purplehoodie.com',
  'qsng.cn', 'seksburada.net', 'sportsmansclub.net',
  'stock888.cn', 'tathli.com', 'teamclouds.com',
  'texaswhitetailfever.com', 'wadefamilytree.org',
  'xnescat.info', 'yt118.com',
  // Подозрительные
  'unvesouver39238.weebly.com'
];

// ===== Подозрительные паттерны в имени домена =====
const SUSPICIOUS_PATTERNS = [
  'free-money', 'login-verify', 'account-confirm',
  'paypal-secure', 'sberbank-online', 'gosuslugi-vhod'
];

// ===== Легитимные бренды (для детекта двойников) =====
const LEGITIMATE_BRANDS = [
  'case-battle.lat', 'case-battle.cfd', 'steamcommunity.com',
  'sberbank.ru', 'gosuslugi.ru', 'vk.com', 'yandex.ru',
  'mail.ru', 'avito.ru', 'ozon.ru', 'wildberries.ru',
  'tinkoff.ru', 'alfabank.ru'
];

// ===== Динамические платформы (часто используются мошенниками) =====
// На этих сервисах любой может создать бесплатный поддомен.
// Легитимные сайты тоже там есть, но рандомные поддомены — почти всегда фишинг.
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

// ===== Подозрительные TLD (высокая доля фишинга) =====
const SUSPICIOUS_TLDS = [
  'icu', 'top', 'gq', 'ml', 'tk', 'cf', 'ga', 'click'
];

// ===== Утилита: fetch с таймаутом =====
async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ===== Нормализация домена =====
function normalizeDomain(name) {
  let s = String(name).toLowerCase();
  const homoglyphs = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
    'х': 'x', 'у': 'y', 'к': 'k', 'в': 'b', 'н': 'h',
    'м': 'm', 'т': 't', 'і': 'i', 'ї': 'i', 'ё': 'e',
    'ѕ': 's', 'ј': 'j', 'ԁ': 'd'
  };
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

function isGovernmentSite(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  return GOVERNMENT_SITES.some(site => {
    const cleanSite = site.toLowerCase().replace(/^www\./, '');
    return cleanDomain === cleanSite || cleanDomain.endsWith('.' + cleanSite);
  });
}

function isLocalSite(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  if (LOCAL_SITES.includes(cleanDomain)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(cleanDomain)) return true;
  if (cleanDomain.endsWith('.local') || cleanDomain.endsWith('.test') || cleanDomain.endsWith('.localhost')) return true;
  return false;
}

function isLegitimateBrand(domain) {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
  return LEGITIMATE_BRANDS.some(brand => {
    const cleanBrand = brand.toLowerCase().replace(/^www\./, '');
    return cleanDomain === cleanBrand || cleanDomain.endsWith('.' + cleanBrand);
  });
}

// ===== НОВОЕ: Детект рандомного поддомена на динамической платформе =====
function isDynamicPhishing(domain) {
  const clean = domain.toLowerCase().replace(/^www\./, '');
  for (const platform of DYNAMIC_HOSTING_PLATFORMS) {
    if (clean.endsWith('.' + platform)) {
      const subdomain = clean.slice(0, -(platform.length + 1));
      // 1) Чисто буквенно-цифровая строка 4–20 символов с цифрами — рандом
      if (/^[a-z0-9]{4,20}$/.test(subdomain) && /\d/.test(subdomain)) {
        // Отсеиваем явно легитимные типа "myblog2024"
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

// ===== Безопасные обёртки =====
function safeSendMessage(tabId, message) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, message, () => { if (chrome.runtime.lastError) {} });
  } catch (e) {}
}

function safeUpdateBadge(tabId, verdict, count) {
  if (!tabId) return;
  const colors = {
    safe: '#2ecc71', suspicious: '#f39c12', dangerous: '#e74c3c',
    government: '#1e40af', unknown: '#95a5a6'
  };
  const text = {
    safe: '✓', suspicious: '!', dangerous: '✕',
    government: '★', unknown: '?'
  };
  const badgeText = (count && count > 0) ? String(count) : (text[verdict] || '');
  const badgeColor = (count && count > 0) ? '#7c3aed' : (colors[verdict] || colors.unknown);

  try {
    chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId }, () => { if (chrome.runtime.lastError) {} });
    chrome.action.setBadgeText({ text: badgeText, tabId }, () => { if (chrome.runtime.lastError) {} });
  } catch (e) {}
}

function safeNotify(title, message, priority = 1) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title, message, priority
    }, () => { if (chrome.runtime.lastError) {} });
  } catch (e) {}
}

// ===== Кэш =====
const trackerCounts = {};
const checkCache = {};
const CACHE_TTL = 30000;

function getCached(url) {
  const c = checkCache[url];
  if (c && Date.now() - c.timestamp < CACHE_TTL) return c.data;
  return null;
}

function setCached(url, data) {
  checkCache[url] = { data, timestamp: Date.now() };
  const now = Date.now();
  for (const k of Object.keys(checkCache)) {
    if (now - checkCache[k].timestamp > CACHE_TTL * 4) delete checkCache[k];
  }
}

// ===== Установка =====
chrome.runtime.onInstalled.addListener(() => {
  safeNotify('КиберЩит активирован', 'Защита v4.5: сканер браузера, cookies, SSL, трекеры, пароли, email.', 1);
  chrome.storage.local.set({
    history: [],
    settings: { notifications: true, trackerBlocking: true },
    stats: { totalChecked: 0, dangerous: 0, suspicious: 0, trackersBlocked: 0 }
  });
});

// ===== Вкладки =====
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab && tab.url) {
    safeUpdateBadge(tabId, 'unknown', 0);
  }
  if (changeInfo.status === 'complete' && tab && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
    trackerCounts[tabId] = { total: 0, byDomain: {} };
    checkUrl(tab.url, tabId).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete trackerCounts[tabId];
});

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (tab && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
      checkUrl(tab.url, tab.id).catch(() => {});
    }
  });
});

// ===== WHOIS =====
async function getDomainCreationDate(domain) {
  if (isLocalSite(domain)) return null;
  try {
    const res = await fetchWithTimeout(`${SERVER_URL}/api/whois/${domain}`, {
      headers: { 'Accept': 'application/json' }
    }, 3500);
    if (res && res.ok) {
      const data = await res.json();
      if (data.success && data.year) return { year: data.year, fullDate: data.fullDate, source: 'server' };
    }
  } catch (e) {}
  try {
    const res = await fetchWithTimeout(`https://rdap.org/domain/${domain}`, {
      headers: { 'Accept': 'application/json' }
    }, 3500);
    if (res && res.ok) {
      const data = await res.json();
      const registration = (data.events || []).find(e => e.eventAction === 'registration');
      if (registration && registration.eventDate) {
        const date = new Date(registration.eventDate);
        return { year: date.getFullYear(), fullDate: registration.eventDate.slice(0, 10), source: 'rdap.org' };
      }
    }
  } catch (e) {}
  return null;
}

// ===== IP =====
async function getIpInfo(domain) {
  if (isLocalSite(domain)) return null;
  try {
    const res = await fetchWithTimeout(`https://ipapi.co/${domain}/json/`, {
      headers: { 'Accept': 'application/json' }
    }, 3500);
    if (res && res.ok) {
      const data = await res.json();
      if (data && !data.error && data.ip) {
        return {
          ip: data.ip, country: data.country_name,
          countryCode: data.country_code, org: data.org, city: data.city
        };
      }
    }
  } catch (e) {}
  try {
    const res = await fetchWithTimeout(`https://ipwho.is/${domain}`, {
      headers: { 'Accept': 'application/json' }
    }, 3500);
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.success !== false && data.ip) {
        return {
          ip: data.ip, country: data.country, countryCode: data.country_code,
          org: (data.connection && (data.connection.isp || data.connection.org)) || null,
          city: data.city
        };
      }
    }
  } catch (e) {}
  return null;
}

// ===== Быстрая проверка (без сети) =====
function quickCheck(domain, url) {
  let verdict = 'safe';
  const reasons = [];

  // 1. Чёрный список
  if (BLACKLIST.some(b => domain.includes(b))) {
    verdict = 'dangerous';
    reasons.push('Домен в чёрном списке КиберЩит');
  }

  // 2. Двойник
  if (verdict !== 'dangerous' && !isLegitimateBrand(domain)) {
    const lookalike = findLookalike(domain);
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
  if (verdict === 'safe' && !isLegitimateBrand(domain)) {
    const dyn = isDynamicPhishing(domain);
    if (dyn) {
      verdict = 'suspicious';
      reasons.push(`Похоже на фишинг на платформе ${dyn.platform} (${dyn.reason})`);
    }
  }

  // 4. НОВОЕ: Подозрительный TLD
  if (verdict === 'safe' && hasSuspiciousTLD(domain)) {
    verdict = 'suspicious';
    reasons.push(`Зона .${domain.split('.').pop()} часто используется мошенниками`);
  }

  // 5. Подозрительные паттерны в имени
  if (SUSPICIOUS_PATTERNS.some(p => domain.toLowerCase().includes(p))) {
    if (verdict === 'safe') verdict = 'suspicious';
    reasons.push('Подозрительное имя домена');
  }

  // 6. HTTPS
  if (url.startsWith('http://')) {
    if (verdict === 'safe') verdict = 'suspicious';
    reasons.push('Соединение без HTTPS');
  }

  return { verdict, reasons };
}

// ===== Основная проверка =====
async function checkUrl(url, tabId) {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;

    if (isLocalSite(domain)) {
      const verdict = 'safe';
      const reasons = ['Официальный сайт "КиберЩит" (Локальный адрес)'];
      const data = { verdict, reasons, domain, creationInfo: null, ipInfo: null };
      safeUpdateBadge(tabId, verdict, trackerCounts[tabId]?.total || 0);
      saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo: null });
      safeSendMessage(tabId, { action: 'verdictUpdate', ...data });
      setCached(url, data);
      return data;
    }

    const { verdict: quickVerdict, reasons: quickReasons } = quickCheck(domain, url);

    if (isGovernmentSite(domain)) {
      const verdict = 'government';
      const reasons = ['Официальный сайт государственного органа РФ'];
      const cached = getCached(url);
      const data = {
        verdict, reasons, domain,
        creationInfo: cached?.creationInfo || null,
        ipInfo: cached?.ipInfo || null
      };
      safeUpdateBadge(tabId, verdict, trackerCounts[tabId]?.total || 0);
      saveToHistory({ url, domain, verdict, reasons, time: Date.now(), creationInfo: null });
      safeSendMessage(tabId, { action: 'verdictUpdate', ...data });
      enrichInBackground(url, domain, tabId, verdict, reasons);
      setCached(url, data);
      return data;
    }

    const fastData = { verdict: quickVerdict, reasons: quickReasons, domain, creationInfo: null, ipInfo: null };
    safeUpdateBadge(tabId, quickVerdict, trackerCounts[tabId]?.total || 0);
    safeSendMessage(tabId, { action: 'verdictUpdate', ...fastData });
    saveToHistory({ url, domain, verdict: quickVerdict, reasons: quickReasons, time: Date.now(), creationInfo: null });

    enrichInBackground(url, domain, tabId, quickVerdict, quickReasons);

    return fastData;
  } catch (e) {
    console.error('Ошибка проверки:', e);
    return { verdict: 'unknown', reasons: [], domain: '', creationInfo: null, ipInfo: null };
  }
}

// ===== Обогащение (WHOIS, IP, сервер) в фоне =====
async function enrichInBackground(url, domain, tabId, baseVerdict, baseReasons) {
  try {
    const [creationInfo, ipInfo] = await Promise.all([
      getDomainCreationDate(domain),
      getIpInfo(domain)
    ]);

    let verdict = baseVerdict;
    let reasons = [...baseReasons];

    if (creationInfo && creationInfo.fullDate) {
      const regDate = new Date(creationInfo.fullDate);
      const ageDays = Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24));
      if (ageDays < 30 && verdict === 'safe') {
        verdict = 'suspicious';
        reasons.push(`Домен зарегистрирован ${ageDays} дн. назад`);
      }
    }

    try {
      const res = await fetchWithTimeout(`${SERVER_URL}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, domain })
      }, 3500);
      if (res && res.ok) {
        const data = await res.json();
        if (data.verdict && data.verdict !== 'safe') {
          const rank = { safe: 0, government: 1, suspicious: 2, dangerous: 3 };
          if ((rank[data.verdict] || 0) > (rank[verdict] || 0)) verdict = data.verdict;
          if (data.reasons) reasons = reasons.concat(data.reasons);
        }
      }
    } catch (e) {}

    reasons = [...new Set(reasons)];

    const enriched = { verdict, reasons, domain, creationInfo, ipInfo };
    safeUpdateBadge(tabId, verdict, trackerCounts[tabId]?.total || 0);
    safeSendMessage(tabId, { action: 'verdictUpdate', ...enriched });
    setCached(url, enriched);

    if (verdict === 'dangerous' && baseVerdict !== 'dangerous') {
      safeNotify('⚠️ Опасный сайт!', `${domain} — возможен фишинг!`, 2);
    } else if (verdict === 'suspicious' && baseVerdict === 'safe') {
      safeNotify('Подозрительный сайт', `Будьте осторожны: ${domain}`, 1);
    }
  } catch (e) {
    console.warn('Ошибка обогащения:', e);
  }
}

// ===== История =====
function saveToHistory(entry) {
  chrome.storage.local.get(['history', 'stats'], (data) => {
    const history = data.history || [];
    history.unshift(entry);
    const stats = data.stats || { totalChecked: 0, dangerous: 0, suspicious: 0, trackersBlocked: 0 };
    stats.totalChecked = (stats.totalChecked || 0) + 1;
    if (entry.verdict === 'dangerous') stats.dangerous = (stats.dangerous || 0) + 1;
    if (entry.verdict === 'suspicious') stats.suspicious = (stats.suspicious || 0) + 1;
    chrome.storage.local.set({ history: history.slice(0, 100), stats });
  });
}

// ===== Сообщения =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentStatus') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        return sendResponse({ verdict: 'unknown', reasons: ['Ошибка получения вкладки'], creationInfo: null, ipInfo: null });
      }
      if (tabs[0] && tabs[0].url) {
        const url = tabs[0].url;
        const tabId = tabs[0].id;
        const cached = getCached(url);
        if (cached) {
          return sendResponse({
            ...cached,
            trackerCount: trackerCounts[tabId]?.total || 0,
            trackersByDomain: trackerCounts[tabId]?.byDomain || {}
          });
        }
        checkUrl(url, tabId).then((res) => {
          sendResponse({
            ...res,
            trackerCount: trackerCounts[tabId]?.total || 0,
            trackersByDomain: trackerCounts[tabId]?.byDomain || {}
          });
        }).catch(() => {
          sendResponse({ verdict: 'unknown', reasons: ['Ошибка проверки'], creationInfo: null, ipInfo: null });
        });
      } else {
        sendResponse({ verdict: 'unknown', reasons: ['Нет активной вкладки'], creationInfo: null, ipInfo: null });
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
  if (message.action === 'getStats') {
    chrome.storage.local.get(['stats'], (d) => sendResponse({ stats: d.stats || {} }));
    return true;
  }
  if (message.action === 'openUrl') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'openDashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'checkEmail') {
    checkEmailBreaches(message.email).then(sendResponse);
    return true;
  }
  if (message.action === 'checkPassword') {
    checkPasswordBreaches(message.password).then(sendResponse);
    return true;
  }
  if (message.action === 'trackerBlocked') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId && trackerCounts[tabId]) {
      trackerCounts[tabId].total = (trackerCounts[tabId].total || 0) + 1;
      safeUpdateBadge(tabId, 'safe', trackerCounts[tabId].total);
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'getTrackerCount') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      sendResponse({ count: trackerCounts[tabId]?.total || 0 });
    });
    return true;
  }
  if (message.action === 'syncWithServer') {
    syncWithServer().then(sendResponse);
    return true;
  }
});

// ===== Проверка email =====
async function checkEmailBreaches(email) {
  if (!email || !email.includes('@')) return { success: false, error: 'Некорректный email' };
  try {
    const res = await fetchWithTimeout(`${SERVER_URL}/api/hibp/email/${encodeURIComponent(email)}`, {
      headers: { 'Accept': 'application/json' }
    }, 8000);
    if (!res) return { success: false, error: 'Сервер недоступен' };
    if (res.status === 404) return { success: true, breaches: [] };
    if (!res.ok) return { success: false, error: 'Ошибка сервера' };
    const data = await res.json();
    return { success: true, breaches: data.breaches || [] };
  } catch (e) {
    return { success: false, error: 'Сервер недоступен' };
  }
}

// ===== Проверка пароля =====
async function checkPasswordBreaches(password) {
  if (!password) return { success: false, error: 'Пустой пароль' };
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hashHex.substring(0, 5);
    const suffix = hashHex.substring(5);

    const res = await fetchWithTimeout(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Accept': 'text/plain' }
    }, 5000);
    if (!res || !res.ok) return { success: false, error: 'API недоступен' };
    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return { success: true, pwned: true, count: parseInt(countStr, 10) || 0 };
      }
    }
    return { success: true, pwned: false, count: 0 };
  } catch (e) {
    return { success: false, error: 'Ошибка проверки' };
  }
}

// ===== Синхронизация =====
async function syncWithServer() {
  try {
    const data = await new Promise(r => chrome.storage.local.get(['history'], r));
    const res = await fetchWithTimeout(`${SERVER_URL}/api/check/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ history: data.history || [] })
    }, 8000);
    if (!res) return { success: false, error: 'Сервер недоступен' };
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