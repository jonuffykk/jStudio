'use strict';

const http = require('http');
const { EventEmitter, once } = require('events');
const { BRIDGE } = require('./config');

const MAX_BODY_BYTES = 2_000_000;

const readJsonBody = request =>
  new Promise(resolve => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
    request.on('error', () => resolve({}));
  });

const reply = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
};

const isBrowserRequest = headers => 'origin' in headers || 'sec-fetch-site' in headers;

class StudioBridge extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.connection = null;
    this.lastHeartbeat = 0;
    this.heartbeatTimer = null;
    this.pendingScan = null;
    this.pendingMappings = null;
  }

  start() {
    if (this.server) return this.ready;
    const server = http.createServer((request, response) => {
      this.route(request, response).catch(() => reply(response, 500, { error: 'Internal error' }));
    });
    server.on('error', error => {
      this.server = null;
      if (error.code === 'EADDRINUSE') setTimeout(() => this.start(), 3000).unref?.();
    });
    this.ready = once(server, 'listening');
    server.listen(BRIDGE.port, BRIDGE.host);
    this.server = server;
    return this.ready;
  }

  async stop() {
    this.clearHeartbeat();
    const server = this.server;
    this.server = null;
    if (!server) return;
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }

  isConnected() {
    return !!this.connection;
  }

  requestScan(options) {
    this.pendingScan = options;
  }

  cancelScan() {
    this.pendingScan = null;
    this.emit('scan', { status: 'cancelled', results: [] });
  }

  pushMappings(mappings) {
    this.pendingMappings = mappings?.length ? mappings : null;
  }

  clearHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  watchHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.connection && Date.now() - this.lastHeartbeat > BRIDGE.heartbeatTimeoutMs) {
        this.markDisconnected();
      }
    }, BRIDGE.pollIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  markConnected(place = {}) {
    this.lastHeartbeat = Date.now();
    const wasConnected = !!this.connection;
    this.connection = {
      placeId: place.placeId ?? this.connection?.placeId ?? null,
      placeName: place.placeName ?? this.connection?.placeName ?? null,
      connectedAt: this.connection?.connectedAt ?? Date.now(),
    };
    this.watchHeartbeat();
    if (!wasConnected) this.emit('status', { connected: true, connection: this.connection });
  }

  markDisconnected() {
    this.clearHeartbeat();
    if (!this.connection) return;
    this.connection = null;
    this.pendingScan = null;
    this.emit('status', { connected: false, connection: null });
    this.emit('scan', { status: 'cancelled', results: [] });
  }

  async route(request, response) {
    if (isBrowserRequest(request.headers)) return reply(response, 403, { error: 'Forbidden' });

    switch (`${request.method} ${request.url}`) {
      case 'POST /connect':
        this.markConnected(await readJsonBody(request));
        return reply(response, 200, { ok: true });

      case 'POST /disconnect':
        this.markDisconnected();
        return reply(response, 200, { ok: true });

      case 'GET /poll': {
        this.markConnected();
        const payload = {};
        if (this.pendingScan) {
          payload.scanRequest = this.pendingScan;
          this.pendingScan = null;
        }
        if (this.pendingMappings) {
          payload.mappings = this.pendingMappings;
          this.pendingMappings = null;
        }
        return reply(response, 200, payload);
      }

      case 'POST /scan-result': {
        const body = await readJsonBody(request);
        this.emit('scan', { status: body.status, results: body.results ?? [] });
        return reply(response, 200, { ok: true });
      }

      case 'POST /replace-complete': {
        const body = await readJsonBody(request);
        this.emit('replace', { replacedCount: Number(body.replacedCount) || 0 });
        return reply(response, 200, { ok: true });
      }

      case 'POST /selection': {
        const body = await readJsonBody(request);
        this.emit('selection', { count: Number(body.count) || 0 });
        return reply(response, 200, { ok: true });
      }

      default:
        return reply(response, 404, { error: 'Not found' });
    }
  }
}

module.exports = { StudioBridge, bridge: new StudioBridge() };
