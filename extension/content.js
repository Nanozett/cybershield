// content.js — предупреждения, проверка паролей в реальном времени

let currentVerdict = 'unknown';
let currentDomain = '';
let bannerShown = false;
const checkedPasswords = new Set(); // Кэш проверенных паролей
const passwordCheckTimers = new WeakMap();

// ===== Получение вердикта от background =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'verdictUpdate') {
    currentVerdict = message.verdict;
    currentDomain = message.domain || '';
    if (message.verdict === 'dangerous') {
      showWarningBanner('dangerous', message.reasons);
    } else if (message.verdict === 'suspicious') {
      showWarningBanner('suspicious', message.reasons);
    } else if (message.verdict === 'government') {
      showGovernmentBanner(message.domain);
    }
  }
});

// ===== Баннер для госсайтов =====
function showGovernmentBanner(domain) {
  if (bannerShown) return;
  bannerShown = true;
  const banner = document.createElement('div');
  banner.id = 'kibershit-gov-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
    background: linear-gradient(135deg, #1e40af, #3b82f6);
    color: white; padding: 14px 24px;
    font-family: 'Segoe UI', system-ui, sans-serif; font-size: 15px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    display: flex; align-items: center; gap: 16px;
    animation: kibershit-gov-slide 0.4s ease;
  `;
  banner.innerHTML = `
    <style>@keyframes kibershit-gov-slide { from { transform: translateY(-100%); } to { transform: translateY(0); } }</style>
    <div style="font-size: 32px; flex-shrink: 0;">🇷🇺</div>
    <div style="flex: 1;">
      <div style="font-weight: 700; font-size: 16px; margin-bottom: 4px;">Это официальный сайт правоохранительных органов РФ</div>
      <div style="opacity: 0.95;">КиберЩит не будет придираться — сайт в белом списке. Но не задерживайся тут долго 😉</div>
    </div>
    <button id="kibershit-gov-close" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); color: white; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-weight: 600;">Понял</button>
  `;
  document.documentElement.appendChild(banner);
  banner.querySelector('#kibershit-gov-close').addEventListener('click', () => {
    banner.remove(); bannerShown = false;
  });
  setTimeout(() => { if (banner.parentNode) { banner.remove(); bannerShown = false; } }, 12000);
}

// ===== Баннер для опасных/подозрительных =====
function showWarningBanner(level, reasons) {
  if (bannerShown) return;
  bannerShown = true;
  const colors = {
    dangerous: 'linear-gradient(135deg, #e74c3c, #c0392b)',
    suspicious: 'linear-gradient(135deg, #f39c12, #e67e22)'
  };
  const titles = {
    dangerous: '⚠️ ОПАСНЫЙ САЙТ — НЕ ВВОДИТЕ ДАННЫЕ!',
    suspicious: '⚠️ Подозрительный сайт'
  };
  const texts = {
    dangerous: 'КиберЩит обнаружил признаки фишинга или вредоносного ПО. Немедленно закройте страницу.',
    suspicious: 'Сайт может быть небезопасен. Не вводите логины, пароли и данные карт.'
  };
  const banner = document.createElement('div');
  banner.id = 'kibershit-banner';
  banner.style.cssText = `
    position: fixed; top:0; left:0; right:0; z-index:2147483647;
    background: ${colors[level]}; color:white; padding:16px 24px;
    font-family:'Segoe UI',system-ui,sans-serif; font-size:15px;
    box-shadow:0 4px 20px rgba(0,0,0,0.3);
    display:flex; align-items:center; gap:16px;
    animation: kibershit-slide 0.3s ease;
  `;
  const details = reasons && reasons.length ? `<div style="font-size:13px;opacity:0.9;margin-top:4px;">${reasons.join(' • ')}</div>` : '';
  banner.innerHTML = `
    <style>@keyframes kibershit-slide { from { transform: translateY(-100%); } to { transform: translateY(0); } }</style>
    <div style="font-size:32px;flex-shrink:0;">🛡️</div>
    <div style="flex:1;">
      <div style="font-weight:700;font-size:16px;margin-bottom:4px;">${titles[level]}</div>
      <div style="opacity:0.95;">${texts[level]}</div>
      ${details}
    </div>
    <button id="kibershit-close" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:white;padding:8px 16px;border-radius:20px;cursor:pointer;font-weight:600;">Закрыть</button>
  `;
  document.documentElement.appendChild(banner);
  banner.querySelector('#kibershit-close').addEventListener('click', () => {
    banner.remove(); bannerShown = false;
  });
}

// ===== Проверка поля пароля в реальном времени =====
function attachPasswordMonitor(input) {
  if (input.dataset.kibershitMonitored === '1') return;
  input.dataset.kibershitMonitored = '1';

  input.addEventListener('input', () => {
    const value = input.value;
    if (passwordCheckTimers.has(input)) clearTimeout(passwordCheckTimers.get(input));
    const timer = setTimeout(() => analyzePassword(input, value), 500);
    passwordCheckTimers.set(input, timer);
  });
  input.addEventListener('blur', () => {
    const value = input.value;
    if (value) analyzePassword(input, value, true);
  });
}

// ===== Анализ пароля =====
async function analyzePassword(input, value, forceShow = false) {
  if (!value) {
    removePasswordMeter(input);
    return;
  }
  // Сила пароля
  const strength = calcStrength(value);
  // Проверка на утечки (только если пароль не короткий)
  let pwned = null;
  if (value.length >= 4 && forceShow) {
    pwned = await checkPwned(value);
  }
  showPasswordMeter(input, strength, pwned);
}

// ===== Оценка силы пароля =====
function calcStrength(pwd) {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (pwd.length >= 16) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;

  // Штрафы за повторяющиеся символы
  if (/(.)\1{2,}/.test(pwd)) score -= 2;
  // Штраф за последовательности
  if (/(abc|123|qwerty|password|admin)/i.test(pwd)) score -= 3;

  if (score < 0) score = 0;
  if (score <= 2) return { level: 'weak', label: '🔴 Слабый', color: '#e74c3c', hint: 'Легко взломать' };
  if (score <= 4) return { level: 'medium', label: '🟡 Средний', color: '#f39c12', hint: 'Можно улучшить' };
  if (score <= 6) return { level: 'good', label: '🟢 Хороший', color: '#2ecc71', hint: 'Надёжный пароль' };
  return { level: 'strong', label: '💚 Отличный', color: '#27ae60', hint: 'Очень надёжный' };
}

// ===== Проверка на утечки через HIBP (k-Anonymity) =====
async function checkPwned(password) {
  if (checkedPasswords.has(password)) return checkedPasswords.get(password);
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hashHex.substring(0, 5);
    const suffix = hashHex.substring(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Accept': 'text/plain' }
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        const result = { pwned: true, count: parseInt(countStr, 10) || 0 };
        checkedPasswords.set(password, result);
        return result;
      }
    }
    const result = { pwned: false, count: 0 };
    checkedPasswords.set(password, result);
    return result;
  } catch (e) {
    return null;
  }
}

// ===== Показать индикатор =====
function showPasswordMeter(input, strength, pwned) {
  let meter = input.parentNode.querySelector('.kibershit-pwd-meter');
  if (!meter) {
    meter = document.createElement('div');
    meter.className = 'kibershit-pwd-meter';
    meter.style.cssText = `
      margin-top: 6px; padding: 10px 14px; border-radius: 10px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      background: white; border-left: 4px solid #94a3b8;
      transition: all 0.3s; max-width: 320px;
    `;
    input.parentNode.insertBefore(meter, input.nextSibling);
  }

  let html = `
    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
      <span style="color: ${strength.color};">${strength.label}</span>
      <span style="color: #94a3b8; font-weight: 400; font-size: 12px;">— ${strength.hint}</span>
    </div>
  `;

  if (pwned && pwned.pwned) {
    html += `
      <div style="margin-top: 8px; padding: 8px; background: #fee2e2; border-radius: 6px; color: #991b1b; font-size: 12px; font-weight: 600;">
        ⚠️ Этот пароль найден в утечках ${pwned.count.toLocaleString('ru-RU')} раз! Никогда не используйте его.
      </div>
    `;
    meter.style.borderLeftColor = '#e74c3c';
  } else if (pwned && !pwned.pwned) {
    html += `
      <div style="margin-top: 8px; padding: 8px; background: #d1fae5; border-radius: 6px; color: #065f46; font-size: 12px; font-weight: 600;">
        ✅ Пароль не найден в известных утечках
      </div>
    `;
    meter.style.borderLeftColor = strength.color;
  } else {
    meter.style.borderLeftColor = strength.color;
  }

  // Прогресс-бар
  const widthPct = strength.level === 'weak' ? 25 : strength.level === 'medium' ? 50 : strength.level === 'good' ? 75 : 100;
  html += `
    <div style="margin-top: 8px; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden;">
      <div style="height: 100%; width: ${widthPct}%; background: ${strength.color}; transition: width 0.3s;"></div>
    </div>
  `;

  meter.innerHTML = html;
}

function removePasswordMeter(input) {
  const meter = input.parentNode.querySelector('.kibershit-pwd-meter');
  if (meter) meter.remove();
}

// ===== Автопоиск полей пароля =====
function scanPasswordFields() {
  const inputs = document.querySelectorAll('input[type="password"]');
  inputs.forEach(attachPasswordMonitor);
}

// ===== MutationObserver для новых полей =====
const observer = new MutationObserver(() => {
  scanPasswordFields();
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
  scanPasswordFields();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    scanPasswordFields();
  });
}

// ===== Первая проверка =====
scanPasswordFields();