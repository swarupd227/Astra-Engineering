/**
 * DevX QE Recorder — popup.js
 * Controls the extension popup UI. Communicates with background.js via chrome.runtime.sendMessage.
 */

// ─── DOM References ───────────────────────────────────────────────────────────

const statusDot    = document.getElementById('statusDot');
const statusLabel  = document.getElementById('statusLabel');
const sessionInput = document.getElementById('sessionInput');
const btnJoin      = document.getElementById('btnJoin');
const btnLeave     = document.getElementById('btnLeave');
const btnRecord    = document.getElementById('btnRecord');
const sessionInputRow = document.getElementById('sessionInputRow');
const sessionBadge    = document.getElementById('sessionBadge');
const badgeCode       = document.getElementById('badgeCode');
const sessionMessage  = document.getElementById('sessionMessage');
const eventCounter    = document.getElementById('eventCounter');
const eventFeed       = document.getElementById('eventFeed');
const emptyFeed       = document.getElementById('emptyFeed');
const countClicks     = document.getElementById('countClicks');
const countInputs     = document.getElementById('countInputs');
const countNavs       = document.getElementById('countNavs');
const countApis       = document.getElementById('countApis');
const openNat20       = document.getElementById('openNat20');
const settingsToggle  = document.getElementById('settingsToggle');
const settingsPanel   = document.getElementById('settingsPanel');
const serverUrlInput  = document.getElementById('serverUrlInput');
const btnSaveUrl      = document.getElementById('btnSaveUrl');
const settingsMessage = document.getElementById('settingsMessage');

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  connected: false,
  sessionJoined: false,
  sessionId: null,
  isRecording: false,
  counts: { clicks: 0, inputs: 0, navs: 0, apis: 0 }
};

const recentEvents = [];
const MAX_FEED_EVENTS = 20;

// ─── Background Communication ─────────────────────────────────────────────────

function sendToBackground(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { source: 'devxqe-popup', action, ...data },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      }
    );
  });
}

// ─── UI Updaters ──────────────────────────────────────────────────────────────

function updateConnectionStatus(connected, maxRetriesReached = false) {
  state.connected = connected;
  statusDot.className = 'status-dot' + (connected ? ' connected' : '');
  if (maxRetriesReached) {
    statusLabel.textContent = 'Cannot reach server — check Server Settings';
  } else {
    statusLabel.textContent = connected ? 'Connected to DevX QE server' : 'Connecting to server...';
  }
  btnJoin.disabled = !connected || state.sessionJoined;
}

function updateSessionUI() {
  if (state.sessionJoined && state.sessionId) {
    sessionInputRow.style.display = 'none';
    sessionBadge.classList.add('visible');
    badgeCode.textContent = state.sessionId;
    btnRecord.disabled = false;
  } else {
    sessionInputRow.style.display = 'flex';
    sessionBadge.classList.remove('visible');
    btnRecord.disabled = true;
  }
}

function updateRecordingUI() {
  if (state.isRecording) {
    btnRecord.className = 'btn-record stop';
    btnRecord.innerHTML = '<div class="record-dot"></div> Stop Recording';
    statusDot.className = 'status-dot recording';
    statusLabel.textContent = 'Recording in progress...';
    eventCounter.style.display = 'flex';
    eventFeed.style.display = 'block';
    btnLeave.disabled = true;
    btnJoin.disabled = true;
    sessionInput.disabled = true;
  } else {
    btnRecord.className = 'btn-record start';
    btnRecord.innerHTML = '<div class="record-dot"></div> Start Recording';
    statusDot.className = 'status-dot' + (state.connected ? ' connected' : '');
    statusLabel.textContent = state.connected ? 'Connected to DevX QE server' : 'Connecting...';
    btnLeave.disabled = false;
    sessionInput.disabled = false;
  }
}

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = `message-box visible ${type}`;
  if (type !== 'error') {
    setTimeout(() => { el.classList.remove('visible'); }, 3000);
  }
}

function hideMessage(el) {
  el.classList.remove('visible');
}

// ─── Event Feed ───────────────────────────────────────────────────────────────

const EVENT_ICONS = {
  click: '🖱️',
  input: '⌨️',
  select: '📋',
  navigation: '🔗',
  page_load: '📄',
  api_call: '📡'
};

const EVENT_TYPE_LABELS = {
  click: 'CLICK',
  input: 'INPUT',
  select: 'SELECT',
  navigation: 'NAV',
  page_load: 'PAGE',
  api_call: 'API'
};

function addEventToFeed(event) {
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_FEED_EVENTS) recentEvents.pop();

  // Update counters
  if (event.type === 'click') { state.counts.clicks++; countClicks.textContent = state.counts.clicks; }
  if (event.type === 'input' || event.type === 'select') { state.counts.inputs++; countInputs.textContent = state.counts.inputs; }
  if (event.type === 'navigation' || event.type === 'page_load') { state.counts.navs++; countNavs.textContent = state.counts.navs; }
  if (event.type === 'api_call') { state.counts.apis++; countApis.textContent = state.counts.apis; }

  // Rebuild feed
  renderEventFeed();
}

function renderEventFeed() {
  if (recentEvents.length === 0) {
    emptyFeed.style.display = 'block';
    return;
  }
  emptyFeed.style.display = 'none';

  // Clear existing items
  const existing = eventFeed.querySelectorAll('.event-item');
  existing.forEach(el => el.remove());

  recentEvents.forEach(event => {
    const item = document.createElement('div');
    item.className = 'event-item';

    const icon = document.createElement('span');
    icon.className = 'event-icon';
    icon.textContent = EVENT_ICONS[event.type] || '•';

    const desc = document.createElement('span');
    desc.className = 'event-desc';
    desc.textContent = getEventDescription(event);

    const badge = document.createElement('span');
    badge.className = `event-type ${event.type === 'api_call' ? 'api' : event.type === 'navigation' || event.type === 'page_load' ? 'nav' : event.type}`;
    badge.textContent = EVENT_TYPE_LABELS[event.type] || event.type.toUpperCase();

    item.appendChild(icon);
    item.appendChild(desc);
    item.appendChild(badge);
    eventFeed.appendChild(item);
  });
}

function getEventDescription(event) {
  switch (event.type) {
    case 'click':
      return event.element?.description || 'Unknown element';
    case 'input':
      return `${event.element?.label || event.element?.description || 'Field'}: ${event.isMasked ? '***' : (event.value || '')}`;
    case 'select':
      return `${event.element?.label || 'Dropdown'}: ${event.displayText || event.value}`;
    case 'navigation':
      return event.toUrl ? new URL(event.toUrl).pathname : 'Page changed';
    case 'page_load':
      return event.pageTitle || event.url || 'Page loaded';
    case 'api_call':
      return `${event.method} ${event.url ? new URL(event.url).pathname : ''}`;
    default:
      return JSON.stringify(event).slice(0, 60);
  }
}

function resetCounts() {
  state.counts = { clicks: 0, inputs: 0, navs: 0, apis: 0 };
  countClicks.textContent = '0';
  countInputs.textContent = '0';
  countNavs.textContent = '0';
  countApis.textContent = '0';
  recentEvents.length = 0;
  renderEventFeed();
}

// ─── Button Handlers ──────────────────────────────────────────────────────────

btnJoin.addEventListener('click', async () => {
  const code = sessionInput.value.trim().toUpperCase();
  if (!code) {
    showMessage(sessionMessage, 'Please enter a session code from DevX QE', 'error');
    return;
  }
  if (code.length < 3) {
    showMessage(sessionMessage, 'Session code too short', 'error');
    return;
  }

  btnJoin.disabled = true;
  btnJoin.textContent = '...';
  hideMessage(sessionMessage);

  try {
    const res = await sendToBackground('JOIN_SESSION', { sessionId: code });
    if (res?.success) {
      state.sessionId = code;
      state.sessionJoined = true;
      updateSessionUI();
      showMessage(sessionMessage, 'Session joined! Ready to record.', 'success');
    } else {
      showMessage(sessionMessage, res?.error || 'Failed to join session', 'error');
      btnJoin.disabled = false;
      btnJoin.textContent = 'Join';
    }
  } catch (err) {
    showMessage(sessionMessage, 'Could not reach background service', 'error');
    btnJoin.disabled = false;
    btnJoin.textContent = 'Join';
  }
});

btnLeave.addEventListener('click', async () => {
  if (state.isRecording) return;
  state.sessionJoined = false;
  state.sessionId = null;
  sessionInput.value = '';
  updateSessionUI();
  hideMessage(sessionMessage);
  eventCounter.style.display = 'none';
  eventFeed.style.display = 'none';
  resetCounts();
});

btnRecord.addEventListener('click', async () => {
  if (!state.sessionJoined) return;

  if (!state.isRecording) {
    // Start recording
    resetCounts();
    try {
      const res = await sendToBackground('START_RECORDING');
      if (res?.success) {
        state.isRecording = true;
        updateRecordingUI();
      } else {
        showMessage(sessionMessage, res?.error || 'Failed to start recording', 'error');
      }
    } catch (err) {
      showMessage(sessionMessage, 'Could not start recording', 'error');
    }
  } else {
    // Stop recording
    try {
      await sendToBackground('STOP_RECORDING');
      state.isRecording = false;
      updateRecordingUI();
      showMessage(sessionMessage, `Recording saved: ${state.counts.clicks + state.counts.inputs + state.counts.navs + state.counts.apis} events captured`, 'success');
    } catch (err) {
      showMessage(sessionMessage, 'Could not stop recording', 'error');
    }
  }
});

openNat20.addEventListener('click', () => {
  sendToBackground('GET_STATUS').then(status => {
    const url = status?.httpBaseUrl || 'http://localhost:4000/qe/dashboard';
    chrome.tabs.create({ url });
  }).catch(() => {
    chrome.tabs.create({ url: 'http://localhost:4000/qe/dashboard' });
  });
});

// ─── Settings Panel ───────────────────────────────────────────────────────────

settingsToggle.addEventListener('click', () => {
  const isOpen = settingsPanel.classList.contains('visible');
  settingsPanel.classList.toggle('visible', !isOpen);
  settingsToggle.classList.toggle('open', !isOpen);
});

btnSaveUrl.addEventListener('click', async () => {
  const url = serverUrlInput.value.trim();
  if (!url) {
    showMessage(settingsMessage, 'Please enter a server URL', 'error');
    return;
  }
  btnSaveUrl.disabled = true;
  btnSaveUrl.textContent = '...';
  try {
    const res = await sendToBackground('SET_SERVER_URL', { serverUrl: url });
    if (res?.success) {
      showMessage(settingsMessage, 'Saved — reconnecting...', 'success');
    } else {
      showMessage(settingsMessage, res?.error || 'Failed to save', 'error');
    }
  } catch {
    showMessage(settingsMessage, 'Could not reach background service', 'error');
  } finally {
    btnSaveUrl.disabled = false;
    btnSaveUrl.textContent = 'Save';
  }
});

// ─── Session input — allow Enter key ─────────────────────────────────────────

sessionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

sessionInput.addEventListener('input', () => {
  sessionInput.value = sessionInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
});

// ─── Background Messages (push updates) ──────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source !== 'devxqe-background') return;

  switch (msg.type) {
    case 'CONNECTION_STATUS':
      updateConnectionStatus(msg.connected, msg.maxRetriesReached);
      break;

    case 'SESSION_CONFIRMED':
      state.sessionId = msg.sessionId;
      state.sessionJoined = true;
      updateSessionUI();
      break;

    case 'SESSION_INVALID':
      state.sessionJoined = false;
      state.sessionId = null;
      updateSessionUI();
      showMessage(sessionMessage, msg.message || 'Invalid session code', 'error');
      break;

    case 'RECORDING_STOPPED':
      state.isRecording = false;
      updateRecordingUI();
      break;

    case 'RECORDING_EVENT':
      if (msg.event) addEventToFeed(msg.event);
      break;

    case 'SERVER_URL_CHANGED':
      serverUrlInput.value = msg.serverUrl || '';
      updateConnectionStatus(false);
      break;
  }
});

// ─── Init: Load current state from background ─────────────────────────────────

async function init() {
  try {
    const status = await sendToBackground('GET_STATUS');
    if (status) {
      updateConnectionStatus(status.connected);
      // Populate server URL field
      if (status.serverUrl) {
        serverUrlInput.value = status.serverUrl;
      }
      if (status.sessionId) {
        state.sessionId = status.sessionId;
        state.sessionJoined = true;
        updateSessionUI();
      }
      if (status.isRecording) {
        state.isRecording = true;
        updateRecordingUI();
        eventCounter.style.display = 'flex';
        eventFeed.style.display = 'block';
      }
    }
  } catch {
    updateConnectionStatus(false);
  }
}

init();
