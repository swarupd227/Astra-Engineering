/**
 * DevX QE Recorder — background.js
 * Service worker. Manages connection to the DevX QE recorder.
 *
 * Two transports are supported, picked at runtime based on serverUrl scheme
 * (or an explicit `transport` setting in chrome.storage):
 *   - Raw WebSocket   (`ws://` / `wss://` URLs)  → /ws/recorder
 *   - Socket.IO       (`http://` / `https://` URLs) → /socket.io/  namespace=/recorder
 *
 * Use Socket.IO when the deployment sits behind a proxy chain that only
 * allow-lists Socket.IO traffic on `/socket.io/*` (e.g. Hilti's
 * Akamai → ALB → Apache → ALB → Istio path which strips the raw `/ws/*`
 * upgrade and serves the SPA's index.html instead).
 *
 * Bridges content.js events → server → NAT 2.0 UI.
 */

// Lazily import the socket.io-client browser bundle. Only consulted when the
// chosen transport is socket.io; the import itself is cheap (~46 KB) and
// MV3 service workers re-execute this top-level on wake, so there's no need
// for a guard.
try {
  importScripts('socket.io.min.js');
} catch (e) {
  console.warn('[DevXQE] socket.io.min.js failed to load -- Socket.IO transport will not work', e);
}

const DEFAULT_SERVER_URL = 'ws://localhost:4000';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

let serverUrl = DEFAULT_SERVER_URL; // overridden by chrome.storage on init
let transportPref = ''; // '' = auto-from-URL, 'ws', or 'socket.io' (chrome.storage override)
/**
 * Active transport handle. Both raw-WS and Socket.IO clients populate this
 * shape so the rest of the service worker doesn't care which is in use.
 *   { kind, send(obj), close(), isOpen() }
 */
let conn = null;
let sessionId = null;
let joinToken = null; // token for authenticated session join
let isRecording = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let pendingEvents = []; // Buffer events while disconnected

function resolveTransport() {
  const explicit = (transportPref || '').toLowerCase();
  if (explicit === 'socket.io' || explicit === 'socketio') return 'socket.io';
  if (explicit === 'ws' || explicit === 'websocket') return 'ws';
  // Default: infer from URL scheme. http(s) → socket.io, ws(s) → raw ws.
  if (/^https?:\/\//i.test(serverUrl)) return 'socket.io';
  return 'ws';
}

function getRecorderWsUrl() {
  const base = serverUrl.replace(/\/$/, '');
  // Ensure ws:// or wss:// protocol
  if (base.startsWith('http://')) return base.replace('http://', 'ws://') + '/ws/recorder';
  if (base.startsWith('https://')) return base.replace('https://', 'wss://') + '/ws/recorder';
  if (base.startsWith('ws://') || base.startsWith('wss://')) return base + '/ws/recorder';
  return 'ws://' + base + '/ws/recorder';
}

function getHttpBaseUrl() {
  const base = serverUrl.replace(/\/$/, '');
  if (base.startsWith('ws://')) return base.replace('ws://', 'http://');
  if (base.startsWith('wss://')) return base.replace('wss://', 'https://');
  if (base.startsWith('http://') || base.startsWith('https://')) return base;
  return 'http://' + base;
}

function getSocketIOOrigin() {
  const base = serverUrl.replace(/\/$/, '');
  if (base.startsWith('ws://')) return base.replace('ws://', 'http://');
  if (base.startsWith('wss://')) return base.replace('wss://', 'https://');
  if (base.startsWith('http://') || base.startsWith('https://')) return base;
  return 'http://' + base;
}

// ─── Connection Management ───────────────────────────────────────────────────

function connectTransport() {
  if (conn && conn.isOpen()) return;

  const t = resolveTransport();
  if (t === 'socket.io') connectSocketIO();
  else connectWs();
}

// Back-compat alias used elsewhere in this file (and still spelled
// "WebSocket" in popup messages / external messages).
function connectWebSocket() { connectTransport(); }

function connectWs() {
  let ws;
  try {
    ws = new WebSocket(getRecorderWsUrl());
  } catch (err) {
    console.warn('[DevXQE] WebSocket constructor failed', err);
    scheduleReconnect();
    return;
  }

  conn = {
    kind: 'ws',
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    },
    close: () => { try { ws.close(); } catch {} },
    isOpen: () => ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING,
  };

  ws.onopen = () => {
    console.log('[DevXQE] WebSocket connected to', getRecorderWsUrl());
    onTransportOpen();
  };

  ws.onclose = () => {
    console.log('[DevXQE] WebSocket disconnected from', getRecorderWsUrl());
    if (conn && conn.kind === 'ws') conn = null;
    onTransportClose();
  };

  ws.onerror = (err) => {
    console.warn('[DevXQE] WebSocket error', err);
  };

  ws.onmessage = (event) => {
    try {
      handleServerMessage(JSON.parse(event.data));
    } catch {}
  };
}

function connectSocketIO() {
  if (typeof self.io !== 'function') {
    console.warn('[DevXQE] socket.io-client not loaded; cannot use Socket.IO transport. Falling back to WebSocket.');
    connectWs();
    return;
  }

  const origin = getSocketIOOrigin();
  const namespaceUrl = `${origin}/recorder`;
  const socket = self.io(namespaceUrl, {
    transports: ['websocket', 'polling'],
    reconnection: false, // we manage reconnect ourselves
    withCredentials: false,
  });

  conn = {
    kind: 'socket.io',
    send: (data) => {
      if (!socket.connected) return;
      const { type, ...payload } = data;
      socket.emit(type, payload);
    },
    close: () => { try { socket.disconnect(); } catch {} },
    isOpen: () => socket.connected,
  };

  socket.on('connect', () => {
    console.log('[DevXQE] Socket.IO connected to', namespaceUrl);
    onTransportOpen();
  });

  // Inbound events: route through the same dispatcher the WS path uses.
  const inbound = ['session_confirmed', 'session_invalid', 'stop_recording', 'pong'];
  for (const evt of inbound) {
    socket.on(evt, (payload) => {
      handleServerMessage({ type: evt, ...(payload || {}) });
    });
  }

  socket.on('disconnect', (reason) => {
    console.log('[DevXQE] Socket.IO disconnected from', namespaceUrl, '(' + reason + ')');
    if (conn && conn.kind === 'socket.io') conn = null;
    onTransportClose();
  });

  socket.on('connect_error', (err) => {
    console.warn('[DevXQE] Socket.IO connect_error:', err && err.message);
  });
}

function onTransportOpen() {
  reconnectAttempts = 0;

  // Identify this extension (no-op on the server for already-known types,
  // but we keep it for protocol parity with the WS path).
  conn.send({ type: 'extension_connect', clientType: 'chrome_extension' });

  if (sessionId) {
    const joinMsg = { type: 'join_session', sessionId };
    if (joinToken) joinMsg.joinToken = joinToken;
    conn.send(joinMsg);
  }

  if (pendingEvents.length > 0) {
    pendingEvents.forEach(evt => { try { conn.send(evt); } catch {} });
    pendingEvents = [];
  }

  broadcastToPopup({ type: 'CONNECTION_STATUS', connected: true });
}

function onTransportClose() {
  broadcastToPopup({ type: 'CONNECTION_STATUS', connected: false });
  scheduleReconnect();
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn('[DevXQE] Max reconnect attempts reached');
    broadcastToPopup({ type: 'CONNECTION_STATUS', connected: false, maxRetriesReached: true });
    return;
  }
  reconnectAttempts++;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectTransport, RECONNECT_DELAY_MS);
}

function sendToServer(data) {
  if (conn && conn.isOpen()) {
    conn.send(data);
  } else {
    pendingEvents.push(data);
    connectTransport();
  }
}

// ─── Server Message Handler ───────────────────────────────────────────────────

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'session_confirmed':
      sessionId = msg.sessionId;
      broadcastToPopup({ type: 'SESSION_CONFIRMED', sessionId });
      break;
    case 'session_invalid':
      broadcastToPopup({ type: 'SESSION_INVALID', message: msg.message || 'Invalid session code' });
      break;
    case 'stop_recording':
      // Server requested stop (e.g., NAT 2.0 user clicked stop)
      stopRecording();
      broadcastToPopup({ type: 'RECORDING_STOPPED', reason: 'server_request' });
      break;
    case 'pong':
      // Keep-alive response
      break;
  }
}

// ─── Recording Control ────────────────────────────────────────────────────────

async function startRecording(sid) {
  sessionId = sid;
  isRecording = true;
  chrome.storage.session.set({ isRecording: true, sessionId: sid });

  // Join session on server (include joinToken if available)
  const joinMsg = { type: 'join_session', sessionId: sid };
  if (joinToken) joinMsg.joinToken = joinToken;
  sendToServer(joinMsg);

  // Inject content script into ALL eligible tabs (not just active)
  // so recording works even if the target site is already open in a background tab
  // Skip the DevX/NAT app itself (where Recording Studio lives) — determined by serverUrl
  const appOrigin = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace(/\/+$/, '');
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')
        && !tab.url.startsWith(appOrigin)) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING', sessionId: sid });
      } catch {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING', sessionId: sid });
        } catch {}
      }
    }
  }

  broadcastToPopup({ type: 'RECORDING_STARTED', sessionId: sid });
}

async function stopRecording() {
  isRecording = false;
  chrome.storage.session.set({ isRecording: false, sessionId: null });

  // Notify all tabs to stop
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
      } catch {}
    }
  }

  // Notify server
  if (sessionId) {
    sendToServer({ type: 'recording_stopped', sessionId });
  }

  broadcastToPopup({ type: 'RECORDING_STOPPED', reason: 'user_request' });
}

// ─── New Tab: Inject content script + start recording if active ───────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isRecording && sessionId) {
    const natOrigin = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace(/\/+$/, '');
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')
        && !tab.url.startsWith(natOrigin)) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING', sessionId });
      } catch {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING', sessionId });
        } catch {}
      }
    }
  }
});

// ─── Screenshot capture ───────────────────────────────────────────────────────

let screenshotDebounceTimer = null;

async function captureAndSendScreenshot(tabId, sid) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 });
    sendToServer({
      type: 'recording_event',
      sessionId: sid,
      event: {
        source: 'devxqe-content',
        type: 'screenshot',
        sessionId: sid,
        timestamp: Date.now(),
        dataUrl,
        url: '',
        pageTitle: ''
      }
    });
  } catch {
    // Tab may not be capturable (e.g. chrome:// pages)
  }
}

function debouncedScreenshot(tabId, sid) {
  clearTimeout(screenshotDebounceTimer);
  screenshotDebounceTimer = setTimeout(() => captureAndSendScreenshot(tabId, sid), 600);
}

// ─── Content Script → Background Bridge ──────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.source === 'devxqe-popup') {
    handlePopupMessage(msg, sendResponse);
    return true; // keep channel open for async response
  }

  if (msg.source === 'devxqe-content') {
    // Handle bridge actions from content.js postMessage bridge
    if (msg.bridgeAction === 'PROVIDE_SESSION') {
      const sid = (msg.sessionId || '').trim().toUpperCase();
      if (!sid) return false;
      if (msg.serverUrl) {
        serverUrl = msg.serverUrl;
        chrome.storage.sync.set({ serverUrl: msg.serverUrl });
        reconnectAttempts = 0;
        if (conn) { conn.close(); conn = null; }
        clearTimeout(reconnectTimer);
      }
      sessionId = sid;
      if (msg.joinToken) joinToken = msg.joinToken;
      chrome.storage.session.set({ sessionId: sid });
      if (conn && conn.isOpen()) {
        const joinMsg = { type: 'join_session', sessionId: sid };
        if (joinToken) joinMsg.joinToken = joinToken;
        conn.send(joinMsg);
      } else {
        connectTransport();
      }
      // Auto-start recording after a short delay to let the transport open
      setTimeout(async () => {
        await startRecording(sid);
      }, 500);
      broadcastToPopup({ type: 'SESSION_CONFIRMED', sessionId: sid });
      return false;
    }
    if (msg.bridgeAction === 'STOP_RECORDING') {
      stopRecording();
      return false;
    }

    // Use sessionId from the event itself — never trust in-memory state
    // (MV3 service workers go dormant and reset variables)
    const sid = msg.sessionId;
    if (sid) {
      sendToServer({
        type: 'recording_event',
        sessionId: sid,
        event: msg
      });
      // Capture screenshot after significant interactions
      if (['click', 'navigation', 'page_load'].includes(msg.type) && sender?.tab?.id) {
        debouncedScreenshot(sender.tab.id, sid);
      }
    }
    return false;
  }
});

// ─── Popup Message Handler ────────────────────────────────────────────────────

async function handlePopupMessage(msg, sendResponse) {
  switch (msg.action) {
    case 'GET_STATUS':
      sendResponse({
        isRecording,
        sessionId,
        connected: !!(conn && conn.isOpen()),
        transport: conn ? conn.kind : null,
        serverUrl,
        httpBaseUrl: getHttpBaseUrl(),
      });
      break;

    case 'JOIN_SESSION':
      if (!msg.sessionId) {
        sendResponse({ success: false, error: 'No session ID provided' });
        return;
      }
      sessionId = msg.sessionId.trim().toUpperCase();
      if (msg.joinToken) joinToken = msg.joinToken;
      {
        const joinMsg = { type: 'join_session', sessionId };
        if (joinToken) joinMsg.joinToken = joinToken;
        sendToServer(joinMsg);
      }
      sendResponse({ success: true });
      break;

    case 'START_RECORDING':
      if (!sessionId) {
        sendResponse({ success: false, error: 'No session joined' });
        return;
      }
      await startRecording(sessionId);
      sendResponse({ success: true, sessionId });
      break;

    case 'STOP_RECORDING':
      await stopRecording();
      sessionId = null;
      sendResponse({ success: true });
      break;

    case 'CONNECT':
      connectTransport();
      sendResponse({ success: true });
      break;

    case 'GET_SERVER_URL':
      sendResponse({ serverUrl, transport: transportPref || resolveTransport() });
      break;

    case 'SET_SERVER_URL': {
      const newUrl = (msg.serverUrl || '').trim();
      if (!newUrl) {
        sendResponse({ success: false, error: 'URL cannot be empty' });
        return;
      }
      serverUrl = newUrl;
      chrome.storage.sync.set({ serverUrl: newUrl });
      reconnectAttempts = 0;
      if (conn) { conn.close(); conn = null; }
      clearTimeout(reconnectTimer);
      connectTransport();
      broadcastToPopup({ type: 'SERVER_URL_CHANGED', serverUrl: newUrl });
      sendResponse({ success: true });
      break;
    }

    case 'SET_TRANSPORT': {
      const t = (msg.transport || '').toLowerCase().trim();
      if (t && t !== 'ws' && t !== 'socket.io') {
        sendResponse({ success: false, error: 'transport must be "ws", "socket.io", or empty for auto' });
        return;
      }
      transportPref = t;
      chrome.storage.sync.set({ transport: t });
      reconnectAttempts = 0;
      if (conn) { conn.close(); conn = null; }
      clearTimeout(reconnectTimer);
      connectTransport();
      sendResponse({ success: true, transport: t || resolveTransport() });
      break;
    }
  }
}

// ─── Broadcast to Popup ───────────────────────────────────────────────────────

function broadcastToPopup(data) {
  chrome.runtime.sendMessage({ source: 'devxqe-background', ...data }).catch(() => {
    // Popup not open — ignore
  });
}

// ─── Keep-alive ping ──────────────────────────────────────────────────────────

setInterval(() => {
  if (conn && conn.isOpen()) {
    conn.send({ type: 'ping' });
  }
}, 25000);

// ─── External Messages (from NAT recorder page via externally_connectable) ───

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'PING':
      sendResponse({
        installed: true,
        connected: !!(conn && conn.isOpen()),
        transport: conn ? conn.kind : null,
        isRecording,
        sessionId,
        version: chrome.runtime.getManifest().version,
      });
      break;

    case 'SET_SERVER_URL': {
      const newUrl = (msg.serverUrl || '').trim();
      if (!newUrl) {
        sendResponse({ success: false, error: 'URL cannot be empty' });
        return;
      }
      serverUrl = newUrl;
      chrome.storage.sync.set({ serverUrl: newUrl });
      reconnectAttempts = 0;
      if (conn) { conn.close(); conn = null; }
      clearTimeout(reconnectTimer);
      connectTransport();
      sendResponse({ success: true });
      break;
    }

    case 'PROVIDE_SESSION': {
      if (!msg.sessionId) {
        sendResponse({ success: false, error: 'No sessionId' });
        return;
      }
      sessionId = msg.sessionId.trim().toUpperCase();
      if (msg.joinToken) joinToken = msg.joinToken;
      chrome.storage.session.set({ sessionId });

      if (conn && conn.isOpen()) {
        const joinMsg = { type: 'join_session', sessionId };
        if (joinToken) joinMsg.joinToken = joinToken;
        conn.send(joinMsg);
      } else {
        connectTransport();
      }
      sendResponse({ success: true, sessionId });
      break;
    }

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true; // keep channel open for async response
});

// ─── Init: Restore state on service worker wake-up ───────────────────────────

// Load saved server URL first, then restore session state and connect
// Read order: managed policy → user sync storage → hardcoded default
chrome.storage.managed.get(['serverUrl', 'transport'], (managedData) => {
  if (managedData?.serverUrl) serverUrl = managedData.serverUrl;
  if (managedData?.transport) transportPref = managedData.transport;
});

chrome.storage.sync.get(['serverUrl', 'transport'], (syncData) => {
  if (syncData.serverUrl) serverUrl = syncData.serverUrl;
  if (syncData.transport) transportPref = syncData.transport;
  chrome.storage.session.get(['isRecording', 'sessionId'], (data) => {
    if (data.isRecording && data.sessionId) {
      isRecording = true;
      sessionId = data.sessionId;
    }
    connectTransport();
  });
});
