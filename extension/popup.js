const SERVER_URL = 'http://localhost:3000';

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

  document.querySelectorAll('.menu button').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openUrl', url: `${SERVER_URL}/#${btn.dataset.page}` });
      window.close();
    });
  });
}

function loadCurrentStatus() {
  chrome.runtime.sendMessage({ action: 'getCurrentStatus' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      renderStatus({ verdict: 'unknown', reasons: ['Не удалось получить статус'], creationInfo: null });
      return;
    }
    renderStatus(response);
  });
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

  // Отображение года создания
  const creationSection = document.getElementById('creationSection');
  const creationYear = document.getElementById('creationYear');
  const creationAge = document.getElementById('creationAge');

  console.log('[КиберЩит popup] creationInfo:', data.creationInfo);

  if (data.creationInfo && data.creationInfo.year) {
    creationSection.style.display = 'block';
    creationYear.textContent = data.creationInfo.year;

    const regDate = new Date(data.creationInfo.fullDate);
    const ageDays = Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24));
    let ageText = '';
    let ageColor = '';

    if (ageDays < 30) {
      ageText = `⚠️ Всего ${ageDays} дн. назад — высокий риск`;
      ageColor = '#e74c3c';
    } else if (ageDays < 365) {
      ageText = `⏳ ${ageDays} дн. — молодой домен`;
      ageColor = '#f39c12';
    } else {
      const years = Math.floor(ageDays / 365);
      ageText = `✅ ${years} лет — надёжный домен`;
      ageColor = '#2ecc71';
    }

    creationAge.textContent = ageText;
    creationAge.style.color = ageColor;
  } else {
    creationSection.style.display = 'block';
    creationYear.textContent = '—';
    creationAge.textContent = 'Данные недоступны (сервер выключен или зона не поддерживается)';
    creationAge.style.color = '#94a3b8';
  }
}

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

  if (!chars) {
    document.getElementById('generatedPassword').value = 'Выберите хотя бы один набор';
    return;
  }
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
  if (!confirm('Очистить историю проверок?')) return;
  chrome.runtime.sendMessage({ action: 'clearHistory' }, () => loadHistory());
}

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