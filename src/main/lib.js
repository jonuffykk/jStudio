'use strict';

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const jitter = (base, spread) => base + Math.floor(Math.random() * spread);

class Aborted extends Error {
  constructor() {
    super('aborted');
    this.name = 'Aborted';
  }
}

const throwIfAborted = signal => {
  if (signal?.aborted) throw new Aborted();
};

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Aborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const withTimeout = (ms, signal) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
};

const retry = async (fn, { attempts = 3, delayMs = 1000, signal, onRetry } = {}) => {
  const max = Math.max(1, attempts);
  let last;
  for (let attempt = 1; attempt <= max; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (err instanceof Aborted || attempt === max) throw err;
      onRetry?.(attempt, max, err);
      await wait(delayMs, signal);
    }
  }
  throw last;
};

const countdown = async (totalMs, signal, onTick) => {
  const seconds = Math.max(1, Math.ceil(totalMs / 1000));
  for (let remaining = seconds; remaining > 0; remaining--) {
    throwIfAborted(signal);
    onTick?.(remaining, seconds);
    await wait(1000, signal);
  }
};

const semaphore = max => {
  const slots = Math.max(1, max | 0);
  let active = 0;
  const waiting = [];
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  return async fn => {
    if (active >= slots) await new Promise(resolve => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
};

const mapConcurrent = async (items, limit, worker) => {
  const list = [...items];
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const deferred = () => {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
};

const SCHEMA_VERSION = 2;

const filePath = name => path.join(app.getPath('userData'), name);

const read = async (name, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath(name), 'utf8')) ?? fallback;
  } catch {
    return fallback;
  }
};

const write = async (name, value) => {
  const target = filePath(name);
  const staging = `${target}.writing`;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(staging, JSON.stringify(value, null, 2));
    await fs.rename(staging, target);
    return true;
  } catch {
    await fs.rm(staging, { force: true }).catch(() => {});
    return false;
  }
};

const remove = name => fs.rm(filePath(name), { force: true }).catch(() => {});

const adopt = async (name, legacyName, transform) => {
  if (await fs.stat(filePath(name)).catch(() => null)) return;
  const legacy = await read(legacyName, null);
  if (legacy === null) return;
  await write(name, transform(legacy));
  await remove(legacyName);
};

module.exports = {
  Aborted,
  SCHEMA_VERSION,
  adopt,
  countdown,
  deferred,
  filePath,
  jitter,
  mapConcurrent,
  read,
  remove,
  retry,
  semaphore,
  sleep,
  throwIfAborted,
  wait,
  withTimeout,
  write,
};
