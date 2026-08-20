'use strict';

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { RUN } = require('../config');
const { deferred, mapConcurrent, semaphore, sleep } = require('../lib');
const { parseAssetLines } = require('../roblox/api');
const { loadMappings, recordRun } = require('../history');
const { createWorker } = require('./worker');

class RunError extends Error {}

const text = value => (typeof value === 'string' ? value.trim() : '');

const digits = (value, label) => {
  const raw = text(value);
  if (raw && !/^\d+$/.test(raw)) throw new RunError(`${label} must be a number — got "${raw}".`);
  return raw;
};

const clamp = (value, fallback, min, max) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
};

const resolveOptions = (raw, credentials) => {
  const options = raw && typeof raw === 'object' ? raw : {};
  const downloadOnly = options.downloadOnly === true;
  const folder = text(options.downloadFolder);

  if (!credentials?.cookie) throw new RunError('Add a Roblox cookie before running.');
  if (downloadOnly && !folder) throw new RunError('Pick a folder for download-only mode.');
  if (!downloadOnly && !credentials.apiKey) {
    throw new RunError('Uploads need an Open Cloud API key on the active account.');
  }

  return {
    downloadOnly,
    keepFiles: downloadOnly,
    forceReupload: options.forceReupload === true,
    selectedOnly: options.selectedOnly === true,
    autoName: options.autoNameAnimations === true,
    groupId: digits(options.groupId, 'Group ID') || null,
    overridePlaceId: digits(options.overridePlaceId, 'Place ID override'),
    workDir: downloadOnly ? folder : path.join(app.getPath('userData'), 'staging'),
    maxPlaceIds: clamp(options.maxPlaceIds, 10, 1, 50),
    uploadRetries: clamp(options.uploadRetries, 3, 1, 10),
    downloadConcurrency: clamp(options.downloadConcurrency, 10, 1, RUN.maxConcurrency),
    uploadConcurrency: clamp(options.uploadConcurrency, 10, 1, RUN.maxConcurrency),
  };
};

class Run {
  constructor({ options, credentials, bridge, emit }) {
    this.settings = resolveOptions(options, credentials);
    this.credentials = credentials;
    this.bridge = bridge;
    this.emit = emit;
    this.controller = new AbortController();
    this.target = this.settings.groupId
      ? `group:${this.settings.groupId}`
      : `user:${credentials.id}`;
    this.stopped = false;
    this.pauseGate = null;
    this.done = 0;
    this.failed = 0;
    this.mappings = [];
    this.pairs = [];
    this.retryPool = new Map();
    this.startedAt = Date.now();
  }

  log(kind, payload = {}) {
    this.emit('run:event', { kind, at: Date.now(), ...payload });
  }

  status(text) {
    this.emit('run:status', text);
  }

  progress() {
    this.emit('run:progress', { done: this.done, failed: this.failed });
  }

  pause() {
    this.pauseGate ??= deferred();
  }

  resume() {
    this.pauseGate?.resolve();
    this.pauseGate = null;
  }

  stop() {
    this.stopped = true;
    this.resume();
    this.controller.abort();
    this.bridge.cancelScan();
    this.status('Stopping the run...');
  }

  report() {
    const succeeded = (entry, kind, extra = {}) => {
      this.done++;
      this.retryPool.delete(entry.id);
      if (extra.newId) {
        this.mappings.push(`${entry.id}=${extra.newId}`);
        this.pairs.push({
          from: String(entry.id),
          to: String(extra.newId),
          name: entry.name ?? '',
        });
      }
      this.log(kind, { id: entry.id, name: entry.name, ...extra });
      this.progress();
    };

    return {
      succeeded,
      failed: (entry, kind, reason) => {
        this.failed++;
        this.retryPool.set(entry.id, entry);
        this.log(kind, { id: entry.id, name: entry.name, reason });
        this.progress();
      },
      log: (kind, payload) => this.log(kind, payload),
      cooldown: (entry, seconds) =>
        this.status(`Rate limited — retrying ${entry.name} in ${seconds}s`),
      stopped: () => this.stopped,
      paused: () => this.pauseGate?.promise ?? Promise.resolve(),
      uploadSlot: semaphore(this.settings.uploadConcurrency),
    };
  }

  async clearWorkDir() {
    await fs.mkdir(this.settings.workDir, { recursive: true });
    const entries = await fs.readdir(this.settings.workDir).catch(() => []);
    await Promise.all(
      entries.map(name => fs.rm(path.join(this.settings.workDir, name), { force: true }))
    );
  }

  async scanAndProcess(processEntry) {
    const queue = [];
    const seen = new Set();
    const processed = new Set();
    const scanFinished = deferred();
    let scanning = true;

    const onScan = payload => {
      for (const entry of parseAssetLines((payload.results ?? []).join('\n'))) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        queue.push(entry);
        this.log('found', { id: entry.id, name: entry.name });
      }
      if (payload.status === 'completed' || payload.status === 'cancelled') {
        scanning = false;
        scanFinished.resolve();
      }
    };

    this.bridge.on('scan', onScan);
    this.bridge.requestScan({
      useInstanceNames: this.settings.autoName,
      selectedOnly: this.settings.selectedOnly,
    });

    const deadline = Date.now() + RUN.scanTimeoutMs;
    const drain = async () => {
      while (scanning || processed.size < queue.length) {
        if (this.stopped || Date.now() > deadline) {
          scanning = false;
          scanFinished.resolve();
          return;
        }
        const pending = queue.filter(entry => !processed.has(entry.id));
        if (!pending.length) {
          if (!scanning) return;
          await sleep(250);
          continue;
        }
        await mapConcurrent(pending, this.settings.downloadConcurrency, async entry => {
          processed.add(entry.id);
          await processEntry(entry);
        });
      }
    };

    try {
      await Promise.all([scanFinished.promise, drain()]);
    } finally {
      this.bridge.off('scan', onScan);
    }
  }

  async retryFailures(processEntry) {
    if (this.stopped || !this.retryPool.size) return;
    const entries = [...this.retryPool.values()];
    this.log('info', { message: `Retrying ${entries.length} item(s) that failed` });
    this.status(`Retrying ${entries.length} failed item(s)...`);
    this.failed = Math.max(0, this.failed - entries.length);
    this.progress();
    await mapConcurrent(entries, this.settings.downloadConcurrency, processEntry);
  }

  async execute() {
    if (!this.bridge.isConnected()) {
      throw new RunError(
        'Roblox Studio is not connected. Open your place with the plugin installed.'
      );
    }

    await this.clearWorkDir();
    const processEntry = createWorker({
      settings: this.settings,
      credentials: this.credentials,
      history: this.settings.forceReupload ? {} : await loadMappings(),
      target: this.target,
      signal: this.controller.signal,
      report: this.report(),
    });

    this.log('info', { message: `jSpoofer v${app.getVersion()} — asking Studio for a scan` });
    this.status('Scanning the place in Studio...');

    await this.scanAndProcess(processEntry);
    await this.retryFailures(processEntry);

    if (!this.settings.downloadOnly) {
      await this.clearWorkDir();
      this.bridge.pushMappings(this.mappings);
    }

    const total = this.done + this.failed;
    this.log('summary', { done: this.done, failed: this.failed, total });

    await recordRun({
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      aborted: this.stopped,
      downloadOnly: this.settings.downloadOnly,
      target: this.settings.downloadOnly ? null : this.target,
      done: this.done,
      failed: this.failed,
      total,
      mappings: this.pairs,
      applied: !this.settings.downloadOnly && this.pairs.length > 0,
    }).catch(() => {});

    return {
      ok: !this.stopped && this.done > 0,
      stopped: this.stopped,
      done: this.done,
      failed: this.failed,
      mappings: this.mappings,
    };
  }
}

module.exports = { Run, RunError };
