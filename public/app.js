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

function getCleanGateUrl() {
  let rawUrl = $('gate-url').value.trim();
  if (!rawUrl && window.location.origin && !window.location.origin.startsWith('file:')) {
    rawUrl = window.location.origin;
  }
  if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
    rawUrl = 'https://' + rawUrl;
  }
  return rawUrl.replace(/\/+$/, '').replace(/\/(dashboard|static)$/i, '');
}

$('tab-admin')?.addEventListener('click', () => {
  if ($('tab-admin')) $('tab-admin').classList.add('active');
  if ($('tab-phone')) $('tab-phone').classList.remove('active');
  if ($('tab-key')) $('tab-key').classList.remove('active');
  if ($('section-admin')) $('section-admin').style.display = 'block';
  if ($('section-phone')) $('section-phone').style.display = 'none';
  if ($('section-key')) $('section-key').style.display = 'none';
});

$('tab-phone')?.addEventListener('click', () => {
  if ($('tab-phone')) $('tab-phone').classList.add('active');
  if ($('tab-admin')) $('tab-admin').classList.remove('active');
  if ($('tab-key')) $('tab-key').classList.remove('active');
  if ($('section-phone')) $('section-phone').style.display = 'block';
  if ($('section-admin')) $('section-admin').style.display = 'none';
  if ($('section-key')) $('section-key').style.display = 'none';
});

$('tab-key')?.addEventListener('click', () => {
  if ($('tab-key')) $('tab-key').classList.add('active');
  if ($('tab-admin')) $('tab-admin').classList.remove('active');
  if ($('tab-phone')) $('tab-phone').classList.remove('active');
  if ($('section-key')) $('section-key').style.display = 'block';
  if ($('section-admin')) $('section-admin').style.display = 'none';
  if ($('section-phone')) $('section-phone').style.display = 'none';
});

$('gate-admin-submit')?.addEventListener('click', async () => {
  const url = getCleanGateUrl();
  const username = $('gate-admin-user').value.trim();
  const password = $('gate-admin-pass').value.trim();
  $('gate-error-admin').textContent = '';

  if (!url || !username || !password) {
    $('gate-error-admin').textContent = 'All fields are required.';
    return;
  }

  $('gate-admin-submit').disabled = true;
  $('gate-admin-submit').textContent = 'Logging in…';

  try {
    let res = await fetch(`${url}/api/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (res.status === 404) {
      res = await fetch(`${url}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success || !data.dashboardKey) {
      throw new Error(data.error || data.message || 'Invalid username or password.');
    }

    API_BASE = url;
    DASHBOARD_KEY = data.dashboardKey;
    localStorage.setItem('bot_api_base', API_BASE);
    localStorage.setItem('bot_dashboard_key', DASHBOARD_KEY);

    toast('Logged in successfully!', 'success');
    init();
  } catch (err) {
    $('gate-error-admin').textContent = err.message;
    $('gate-admin-submit').disabled = false;
    $('gate-admin-submit').textContent = 'Admin Login';
  }
});

$('gate-send-otp')?.addEventListener('click', async () => {
  const url = getCleanGateUrl();
  const phone = $('gate-phone').value.trim();
  $('gate-error-phone').textContent = '';

  if (!url || !phone) {
    $('gate-error-phone').textContent = 'Backend URL and Phone number are required.';
    return;
  }

  $('gate-send-otp').disabled = true;
  $('gate-send-otp').textContent = 'Sending WhatsApp Code…';

  try {
    let res = await fetch(`${url}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    if (res.status === 404) {
      res = await fetch(`${url}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'Failed to send verification code.');
    }
    toast('Code sent via WhatsApp!', 'success');
    $('otp-group').style.display = 'block';
    $('gate-send-otp').style.display = 'none';
    $('gate-verify-otp').style.display = 'block';
  } catch (err) {
    $('gate-error-phone').textContent = err.message;
    $('gate-send-otp').disabled = false;
    $('gate-send-otp').textContent = 'Send Verification Code';
  }
});

$('gate-verify-otp')?.addEventListener('click', async () => {
  const url = getCleanGateUrl();
  const phone = $('gate-phone').value.trim();
  const otp = $('gate-otp').value.trim();
  $('gate-error-phone').textContent = '';

  if (!otp) {
    $('gate-error-phone').textContent = 'Please enter the 6-digit code received on WhatsApp.';
    return;
  }

  $('gate-verify-otp').disabled = true;
  $('gate-verify-otp').textContent = 'Verifying…';

  try {
    let res = await fetch(`${url}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });
    if (res.status === 404) {
      res = await fetch(`${url}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp })
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success || !data.dashboardKey) {
      throw new Error(data.error || data.message || 'Invalid verification code.');
    }

    API_BASE = url;
    DASHBOARD_KEY = data.dashboardKey;
    localStorage.setItem('bot_api_base', API_BASE);
    localStorage.setItem('bot_dashboard_key', DASHBOARD_KEY);

    toast('Verified successfully!', 'success');
    init();
  } catch (err) {
    $('gate-error-phone').textContent = err.message;
    $('gate-verify-otp').disabled = false;
    $('gate-verify-otp').textContent = 'Verify & Connect';
  }
});

$('gate-submit')?.addEventListener('click', async () => {
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
$('reconnect-btn')?.addEventListener('click', async () => {
  const btn = $('reconnect-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Requesting…';
  }
  try {
    await api('/api/reconnect', { method: 'POST' });
    toast('Requested a new session — QR incoming', 'success');
  } catch (err) {
    toast('Could not reach backend', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Generate new QR';
    }
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
  if ($('prompt-editor')) $('prompt-editor').value = cfg.systemPrompt || '';
  updateCharCount();
  if ($('toggle-enabled')) $('toggle-enabled').checked = !!cfg.botEnabled;
  if ($('toggle-whitelist')) $('toggle-whitelist').checked = !!cfg.whitelistEnabled;
  if ($('holding-reply-input')) $('holding-reply-input').value = cfg.holdingReply || '';
  renderWhitelist(cfg.whitelist || []);
}

function updateCharCount() {
  const el = $('prompt-editor');
  if (el && $('char-count')) {
    $('char-count').textContent = `${el.value.length} chars`;
  }
}

// ===== System prompt =====
$('prompt-editor')?.addEventListener('input', () => {
  promptDirty = true;
  updateCharCount();
});

$('prompt-save-btn')?.addEventListener('click', async () => {
  const systemPrompt = $('prompt-editor')?.value || '';
  if ($('prompt-save-btn')) $('prompt-save-btn').disabled = true;
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ systemPrompt }),
    });
    promptDirty = false;
    const saved = $('prompt-saved');
    if (saved) {
      saved.classList.add('show');
      setTimeout(() => saved.classList.remove('show'), 1800);
    }
  } catch (err) {
    toast('Save failed — check backend connection', 'error');
  } finally {
    if ($('prompt-save-btn')) $('prompt-save-btn').disabled = false;
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
$('toggle-enabled')?.addEventListener('change', async (e) => {
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

// ===== Whitelist enabled toggle =====
$('toggle-whitelist')?.addEventListener('change', async (e) => {
  const whitelistEnabled = e.target.checked;
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ whitelistEnabled }),
    });
    toast(whitelistEnabled ? 'Whitelist mode active' : 'Replying to everyone', whitelistEnabled ? 'success' : '');
  } catch (err) {
    e.target.checked = !whitelistEnabled; // revert on failure
    toast('Could not update — check backend', 'error');
  }
});

// ===== Holding reply =====
$('holding-save-btn')?.addEventListener('click', async () => {
  const holdingReply = $('holding-reply-input')?.value.trim() || '';
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

$('whitelist-add-btn')?.addEventListener('click', () => {
  const input = $('whitelist-input');
  if (!input) return;
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

$('whitelist-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('whitelist-add-btn')?.click();
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

// ===== Pairing Code (Link with phone number) =====
$('pairing-btn')?.addEventListener('click', async () => {
  const phone = $('pairing-phone').value.trim();
  $('pairing-error').textContent = '';
  if (!phone) {
    $('pairing-error').textContent = 'Enter your WhatsApp phone number.';
    return;
  }
  $('pairing-btn').disabled = true;
  $('pairing-btn').textContent = 'Requesting…';
  try {
    let res = await fetch(`${API_BASE}/api/pairing-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dashboard-key': DASHBOARD_KEY,
      },
      body: JSON.stringify({ phone }),
    });
    if (res.status === 404) {
      res = await fetch(`${API_BASE}/pairing-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dashboard-key': DASHBOARD_KEY,
        },
        body: JSON.stringify({ phone }),
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'Failed to get pairing code.');
    }
    $('pairing-code-display').textContent = data.pairingCode;
    $('pairing-result').style.display = 'block';
    toast('Pairing code generated!', 'success');
  } catch (err) {
    $('pairing-error').textContent = err.message;
  } finally {
    $('pairing-btn').disabled = false;
    $('pairing-btn').textContent = 'Get Code';
  }
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
