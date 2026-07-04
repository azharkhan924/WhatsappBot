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

  dot.className = 'status-dot';
  if (state.status === 'connected') {
    dot.classList.add('connected');
    label.textContent = 'Connected';
    qrStage.innerHTML = `
      <div class="connected-state">
        <div class="big-dot"></div>
        <div class="connected-number">${state.connectedNumber ? '+' + state.connectedNumber : 'Linked'}</div>
      </div>`;
    meta.textContent = 'WhatsApp Web session active.';
  } else if (state.status === 'qr' && state.qrDataUrl) {
    dot.classList.add('waiting');
    label.textContent = 'Scan to connect';
    qrStage.innerHTML = `<img src="${state.qrDataUrl}" alt="WhatsApp QR code">`;
    meta.textContent = 'Open WhatsApp → Linked devices → Link a device.';
  } else if (state.status === 'disconnected') {
    dot.classList.add('off');
    label.textContent = 'Disconnected';
    qrStage.innerHTML = `<div class="qr-placeholder">Session ended</div>`;
    meta.textContent = '';
  } else {
    dot.classList.add('waiting');
    label.textContent = 'Initializing…';
    qrStage.innerHTML = `<div class="qr-placeholder">Waiting for backend<span class="blink"></span></div>`;
    meta.textContent = '';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ===== Socket.IO live updates =====
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(API_BASE, {
    transports: ['websocket', 'polling'],
    auth: { dashboardKey: DASHBOARD_KEY },
  });

  socket.on('state', renderStatus);

  socket.on('dashboard_log', (log) => {
    const logsContainer = $('logs');
    if (!logsContainer) return;
    
    const timeStr = new Date(log.timestamp).toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${log.type || 'info'}`;
    entry.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
    `;
    logsContainer.appendChild(entry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
    
    while (logsContainer.children.length > 50) {
      logsContainer.removeChild(logsContainer.firstChild);
    }
  });

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
  if ($('admin-notify-number')) $('admin-notify-number').value = cfg.adminNotifyNumber || '';
  if ($('auto-pause-hours')) $('auto-pause-hours').value = cfg.autoPauseDurationHours !== undefined ? cfg.autoPauseDurationHours : 12;
  renderWhitelist(cfg.whitelist || []);
}

$('admin-notify-number')?.addEventListener('change', async (e) => {
  const adminNotifyNumber = e.target.value.trim().replace(/[^0-9]/g, '');
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ adminNotifyNumber }),
    });
    toast('Admin notification number updated', 'success');
  } catch (err) {
    toast('Failed to update admin notify number', 'error');
  }
});

$('auto-pause-hours')?.addEventListener('change', async (e) => {
  const autoPauseDurationHours = parseInt(e.target.value, 10) || 12;
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ autoPauseDurationHours }),
    });
    toast('Auto-pause duration updated', 'success');
  } catch (err) {
    toast('Failed to update auto-pause duration', 'error');
  }
});

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
  const countrySelect = $('whitelist-country-code');
  if (!input || !countrySelect) return;

  const hasPlus = input.value.trim().startsWith('+');
  let raw = input.value.trim().replace(/[^0-9]/g, '');
  if (!raw) {
    toast('Enter a valid phone number', 'error');
    return;
  }

  let fullNumber = raw;
  const countryCode = countrySelect.value;

  if (hasPlus) {
    // User explicitly entered a full international number with +
    fullNumber = raw;
  } else {
    // If they typed exactly 10 digits, prepend selected country code
    if (raw.length === 10) {
      fullNumber = countryCode + raw;
    } else if (raw.length > 10 && raw.startsWith(countryCode)) {
      fullNumber = raw;
    } else if (raw.length > 10) {
      // It's already a full number or has a different country code, keep it
      fullNumber = raw;
    } else {
      toast('Enter a valid phone number (at least 10 digits)', 'error');
      return;
    }
  }

  const list = new Set(currentConfig?.whitelist || []);
  if (list.has(fullNumber)) {
    toast('Already on the whitelist');
    input.value = '';
    return;
  }
  list.add(fullNumber);
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
function doLogout() {
  localStorage.removeItem('bot_api_base');
  localStorage.removeItem('bot_dashboard_key');
  API_BASE = '';
  DASHBOARD_KEY = '';
  if (socket) socket.disconnect();
  clearInterval(pollTimer);
  showGate();
}
$('disconnect-btn')?.addEventListener('click', doLogout);
$('disconnect-btn-mobile')?.addEventListener('click', doLogout);

// ===== Hard Reset Bot =====
$('hard-reset-btn')?.addEventListener('click', async () => {
  if (!confirm('WARNING: This will delete your WhatsApp session and immediately restart the server to force a clean QR code. Use this ONLY if your bot is stuck on "session ended". Proceed?')) {
    return;
  }
  
  $('hard-reset-btn').disabled = true;
  $('hard-reset-btn').textContent = 'Resetting...';
  try {
    let res = await fetch(`${API_BASE}/api/hard-reset`, {
      method: 'POST',
      headers: {
        'x-dashboard-key': DASHBOARD_KEY,
      },
    });
    if (res.status === 404) {
      res = await fetch(`${API_BASE}/hard-reset`, {
        method: 'POST',
        headers: { 'x-dashboard-key': DASHBOARD_KEY },
      });
    }
    if (res.ok) {
      alert('Hard reset triggered! The server will now restart. Please wait 15 seconds and then refresh this page to scan your new QR code.');
      setTimeout(() => location.reload(), 15000);
    } else {
      const data = await res.json();
      alert('Failed: ' + (data.error || data.publicMessage || 'Unknown error'));
      $('hard-reset-btn').disabled = false;
      $('hard-reset-btn').textContent = '🚨 Hard Reset Bot';
    }
  } catch (err) {
    alert('Error: ' + err.message);
    $('hard-reset-btn').disabled = false;
    $('hard-reset-btn').textContent = '🚨 Hard Reset Bot';
  }
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

// ===== Scheduler =====
let schedulerGroups = [];
let schedulerChannels = [];

// Render chip list for scheduler groups or channels
function renderSchedulerChips(list, containerId, emptyId, removeCallback) {
  const wrap = $(containerId);
  const empty = $(emptyId);
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!list || list.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  list.forEach((item) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span>${item}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove ${item}`);
    removeBtn.addEventListener('click', () => removeCallback(item));
    chip.appendChild(removeBtn);
    wrap.appendChild(chip);
  });
}

function renderSchedulerGroups() {
  renderSchedulerChips(schedulerGroups, 'scheduler-group-chips', 'scheduler-group-empty', (item) => {
    schedulerGroups = schedulerGroups.filter((g) => g !== item);
    renderSchedulerGroups();
  });
}

function renderSchedulerChannels() {
  renderSchedulerChips(schedulerChannels, 'scheduler-channel-chips', 'scheduler-channel-empty', (item) => {
    schedulerChannels = schedulerChannels.filter((c) => c !== item);
    renderSchedulerChannels();
  });
}

// Add group
$('scheduler-group-add-btn')?.addEventListener('click', () => {
  const input = $('scheduler-group-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    toast('Enter a group ID or name', 'error');
    return;
  }
  if (schedulerGroups.includes(val)) {
    toast('Already added');
    input.value = '';
    return;
  }
  schedulerGroups.push(val);
  input.value = '';
  renderSchedulerGroups();
});

$('scheduler-group-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('scheduler-group-add-btn')?.click();
});

// Add channel
$('scheduler-channel-add-btn')?.addEventListener('click', () => {
  const input = $('scheduler-channel-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    toast('Enter a channel ID', 'error');
    return;
  }
  if (schedulerChannels.includes(val)) {
    toast('Already added');
    input.value = '';
    return;
  }
  schedulerChannels.push(val);
  input.value = '';
  renderSchedulerChannels();
});

$('scheduler-channel-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('scheduler-channel-add-btn')?.click();
});

// Cron presets dropdown
$('scheduler-cron-presets')?.addEventListener('change', (e) => {
  const val = e.target.value;
  if (val && $('scheduler-cron')) {
    $('scheduler-cron').value = val;
  }
  e.target.value = ''; // reset dropdown
});

// Ad folder upload
$('scheduler-ad-upload-btn')?.addEventListener('click', () => {
  $('scheduler-ad-upload-input')?.click();
});

$('scheduler-ad-upload-input')?.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const formData = new FormData();
  let imageCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith('image/')) {
      formData.append('images', file);
      imageCount++;
    }
  }

  if (imageCount === 0) {
    toast('No images found in the selected folder.', 'error');
    return;
  }

  const btn = $('scheduler-ad-upload-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Uploading...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/scheduler/ads/upload`, {
      method: 'POST',
      headers: {
        'x-dashboard-key': DASHBOARD_KEY,
      },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to upload images.');
    }
    toast(`Successfully uploaded ${data.count} images!`, 'success');
    // Clear the custom dir input so it uses the default one where we uploaded
    if ($('scheduler-ad-dir')) {
      $('scheduler-ad-dir').value = '';
      $('scheduler-save-btn')?.click(); // trigger save to clear config and refresh status
    } else {
      loadSchedulerStatus();
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Upload Folder';
    }
    e.target.value = ''; // clear input
  }
});

// Load available chats from backend to populate datalists
async function loadAvailableChats(showToast = false) {
  try {
    const res = await fetch(`${API_BASE}/api/scheduler/available-chats`, {
      headers: { 'x-dashboard-key': DASHBOARD_KEY },
    });
    const data = await res.json();
    if (data.success) {
      const groupSelect = $('scheduler-group-input');
      const channelSelect = $('scheduler-channel-input');
      if (groupSelect && data.groups) {
        groupSelect.innerHTML = '<option value="">-- Select a group --</option>';
        data.groups.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name || g.id;
          groupSelect.appendChild(opt);
        });
      }
      // Channel select removed by user request (using text input instead)
      
      if (showToast) {
        if (data.totalChats === 0) {
          toast('WhatsApp is still syncing your chats! Please wait a minute and try again.', 'warning');
        } else if (data.groups.length === 0 && data.channels.length === 0) {
          toast(`Synced ${data.totalChats} chats, but found no groups or channels.`, 'warning');
        } else {
          toast(`Refreshed! Found ${data.groups.length} groups and ${data.channels.length} channels.`, 'success');
        }
      }
    }
  } catch (err) {
    if (showToast) toast('Failed to refresh lists', 'error');
  }
}

$('export-chats-btn')?.addEventListener('click', async () => {
  const btn = $('export-chats-btn');
  btn.textContent = '📥 Exporting...';
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/scheduler/available-chats`, {
      headers: { 'x-dashboard-key': DASHBOARD_KEY },
    });
    const data = await res.json();
    if (data.success && data.raw) {
      let content = 'Chat Name | Chat ID\n=========================================\n';
      data.raw.forEach(c => {
        content += `${c.name} | ${c.id}\n`;
      });
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'whatsapp_chat_ids.txt';
      a.click();
      URL.revokeObjectURL(url);
      toast('Exported successfully!', 'success');
    } else {
      toast('No raw chats found or sync pending.', 'warning');
    }
  } catch (err) {
    toast('Failed to export chats', 'error');
  }
  btn.textContent = '📥 Export All IDs';
  btn.disabled = false;
});

$('refresh-chats-btn')?.addEventListener('click', async () => {
  const btn = $('refresh-chats-btn');
  btn.textContent = '🔄 Loading...';
  btn.disabled = true;
  await loadAvailableChats(true);
  btn.textContent = '🔄 Refresh';
  btn.disabled = false;
});

$('extract-channel-btn')?.addEventListener('click', async () => {
  const link = prompt('Paste your WhatsApp Channel Invite Link:\n(e.g., https://whatsapp.com/channel/0029Va...)');
  if (!link) return;
  
  const btn = $('extract-channel-btn');
  btn.textContent = '⏳ Wait...';
  btn.disabled = true;
  
  try {
    const res = await fetch(`${API_BASE}/api/scheduler/channel-id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dashboard-key': DASHBOARD_KEY,
      },
      body: JSON.stringify({ link: link.trim() }),
    });
    
    const data = await res.json();
    if (data.success && data.id) {
      const channelInput = $('scheduler-channel-input');
      if (channelInput) {
        channelInput.value = data.id;
      }
      toast('Channel ID extracted! Click Add to save.', 'success');
    } else {
      toast('Failed: ' + (data.error || data.publicMessage || 'Unknown error'), 'error');
    }
  } catch (err) {
    toast('Error extracting channel ID. Check your link.', 'error');
  }
  
  btn.textContent = '🔗 Get ID from Link';
  btn.disabled = false;
});

// Quotes Editor
async function loadQuotes() {
  try {
    const res = await api('/api/scheduler/quotes');
    if ($('scheduler-quotes-editor')) {
      $('scheduler-quotes-editor').value = res.content || '';
    }
  } catch (err) {}
}

$('scheduler-quotes-save-btn')?.addEventListener('click', async () => {
  const btn = $('scheduler-quotes-save-btn');
  if (btn) btn.disabled = true;
  const content = $('scheduler-quotes-editor')?.value || '';
  try {
    await api('/api/scheduler/quotes', {
      method: 'PUT',
      body: JSON.stringify({ content })
    });
    toast('Quotes saved successfully!', 'success');
  } catch (err) {
    toast('Failed to save quotes', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('scheduler-quotes-upload-btn')?.addEventListener('click', () => {
  $('scheduler-quotes-upload-input')?.click();
});

$('scheduler-quotes-upload-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  
  const btn = $('scheduler-quotes-upload-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/scheduler/quotes/upload`, {
      method: 'POST',
      headers: { 'x-dashboard-key': DASHBOARD_KEY },
      body: formData
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error);
    if ($('scheduler-quotes-editor')) {
      $('scheduler-quotes-editor').value = data.content;
    }
    toast('Quotes uploaded successfully!', 'success');
  } catch (err) {
    toast(err.message || 'Failed to upload quotes file', 'error');
  } finally {
    if (btn) btn.disabled = false;
    e.target.value = '';
  }
});

// Load scheduler status from backend
async function loadSchedulerStatus() {
  try {
    loadAvailableChats();
    loadQuotes();
    const status = await api('/api/scheduler/status');

    // Toggle
    if ($('toggle-scheduler')) $('toggle-scheduler').checked = !!status.enabled;

    // Cron
    const cronExpr = status.cron || '0 9 * * *';
    if ($('scheduler-cron')) $('scheduler-cron').value = cronExpr;

    // Sync UI clock / interval from cron
    const parsed = parseCron(cronExpr);
    if ($('scheduler-mode')) $('scheduler-mode').value = parsed.mode;
    
    if (parsed.mode === 'daily') {
      if ($('scheduler-time')) $('scheduler-time').value = parsed.time;
      if ($('scheduler-daily-box')) $('scheduler-daily-box').style.display = 'flex';
      if ($('scheduler-interval-box')) $('scheduler-interval-box').style.display = 'none';
    } else {
      if ($('scheduler-interval-preset')) $('scheduler-interval-preset').value = parsed.interval;
      if ($('scheduler-daily-box')) $('scheduler-daily-box').style.display = 'none';
      if ($('scheduler-interval-box')) $('scheduler-interval-box').style.display = 'flex';
    }

    // Timezone
    if ($('scheduler-timezone-label')) {
      $('scheduler-timezone-label').textContent = status.timezone || 'Asia/Kolkata';
    }

    // Targets
    schedulerGroups = status.targetGroups || [];
    schedulerChannels = status.targetChannels || [];
    renderSchedulerGroups();
    renderSchedulerChannels();

    // Ad dir
    if ($('scheduler-ad-dir')) $('scheduler-ad-dir').value = status.adImageDir || '';

    // Ad caption
    if ($('scheduler-ad-caption')) $('scheduler-ad-caption').value = status.adCaption || '';

    // Ad count
    if ($('scheduler-ad-count')) {
      $('scheduler-ad-count').textContent = status.availableAdImages !== undefined ? status.availableAdImages : '—';
    }

    // Last run info
    if (status.lastRunAt) {
      const lastRunDiv = $('scheduler-last-run');
      const infoDiv = $('scheduler-last-run-info');
      if (lastRunDiv && infoDiv) {
        lastRunDiv.style.display = 'block';
        const time = new Date(status.lastRunAt).toLocaleString();
        const statusColor = status.lastRunStatus === 'success' ? '#25D366' :
          status.lastRunStatus === 'no_targets' ? '#E3B341' : '#F85149';
        let detailsHtml = `<span style="color:${statusColor}; font-weight:600;">${status.lastRunStatus}</span> at ${time}`;
        if (status.lastRunDetails && status.lastRunDetails.length > 0) {
          detailsHtml += '<br>';
          status.lastRunDetails.forEach((d) => {
            const icon = d.status === 'sent' ? '✅' : d.status === 'skipped' ? '⏭️' : '❌';
            detailsHtml += `${icon} ${d.target} — quote: ${d.quoteSent ? '✓' : '✗'}, ad: ${d.adSent ? '✓' : '✗'}<br>`;
          });
        }
        infoDiv.innerHTML = detailsHtml;
      }
    }
  } catch (err) {
    // Scheduler status endpoint may not exist on older backends — silently ignore
  }
}

// Scheduler toggle
$('toggle-scheduler')?.addEventListener('change', async (e) => {
  const schedulerEnabled = e.target.checked;
  try {
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ schedulerEnabled }),
    });
    toast(schedulerEnabled ? 'Scheduler enabled' : 'Scheduler disabled', schedulerEnabled ? 'success' : '');
  } catch (err) {
    e.target.checked = !schedulerEnabled;
    toast('Could not update — check backend', 'error');
  }
});

// Save all scheduler settings
$('scheduler-save-btn')?.addEventListener('click', async () => {
  const btn = $('scheduler-save-btn');
  if (btn) btn.disabled = true;

  const updates = {
    schedulerEnabled: $('toggle-scheduler')?.checked || false,
    schedulerCron: $('scheduler-cron')?.value.trim() || '0 9 * * *',
    schedulerTargetGroups: schedulerGroups,
    schedulerTargetChannels: schedulerChannels,
    schedulerAdImageDir: $('scheduler-ad-dir')?.value.trim() || '',
    schedulerAdCaption: $('scheduler-ad-caption')?.value.trim() || '',
  };

  try {
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    toast('Scheduler settings saved!', 'success');
    // Refresh status to get updated ad count etc.
    loadSchedulerStatus();
  } catch (err) {
    toast('Failed to save scheduler settings', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
});

// Send Now button
$('scheduler-send-now-btn')?.addEventListener('click', async () => {
  const btn = $('scheduler-send-now-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Sending…';
  }
  try {
    const result = await api('/api/scheduler/trigger', { method: 'POST' });
    if (result.status === 'no_targets') {
      toast('No targets configured — add groups or channels first', 'error');
    } else {
      toast('Quote & ad sent successfully!', 'success');
    }
    // Refresh to show last run status
    loadSchedulerStatus();
  } catch (err) {
    toast('Failed to send — check backend connection', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Send Now';
    }
  }
});

// ===== Tab Switching =====
const TAB_TITLES = {
  connection: 'Connection',
  prompt: 'AI Prompt',
  scheduler: 'Scheduler',
  settings: 'Settings',
};

function switchTab(tabName) {
  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  // Show target panel
  const panel = $('tab-' + tabName);
  if (panel) panel.classList.add('active');

  // Update sidebar nav
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.tab === tabName);
  });

  // Update bottom tabs
  document.querySelectorAll('.bottom-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Update header title
  if ($('main-title')) $('main-title').textContent = TAB_TITLES[tabName] || tabName;
}

// Bind sidebar nav clicks
document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Bind bottom tab clicks
document.querySelectorAll('.bottom-tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ===== Theme Toggle =====
function getStoredTheme() {
  return localStorage.getItem('wa-bot-theme') || 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('wa-bot-theme', theme);
  const icon = theme === 'dark' ? '☀️' : '🌙';
  if ($('theme-toggle-btn')) $('theme-toggle-btn').textContent = icon;
  if ($('theme-toggle-btn-mobile')) $('theme-toggle-btn-mobile').textContent = icon;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

$('theme-toggle-btn')?.addEventListener('click', toggleTheme);
$('theme-toggle-btn-mobile')?.addEventListener('click', toggleTheme);

// Apply stored theme on load
applyTheme(getStoredTheme());

// Show mobile actions on small screens
function handleResize() {
  const mobile = window.innerWidth <= 768;
  const mobileActions = $('mobile-actions');
  if (mobileActions) mobileActions.style.display = mobile ? 'flex' : 'none';
}
window.addEventListener('resize', handleResize);
handleResize();

// ===== Scheduler clock & interval presets translation =====
function parseCron(cronExpr) {
  if (!cronExpr) return { mode: 'daily', time: '09:00', interval: 'hour_1' };
  
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return { mode: 'daily', time: '09:00', interval: 'hour_1' };
  
  // Check for minute interval: */X * * * *
  if (parts[0].startsWith('*/') && parts[1] === '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
    const mins = parts[0].slice(2);
    return { mode: 'interval', time: '09:00', interval: `min_${mins}` };
  }
  
  // Check for hour interval: 0 */X * * *
  if (parts[0] === '0' && parts[1].startsWith('*/') && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
    const hours = parts[1].slice(2);
    return { mode: 'interval', time: '09:00', interval: `hour_${hours}` };
  }
  
  // Otherwise treat as daily time: mm hh * * *
  const min = parts[0];
  const hour = parts[1];
  if (!isNaN(min) && !isNaN(hour) && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
    const paddedHour = hour.padStart(2, '0');
    const paddedMin = min.padStart(2, '0');
    return { mode: 'daily', time: `${paddedHour}:${paddedMin}`, interval: 'hour_1' };
  }
  
  return { mode: 'daily', time: '09:00', interval: 'hour_1' };
}

function updateHiddenCron() {
  const mode = $('scheduler-mode')?.value || 'daily';
  let cronVal = '0 9 * * *';
  
  if (mode === 'daily') {
    const timeVal = $('scheduler-time')?.value || '09:00';
    const [hours, mins] = timeVal.split(':');
    if (hours !== undefined && mins !== undefined) {
      cronVal = `${parseInt(mins, 10)} ${parseInt(hours, 10)} * * *`;
    }
  } else {
    const intervalVal = $('scheduler-interval-preset')?.value || 'hour_1';
    if (intervalVal.startsWith('min_')) {
      const mins = intervalVal.split('_')[1];
      cronVal = `*/${mins} * * * *`;
    } else if (intervalVal.startsWith('hour_')) {
      const hours = intervalVal.split('_')[1];
      cronVal = `0 */${hours} * * *`;
    }
  }
  
  if ($('scheduler-cron')) $('scheduler-cron').value = cronVal;
}

$('scheduler-mode')?.addEventListener('change', (e) => {
  const mode = e.target.value;
  if (mode === 'daily') {
    if ($('scheduler-daily-box')) $('scheduler-daily-box').style.display = 'flex';
    if ($('scheduler-interval-box')) $('scheduler-interval-box').style.display = 'none';
  } else {
    if ($('scheduler-daily-box')) $('scheduler-daily-box').style.display = 'none';
    if ($('scheduler-interval-box')) $('scheduler-interval-box').style.display = 'flex';
  }
  updateHiddenCron();
});

$('scheduler-time')?.addEventListener('change', updateHiddenCron);
$('scheduler-interval-preset')?.addEventListener('change', updateHiddenCron);

// ===== Init =====
function init() {
  showDashboard();
  connectSocket();
  startPollFallback();
  loadConfig();
  loadSchedulerStatus();
  handleResize();
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

