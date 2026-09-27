document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadHistory();
});

function loadStats() {
  chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
    const s = (response && response.stats) || {};
    document.getElementById('statChecked').textContent = s.totalChecked || 0;
    document.getElementById('statDangerous').textContent = s.dangerous || 0;
    document.getElementById('statSuspicious').textContent = s.suspicious || 0;
    document.getElementById('statTrackers').textContent = s.trackersBlocked || 0;
  });
}

function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    const container = document.getElementById('dashboardHistory');
    const history = (response && response.history) || [];
    if (!history.length) {
      container.innerHTML = '<div class="dh-empty">История пуста</div>';
      return;
    }
    container.innerHTML = history.map(item => `
      <div class="dh-item">
        <div class="dh-dot ${item.verdict}"></div>
        <div class="dh-domain">${item.domain}</div>
        <div class="dh-time">${new Date(item.time).toLocaleString('ru-RU')}</div>
      </div>
    `).join('');
  });
}