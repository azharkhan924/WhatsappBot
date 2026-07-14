// ===== State =====
let API_BASE = localStorage.getItem('bot_api_base') || '';
let DASHBOARD_KEY = localStorage.getItem('bot_dashboard_key') || '';
let socket = null;
let currentConfig = null;
let promptDirty = false;
let _loadingConfig = false; // Guard flag to prevent change events during config load

const $ = (id) => document.getElementById(id);

function getFormattedPhone(inputId, selectId) {
  let phone = $(inputId).value.trim();
  const countryCode = $(selectId)?.value || '91';
  if (phone) {
    const cleanNum = phone.replace(/[^0-9]/g, '');
    if (!phone.startsWith('+') && !cleanNum.startsWith(countryCode)) {
      phone = `+${countryCode}${cleanNum}`;
    } else if (!phone.startsWith('+')) {
      phone = `+${cleanNum}`;
    }
  }
  return phone;
}

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
  const phone = getFormattedPhone('gate-phone', 'gate-country-code');
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
  const phone = getFormattedPhone('gate-phone', 'gate-country-code');
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

function setPhoneAndSelect(inputId, selectId, fullNumber) {
  const selectEl = $(selectId);
  const inputEl = $(inputId);
  if (!selectEl || !inputEl) return;
  
  if (!fullNumber) {
    inputEl.value = '';
    selectEl.value = '91'; // default to +91
    return;
  }
  
  if (String(fullNumber).includes('@')) {
    inputEl.value = fullNumber;
    return;
  }
  
  // Clean all non-digits
  const digits = String(fullNumber).replace(/[^0-9]/g, '');
  
  // Country codes ordered by descending length to match longest prefix first
  const codes = ['971', '880', '966', '91', '92', '62', '60', '65', '44', '1'];
  
  let matchedCode = '91';
  let restNumber = digits;
  
  for (const code of codes) {
    if (digits.startsWith(code) && digits.length > code.length) {
      matchedCode = code;
      restNumber = digits.substring(code.length);
      break;
    }
  }
  
  selectEl.value = matchedCode;
  inputEl.value = restNumber;
}

function renderConfig(cfg) {
  _loadingConfig = true; // Prevent change events from firing during programmatic value setting
  if ($('prompt-editor')) $('prompt-editor').value = cfg.systemPrompt || '';
  updateCharCount();
  if ($('toggle-enabled')) $('toggle-enabled').checked = !!cfg.botEnabled;
  if ($('toggle-whitelist')) $('toggle-whitelist').checked = !!cfg.whitelistEnabled;
  if ($('toggle-blacklist')) $('toggle-blacklist').checked = !!cfg.blacklistEnabled;
  if ($('holding-reply-input')) $('holding-reply-input').value = cfg.holdingReply || '';
  if ($('admin-notify-number')) {
    setPhoneAndSelect('admin-notify-number', 'admin-notify-country-code', cfg.adminNotifyNumber);
  }
  if ($('auto-pause-hours')) $('auto-pause-hours').value = cfg.autoPauseDurationHours !== undefined ? cfg.autoPauseDurationHours : 12;
  renderWhitelist(cfg.whitelist || []);
  renderBlacklist(cfg.blacklist || []);
  _loadingConfig = false;
}

async function saveAdminNotifyNumber() {
  const inputVal = $('admin-notify-number').value.trim();
  if (!inputVal) {
    try {
      currentConfig = await api('/api/config', {
        method: 'PUT',
        body: JSON.stringify({ adminNotifyNumber: '' }),
      });
      toast('Admin notification number updated', 'success');
    } catch (err) {
      toast('Failed to update admin notify number', 'error');
    }
    return;
  }

  let adminNotifyNumber;
  if (inputVal.includes('@')) {
    adminNotifyNumber = inputVal;
  } else {
    const number = inputVal.replace(/[^0-9]/g, '');
    if (!number) {
      toast('Enter a valid phone number or JID', 'error');
      return;
    }
    const countryCode = $('admin-notify-country-code').value;
    adminNotifyNumber = countryCode + number;
  }

  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ adminNotifyNumber }),
    });
    toast('Admin notification number updated', 'success');
  } catch (err) {
    toast('Failed to update admin notify number', 'error');
  }
}

$('admin-notify-number')?.addEventListener('change', () => { if (!_loadingConfig) saveAdminNotifyNumber(); });
$('admin-notify-country-code')?.addEventListener('change', () => { if (!_loadingConfig) saveAdminNotifyNumber(); });

$('auto-pause-hours')?.addEventListener('change', async (e) => {
  if (_loadingConfig) return; // Don't save during programmatic config load
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
  if (_loadingConfig) return;
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
  if (_loadingConfig) return;
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

// ===== Blacklist enabled toggle =====
$('toggle-blacklist')?.addEventListener('change', async (e) => {
  if (_loadingConfig) return;
  const blacklistEnabled = e.target.checked;
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ blacklistEnabled }),
    });
    toast(blacklistEnabled ? 'Blacklist mode active' : 'No longer blocking numbers', blacklistEnabled ? 'success' : '');
  } catch (err) {
    e.target.checked = !blacklistEnabled; // revert on failure
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

  const inputVal = input.value.trim();
  let fullNumber;

  if (inputVal.includes('@')) {
    fullNumber = inputVal;
  } else {
    const hasPlus = inputVal.startsWith('+');
    let raw = inputVal.replace(/[^0-9]/g, '');
    if (!raw) {
      toast('Enter a valid phone number or JID', 'error');
      return;
    }

    fullNumber = raw;
    const countryCode = countrySelect.value;

    if (hasPlus) {
      // User explicitly entered a full international number with +
      fullNumber = raw;
    } else {
      // Prepend country code if the number doesn't already start with it and is <= 10 digits
      if (!raw.startsWith(countryCode)) {
        if (raw.length <= 10) {
          fullNumber = countryCode + raw;
        }
      }
    }

    if (fullNumber.length < 7) {
      toast('Enter a valid phone number (at least 7 digits)', 'error');
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

// ===== Blacklist =====
function renderBlacklist(list) {
  const wrap = $('blacklist-chips');
  const empty = $('blacklist-empty');
  if (!wrap || !empty) return;
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
    removeBtn.addEventListener('click', () => removeFromBlacklist(number));
    chip.appendChild(removeBtn);
    wrap.appendChild(chip);
  });
}

async function saveBlacklist(list) {
  try {
    currentConfig = await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({ blacklist: list }),
    });
    renderBlacklist(currentConfig.blacklist || []);
  } catch (err) {
    toast('Could not update blacklist', 'error');
  }
}

$('blacklist-add-btn')?.addEventListener('click', () => {
  const input = $('blacklist-input');
  const countrySelect = $('blacklist-country-code');
  if (!input || !countrySelect) return;

  const inputVal = input.value.trim();
  let fullNumber;

  if (inputVal.includes('@')) {
    fullNumber = inputVal;
  } else {
    const hasPlus = inputVal.startsWith('+');
    let raw = inputVal.replace(/[^0-9]/g, '');
    if (!raw) {
      toast('Enter a valid phone number or JID', 'error');
      return;
    }

    fullNumber = raw;
    const countryCode = countrySelect.value;

    if (hasPlus) {
      fullNumber = raw;
    } else {
      // Prepend country code if the number doesn't already start with it and is <= 10 digits
      if (!raw.startsWith(countryCode)) {
        if (raw.length <= 10) {
          fullNumber = countryCode + raw;
        }
      }
    }

    if (fullNumber.length < 7) {
      toast('Enter a valid phone number (at least 7 digits)', 'error');
      return;
    }
  }

  const list = new Set(currentConfig?.blacklist || []);
  if (list.has(fullNumber)) {
    toast('Already on the blacklist');
    input.value = '';
    return;
  }
  list.add(fullNumber);
  input.value = '';
  saveBlacklist([...list]);
});

$('blacklist-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('blacklist-add-btn')?.click();
});

function removeFromBlacklist(number) {
  const list = (currentConfig?.blacklist || []).filter((n) => n !== number);
  saveBlacklist(list);
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
  const phone = getFormattedPhone('pairing-phone', 'pairing-country-code');
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
$('scheduler-channel-add-btn')?.addEventListener('click', async () => {
  const input = $('scheduler-channel-input');
  if (!input) return;
  let val = input.value.trim();
  if (!val) {
    toast('Enter a channel ID or Invite Link', 'error');
    return;
  }

  // If they entered an invite link (URL)
  if (val.startsWith('http://') || val.startsWith('https://') || val.includes('whatsapp.com/channel/')) {
    const btn = $('scheduler-channel-add-btn');
    const oldText = btn.textContent;
    btn.textContent = '⏳ ...';
    btn.disabled = true;
    try {
      let res = await fetch(`${API_BASE}/api/scheduler/channel-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dashboard-key': DASHBOARD_KEY,
        },
        body: JSON.stringify({ link: val }),
      });
      if (res.status === 404) {
        res = await fetch(`${API_BASE}/scheduler/channel-id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-dashboard-key': DASHBOARD_KEY,
          },
          body: JSON.stringify({ link: val }),
        });
      }
      const data = await res.json();
      if (data.success && data.id) {
        val = data.id;
        toast('Channel ID extracted successfully!', 'success');
      } else {
        toast('Failed to extract channel ID: ' + (data.error || 'Check invite link'), 'error');
        btn.textContent = oldText;
        btn.disabled = false;
        return;
      }
    } catch (err) {
      toast('Error extracting channel ID: ' + err.message, 'error');
      btn.textContent = oldText;
      btn.disabled = false;
      return;
    }
    btn.textContent = oldText;
    btn.disabled = false;
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
  bulk: 'Bulk Send',
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

// ===== Bulk Send =====
let bulkData = null;       // { headers, normalizedHeaders, rows, phoneColumn, nameColumn }
let bulkTemplate = '';
let bulkPollTimer = null;

function bulkGoToStep(step) {
  // Update step indicators
  document.querySelectorAll('.bulk-step-indicator').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('completed');
  });
  // Show/hide stages
  document.querySelectorAll('.bulk-stage').forEach(el => el.classList.remove('active'));
  const stage = $('bulk-stage-' + step);
  if (stage) stage.classList.add('active');
}

// ── Step 1: Upload ──

const uploadZone = $('bulk-upload-zone');
const fileInput = $('bulk-file-input');

if (uploadZone) {
  uploadZone.addEventListener('click', () => fileInput?.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleBulkFile(e.dataTransfer.files[0]);
    }
  });
}

fileInput?.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleBulkFile(e.target.files[0]);
  }
});

async function handleBulkFile(file) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    toast('File too large. Max 10MB.', 'error');
    return;
  }

  // Show loading state
  if (uploadZone) {
    uploadZone.innerHTML = `
      <div class="upload-icon">⏳</div>
      <div class="upload-text">Parsing file...</div>
    `;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/api/bulk/upload`, {
      method: 'POST',
      headers: { 'x-dashboard-key': DASHBOARD_KEY },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');

    bulkData = data;

    // Reset upload zone
    if (uploadZone) {
      uploadZone.innerHTML = `
        <div class="upload-icon">📁</div>
        <div class="upload-text">Drop your file here or click to browse</div>
        <div class="upload-hint">Supports .xlsx, .xls, .txt, .csv — Max 10MB</div>
      `;
    }

    // Show file info
    const fileInfoEl = $('bulk-file-info');
    if (fileInfoEl) {
      const ext = file.name.split('.').pop().toUpperCase();
      fileInfoEl.style.display = 'flex';
      fileInfoEl.innerHTML = `
        <div class="bulk-file-info">
          <span class="file-icon">${ext === 'XLSX' || ext === 'XLS' ? '📊' : '📄'}</span>
          <div class="file-details">
            <div class="file-name">${escapeHtml(file.name)}</div>
            <div class="file-meta">${data.totalRows} rows • ${data.headers.length} columns</div>
          </div>
          <button class="btn btn-ghost" onclick="bulkResetUpload()" style="font-size:18px;padding:4px;">✕</button>
        </div>
      `;
    }

    // Populate phone column dropdown
    const phoneSelect = $('bulk-phone-column');
    if (phoneSelect) {
      phoneSelect.innerHTML = '<option value="">-- Select phone column --</option>';
      data.normalizedHeaders.forEach((nh, idx) => {
        const opt = document.createElement('option');
        opt.value = nh;
        opt.textContent = data.headers[idx];
        if (nh === data.phoneColumn) opt.selected = true;
        phoneSelect.appendChild(opt);
      });
    }

    // Show data preview table
    renderBulkPreviewTable(data);

    // Enable Next button
    if ($('bulk-next-1')) $('bulk-next-1').disabled = false;

    toast(`Parsed ${data.totalRows} rows successfully!`, 'success');
  } catch (err) {
    toast(err.message || 'Failed to parse file', 'error');
    // Reset upload zone on error
    if (uploadZone) {
      uploadZone.innerHTML = `
        <div class="upload-icon">📁</div>
        <div class="upload-text">Drop your file here or click to browse</div>
        <div class="upload-hint">Supports .xlsx, .xls, .txt, .csv — Max 10MB</div>
      `;
    }
  }
}

function renderBulkPreviewTable(data) {
  const wrap = $('bulk-table-preview');
  if (!wrap) return;
  wrap.style.display = 'block';

  const maxPreviewRows = Math.min(data.rows.length, 10);
  let html = '<div class="bulk-table-wrap"><table class="bulk-table"><thead><tr>';
  data.headers.forEach(h => { html += `<th>${escapeHtml(h)}</th>`; });
  html += '</tr></thead><tbody>';

  for (let i = 0; i < maxPreviewRows; i++) {
    html += '<tr>';
    data.normalizedHeaders.forEach(nh => {
      html += `<td>${escapeHtml(data.rows[i][nh] || '')}</td>`;
    });
    html += '</tr>';
  }
  if (data.rows.length > maxPreviewRows) {
    html += `<tr><td colspan="${data.headers.length}" style="text-align:center;color:var(--text-muted);font-style:italic;">…and ${data.rows.length - maxPreviewRows} more rows</td></tr>`;
  }
  html += '</tbody></table></div>';
  wrap.innerHTML = html;
}

function bulkResetUpload() {
  bulkData = null;
  if ($('bulk-file-info')) $('bulk-file-info').style.display = 'none';
  if ($('bulk-table-preview')) { $('bulk-table-preview').style.display = 'none'; $('bulk-table-preview').innerHTML = ''; }
  if ($('bulk-phone-column')) $('bulk-phone-column').innerHTML = '<option value="">-- Auto-detected --</option>';
  if ($('bulk-next-1')) $('bulk-next-1').disabled = true;
  if (fileInput) fileInput.value = '';
}

$('bulk-next-1')?.addEventListener('click', () => {
  if (!bulkData) { toast('Upload a file first', 'error'); return; }

  // Get selected phone column
  const phoneCol = $('bulk-phone-column')?.value || bulkData.phoneColumn;
  if (!phoneCol) {
    toast('Please select the phone number column', 'error');
    return;
  }
  bulkData.phoneColumn = phoneCol;

  // Render available fields in Step 2
  const fieldsEl = $('bulk-available-fields');
  if (fieldsEl) {
    fieldsEl.innerHTML = '';
    bulkData.normalizedHeaders.forEach(nh => {
      const chip = document.createElement('span');
      chip.className = 'bulk-placeholder-chip';
      chip.textContent = `{{${nh}}}`;
      fieldsEl.appendChild(chip);
    });
  }

  bulkGoToStep(2);
});

// ── Step 2: Purpose ──

$('bulk-back-2')?.addEventListener('click', () => bulkGoToStep(1));

$('bulk-generate-btn')?.addEventListener('click', async () => {
  const purpose = $('bulk-purpose')?.value.trim();
  if (!purpose) { toast('Please describe the purpose of the message', 'error'); return; }
  if (!bulkData) { toast('No data loaded', 'error'); return; }

  const btn = $('bulk-generate-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

  try {
    const res = await fetch(`${API_BASE}/api/bulk/generate-template`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dashboard-key': DASHBOARD_KEY,
      },
      body: JSON.stringify({
        purpose,
        columns: bulkData.normalizedHeaders,
        sampleRow: bulkData.rows[0],
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Template generation failed');

    bulkTemplate = data.template;
    if ($('bulk-template-editor')) $('bulk-template-editor').value = data.template;

    // Render placeholder chips for step 3
    renderBulkTemplateChips();
    updateBulkPreview();

    toast('Template generated!', 'success');
    bulkGoToStep(3);
  } catch (err) {
    toast(err.message || 'Failed to generate template', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Generate Template'; }
  }
});

// ── Step 3: Template ──

function renderBulkTemplateChips() {
  const el = $('bulk-template-fields');
  if (!el || !bulkData) return;
  el.innerHTML = '';
  bulkData.normalizedHeaders.forEach(nh => {
    const chip = document.createElement('span');
    chip.className = 'bulk-placeholder-chip';
    chip.textContent = `{{${nh}}}`;
    chip.addEventListener('click', () => {
      const editor = $('bulk-template-editor');
      if (!editor) return;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const text = editor.value;
      editor.value = text.substring(0, start) + `{{${nh}}}` + text.substring(end);
      editor.focus();
      editor.selectionStart = editor.selectionEnd = start + nh.length + 4;
      updateBulkPreview();
    });
    el.appendChild(chip);
  });
}

function updateBulkPreview() {
  const template = $('bulk-template-editor')?.value || '';
  const previewEl = $('bulk-preview-msg');
  if (!previewEl || !bulkData || !bulkData.rows.length) return;

  const firstRow = bulkData.rows[0];
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return firstRow[key] !== undefined ? firstRow[key] : match;
  });
  previewEl.textContent = rendered || '—';
}

$('bulk-template-editor')?.addEventListener('input', updateBulkPreview);

$('bulk-back-3')?.addEventListener('click', () => bulkGoToStep(2));

$('bulk-next-3')?.addEventListener('click', () => {
  const template = $('bulk-template-editor')?.value.trim();
  if (!template) { toast('Template cannot be empty', 'error'); return; }
  bulkTemplate = template;

  // Update Step 4 summary
  if ($('bulk-send-summary')) {
    $('bulk-send-summary').textContent = `Will send personalized messages to ${bulkData.rows.length} recipients using phone column "${bulkData.phoneColumn}".`;
  }
  // Update Step 4 preview
  if ($('bulk-send-preview') && bulkData && bulkData.rows.length) {
    const firstRow = bulkData.rows[0];
    const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return firstRow[key] !== undefined ? firstRow[key] : match;
    });
    $('bulk-send-preview').textContent = rendered;
  }

  bulkGoToStep(4);
});

// ── Step 4: Send ──

$('bulk-back-4')?.addEventListener('click', () => bulkGoToStep(3));

$('bulk-send-btn')?.addEventListener('click', async () => {
  if (!bulkTemplate || !bulkData) { toast('Missing template or data', 'error'); return; }

  const btn = $('bulk-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Starting…'; }
  if ($('bulk-back-4')) $('bulk-back-4').disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/bulk/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dashboard-key': DASHBOARD_KEY,
      },
      body: JSON.stringify({
        template: bulkTemplate,
        rows: bulkData.rows,
        phoneColumn: bulkData.phoneColumn,
        countryCode: $('bulk-country-code')?.value || '91',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start sending');

    toast('Bulk sending started!', 'success');

    // Show progress UI
    if ($('bulk-progress-wrap')) $('bulk-progress-wrap').style.display = 'block';
    if ($('bulk-send-log')) { $('bulk-send-log').style.display = 'block'; $('bulk-send-log').innerHTML = ''; }
    if ($('bulk-cancel-row')) $('bulk-cancel-row').style.display = 'flex';
    if ($('bulk-stat-total')) $('bulk-stat-total').textContent = data.total || bulkData.rows.length;

    // Start polling progress
    startBulkProgressPoll();
  } catch (err) {
    toast(err.message || 'Failed to start sending', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📨 Start Sending'; }
    if ($('bulk-back-4')) $('bulk-back-4').disabled = false;
  }
});

function startBulkProgressPoll() {
  if (bulkPollTimer) clearInterval(bulkPollTimer);
  bulkPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/bulk/progress`, {
        headers: { 'x-dashboard-key': DASHBOARD_KEY },
      });
      const data = await res.json();
      if (!data.success) return;

      updateBulkProgress(data);

      if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'error') {
        clearInterval(bulkPollTimer);
        bulkPollTimer = null;
        onBulkSendComplete(data);
      }
    } catch (_) {}
  }, 1500);
}

function updateBulkProgress(data) {
  const total = data.total || 1;
  const sent = data.sent || 0;
  const failed = data.failed || 0;
  const pct = Math.round(((sent + failed) / total) * 100);

  if ($('bulk-progress-fill')) $('bulk-progress-fill').style.width = pct + '%';
  if ($('bulk-stat-sent')) $('bulk-stat-sent').textContent = sent;
  if ($('bulk-stat-total')) $('bulk-stat-total').textContent = total;
  if ($('bulk-stat-failed')) $('bulk-stat-failed').textContent = failed;
  if ($('bulk-stat-status')) $('bulk-stat-status').textContent = data.status === 'sending' ? 'Sending…' : data.status;

  // Update log
  const logEl = $('bulk-send-log');
  if (logEl && data.errors && data.errors.length > 0) {
    const lastShown = parseInt(logEl.dataset.lastError || '0');
    for (let i = lastShown; i < data.errors.length; i++) {
      const err = data.errors[i];
      const entry = document.createElement('div');
      entry.style.color = 'var(--wa-danger)';
      entry.textContent = `❌ Row ${err.row}: ${err.error}`;
      logEl.appendChild(entry);
    }
    logEl.dataset.lastError = data.errors.length;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function onBulkSendComplete(data) {
  const statusText = data.status === 'completed' ? '✅ Completed' : data.status === 'cancelled' ? '⏹ Cancelled' : '❌ Error';
  if ($('bulk-stat-status')) $('bulk-stat-status').textContent = statusText;
  if ($('bulk-send-btn')) { $('bulk-send-btn').disabled = true; $('bulk-send-btn').textContent = statusText; }
  if ($('bulk-cancel-row')) $('bulk-cancel-row').style.display = 'none';
  if ($('bulk-done-row')) $('bulk-done-row').style.display = 'flex';

  const logEl = $('bulk-send-log');
  if (logEl) {
    const entry = document.createElement('div');
    entry.style.color = 'var(--wa-green)';
    entry.style.fontWeight = '600';
    entry.textContent = `${statusText} — ${data.sent || 0} sent, ${data.failed || 0} failed out of ${data.total || 0}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  toast(`Bulk send ${data.status}: ${data.sent || 0} sent, ${data.failed || 0} failed`, data.status === 'completed' ? 'success' : 'error');
}

$('bulk-cancel-btn')?.addEventListener('click', async () => {
  try {
    await fetch(`${API_BASE}/api/bulk/cancel`, {
      method: 'POST',
      headers: { 'x-dashboard-key': DASHBOARD_KEY },
    });
    toast('Cancelling…', '');
  } catch (_) {}
});

$('bulk-new-btn')?.addEventListener('click', () => {
  // Reset everything
  bulkData = null;
  bulkTemplate = '';
  bulkResetUpload();
  if ($('bulk-purpose')) $('bulk-purpose').value = '';
  if ($('bulk-template-editor')) $('bulk-template-editor').value = '';
  if ($('bulk-preview-msg')) $('bulk-preview-msg').textContent = '—';
  if ($('bulk-send-preview')) $('bulk-send-preview').textContent = '—';
  if ($('bulk-send-summary')) $('bulk-send-summary').textContent = '—';
  if ($('bulk-progress-wrap')) $('bulk-progress-wrap').style.display = 'none';
  if ($('bulk-progress-fill')) $('bulk-progress-fill').style.width = '0%';
  if ($('bulk-send-log')) { $('bulk-send-log').style.display = 'none'; $('bulk-send-log').innerHTML = ''; $('bulk-send-log').dataset.lastError = '0'; }
  if ($('bulk-cancel-row')) $('bulk-cancel-row').style.display = 'none';
  if ($('bulk-done-row')) $('bulk-done-row').style.display = 'none';
  if ($('bulk-send-btn')) { $('bulk-send-btn').disabled = false; $('bulk-send-btn').textContent = '📨 Start Sending'; }
  if ($('bulk-back-4')) $('bulk-back-4').disabled = false;
  if ($('bulk-stat-sent')) $('bulk-stat-sent').textContent = '0';
  if ($('bulk-stat-failed')) $('bulk-stat-failed').textContent = '0';
  if ($('bulk-stat-total')) $('bulk-stat-total').textContent = '0';
  bulkGoToStep(1);
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

