// ===== State =====
let API_BASE = localStorage.getItem('bot_api_base') || '';
let DASHBOARD_KEY = localStorage.getItem('bot_dashboard_key') || '';
let socket = null;
let currentConfig = null;
let promptDirty = false;

const $ = (id) => document.getElementById(id);

// ===== Toast =====
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// ===== Setup gate =====
function showGate() {
  $('gate').classList.remove('hidden');
  $('dashboard').classList.add('hidden');
}

function showDashboard() {
  $('gate').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
}

$('gate-submit').addEventListener('click', async () => {
  let rawUrl = $('gate-url').value.trim();
  if (!rawUrl && window.location.origin && !window.location.origin.startsWith('file:')) {
    rawUrl = window.location.origin;
  }
  if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
    rawUrl = 'https://' + rawUrl;
  }
  const url = rawUrl.replace(/\/+$/, '').replace(/\/(dashboard|static)$/i, '');
  const key = $('gate-key').value.trim();
  $('gate-error').textContent = '';

  if (!url || !key) {
    $('gate-error').textContent = 'Both fields are required.';
    return;
  }

  $('gate-submit').disabled = true;
  $('gate-submit').textContent = 'Connecting…';

  try {
    let res = await fetch(`${url}/api/status`, {
      headers: { 'x-dashboard-key': key },
    });
    if (res.status === 404) {
      res = await fetch(`${url}/status`, {
        headers: { 'x-dashboard-key': key },
      });
    }
    if (res.status === 401) {
      throw new Error('Wrong dashboard key.');
    }
    if (!res.ok) {
      throw new Error(`Backend responded with ${res.status}. Make sure your Railway deployment has completed.`);
    }
    API_BASE = url;
    DASHBOARD_KEY = key;
    localStorage.setItem('bot_api_base', API_BASE);
    localStorage.setItem('bot_dashboard_key', DASHBOARD_KEY);
    init();
  } catch (err) {
    $('gate-error').textContent = err.message || 'Could not reach backend at that URL.';
  } finally {
    $('gate-submit').disabled = false;
    $('gate-submit').textContent = 'Connect';
  }
});

// ===== Authenticated fetch helper =====
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-key': DASHBOARD_KEY,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    toast('Dashboard key rejected — reconnecting setup', 'error');
    localStorage.removeItem('bot_dashboard_key');
    showGate();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

// ===== Connection status rendering =====
function renderStatus(state) {
  const dot = $('header-dot');
  const label = $('header-status');
  const qrStage = $('qr-stage');
  const meta = $('conn-meta');

  dot.className = 'dot';
  if (state.status === 'connected') {
    dot.classList.add('connected');
    label.textContent = 'connected';
    qrStage.innerHTML = `
      <div class="connected-state">
        <div class="big-dot"></div>
        <div class="connected-number">${state.connectedNumber ? '+' + state.connectedNumber : 'linked'}</div>
      </div>`;
    meta.textContent = 'WhatsApp Web session active.';
  } else if (state.status === 'qr' && state.qrDataUrl) {
    dot.classList.add('waiting');
    label.textContent = 'scan to connect';
    qrStage.innerHTML = `<img src="${state.qrDataUrl}" alt="WhatsApp QR code">`;
    meta.textContent = 'Open WhatsApp → Linked devices → Link a device.';
  } else if (state.status === 'disconnected') {
    dot.classList.add('off');
    label.textContent = 'disconnected';
    qrStage.innerHTML = `<div class="qr-placeholder">session ended — tap "Generate new QR"</div>`;
    meta.textContent = '';
  } else {
    dot.classList.add('waiting');
    label.textContent = 'initializing…';
    qrStage.innerHTML = `<div class="qr-placeholder">waiting for backend<span class="cursor"></span></div>`;
    meta.textContent = '';
  }
}

// ===== Socket.IO live updates =====
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(API_BASE, {
    transports: ['websocket', 'polling'],
    auth: { dashboardKey: DASHBOARD_KEY },
  });

  socket.on('state', renderStatus);

  socket.on('connect_error', () => {
    // Socket layer failing isn't fatal — REST polling fallback below covers status.
  });
}

// Fallback poll in case the socket connection can't be established
// (e.g. backend not yet patched with Socket.IO, or a proxy blocking websockets).
let pollTimer = null;
function startPollFallback() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const state = await api('/api/status');
      renderStatus(state);
    } catch (_) { /* handled in api() */ }
  }, 4000);
}

// ===== Reconnect / new QR =====
$('reconnect-btn').addEventListener('click', async () => {
  $('reconnect-btn').disabled = true;
  $('reconnect-btn').textContent = 'Requesting…';
  try {
    await api('/api/reconnect', { method: 'POST' });
    toast('Requested a new session — QR incoming', 'success');
  } catch (err) {
    toast('Could not reach backend', 'error');
  } finally {
    $('reconnect-btn').disabled = false;
    $('reconnect-btn').textContent = 'Generate new QR';
  }
});

// ===== Config: load + render =====
async function loadConfig() {
  try {
    currentConfig = await api('/api/config');
    renderConfig(currentConfig);
  } catch (err) {
    toast('Could not load bot config', 'error');
  }
}

function renderConfig(cfg) {
  $('prompt-editor').value = cfg.systemPrompt || '';
  updateCharCount();
  $('toggle-enabled').checked = !!cfg.botEnabled;
  $('holding-reply-input').value = cfg.holdingReply || '';
  renderWhitelist(cfg.whitelist || []);
}

function updateCharCount() {
  $('char-count').textContent = `${$('prompt-editor').value.length} chars`;
}

// ===== System prompt =====
$('prompt-editor').addEventListener('input', () => {
  promptDirty = true;
  updateCharCount();
});

$('prompt-save-btn').addEventListener('click', async () => {
  const systemPrompt = $('prompt-editor').value;
  $('prompt-save-btn').disabled = true;
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ systemPrompt }),
    });
    promptDirty = false;
    const saved = $('prompt-saved');
    saved.classList.add('show');
    setTimeout(() => saved.classList.remove('show'), 1800);
  } catch (err) {
    toast('Save failed — check backend connection', 'error');
  } finally {
    $('prompt-save-btn').disabled = false;
  }
});

// Warn before leaving with unsaved prompt edits
window.addEventListener('beforeunload', (e) => {
  if (promptDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ===== Bot enabled toggle =====
$('toggle-enabled').addEventListener('change', async (e) => {
  const botEnabled = e.target.checked;
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ botEnabled }),
    });
    toast(botEnabled ? 'Bot is replying' : 'Bot is silent', botEnabled ? 'success' : '');
  } catch (err) {
    e.target.checked = !botEnabled; // revert on failure
    toast('Could not update — check backend', 'error');
  }
});

// ===== Holding reply =====
$('holding-save-btn').addEventListener('click', async () => {
  const holdingReply = $('holding-reply-input').value.trim();
  if (!holdingReply) {
    toast('Holding reply can\'t be empty', 'error');
    return;
  }
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ holdingReply }),
    });
    toast('Holding reply saved', 'success');
  } catch (err) {
    toast('Save failed', 'error');
  }
});

// ===== Whitelist =====
function renderWhitelist(list) {
  const wrap = $('whitelist-chips');
  const empty = $('whitelist-empty');
  wrap.innerHTML = '';
  if (!list.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.forEach((number) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span>${number}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove ${number}`);
    removeBtn.addEventListener('click', () => removeFromWhitelist(number));
    chip.appendChild(removeBtn);
    wrap.appendChild(chip);
  });
}

async function saveWhitelist(list) {
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ whitelist: list }),
    });
    renderWhitelist(currentConfig.whitelist || []);
  } catch (err) {
    toast('Could not update whitelist', 'error');
  }
}

$('whitelist-add-btn').addEventListener('click', () => {
  const input = $('whitelist-input');
  const raw = input.value.trim().replace(/[^0-9]/g, '');
  if (!raw || raw.length < 10) {
    toast('Enter a valid number with country code', 'error');
    return;
  }
  const list = new Set(currentConfig?.whitelist || []);
  if (list.has(raw)) {
    toast('Already on the whitelist');
    input.value = '';
    return;
  }
  list.add(raw);
  input.value = '';
  saveWhitelist([...list]);
});

$('whitelist-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('whitelist-add-btn').click();
});

function removeFromWhitelist(number) {
  const list = (currentConfig?.whitelist || []).filter((n) => n !== number);
  saveWhitelist(list);
}

// ===== Disconnect / Reset =====
$('disconnect-btn')?.addEventListener('click', () => {
  localStorage.removeItem('bot_api_base');
  localStorage.removeItem('bot_dashboard_key');
  API_BASE = '';
  DASHBOARD_KEY = '';
  if (socket) socket.disconnect();
  clearInterval(pollTimer);
  showGate();
});

// ===== Init =====
function init() {
  showDashboard();
  connectSocket();
  startPollFallback();
  loadConfig();
}

// Auto-fill gate URL with current origin if empty
if (window.location.origin && !window.location.origin.startsWith('file:')) {
  const gateInput = $('gate-url');
  if (gateInput && !gateInput.value) {
    gateInput.value = window.location.origin;
  }
}

// On load: skip the gate if we already have saved credentials
if (API_BASE && DASHBOARD_KEY) {
  init();
} else {
  showGate();
}
