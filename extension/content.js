// content.js — предупреждения и особые баннеры прямо на странице

let currentVerdict = 'unknown';
let bannerShown = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'verdictUpdate') {
    currentVerdict = message.verdict;
    if (message.verdict === 'dangerous') {
      showWarningBanner('dangerous', message.reasons);
    } else if (message.verdict === 'suspicious') {
      showWarningBanner('suspicious', message.reasons);
    } else if (message.verdict === 'government') {
      showGovernmentBanner(message.domain);
    }
  }
});

// ===== Баннер для государственных сайтов =====
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
    <style>
      @keyframes kibershit-gov-slide {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
    </style>
    <div style="font-size: 32px; flex-shrink: 0;">🇷🇺</div>
    <div style="flex: 1;">
      <div style="font-weight: 700; font-size: 16px; margin-bottom: 4px;">
        Это официальный сайт правоохранительных органов РФ
      </div>
      <div style="opacity: 0.95;">
        КиберЩит не будет придираться к этому сайту — он в белом списке. 
        Но не задерживайся тут долго, у них и без тебя дел хватает 😉
      </div>
    </div>
    <button id="kibershit-gov-close" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); color: white; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-weight: 600;">Понял</button>
  `;
  document.documentElement.appendChild(banner);

  banner.querySelector('#kibershit-gov-close').addEventListener('click', () => {
    banner.remove();
    bannerShown = false;
  });

  setTimeout(() => {
    if (banner.parentNode) {
      banner.remove();
      bannerShown = false;
    }
  }, 12000);
}

// ===== Баннер для опасных/подозрительных сайтов =====
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
  const details = reasons && reasons.length
    ? `<div style="font-size:13px;opacity:0.9;margin-top:4px;">${reasons.join(' • ')}</div>` : '';

  banner.innerHTML = `
    <style>
      @keyframes kibershit-slide {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
    </style>
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

// ===== Защита полей ввода пароля =====
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t && t.tagName === 'INPUT' && t.type === 'password') {
    if (currentVerdict === 'dangerous') {
      showInlineWarning(t, '⛔ Не вводите пароль! Сайт помечен как опасный.');
    } else if (currentVerdict === 'suspicious' && location.protocol !== 'https:') {
      showInlineWarning(t, '⚠️ Сайт без HTTPS. Пароль может быть перехвачен.');
    }
  }
}, true);

function showInlineWarning(input, text) {
  const next = input.nextElementSibling;
  if (next && next.dataset && next.dataset.kibershitWarn === '1') return;
  const warn = document.createElement('div');
  warn.dataset.kibershitWarn = '1';
  warn.style.cssText = `background:#fff3cd;color:#856404;border:1px solid #ffeeba;padding:8px 12px;border-radius:8px;font-size:13px;font-family:'Segoe UI',sans-serif;margin-top:4px;display:inline-block;max-width:100%;`;
  warn.textContent = text;
  input.parentNode.insertBefore(warn, input.nextSibling);
  setTimeout(() => warn.remove(), 8000);
}