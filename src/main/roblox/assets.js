'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { ENDPOINTS, RUN, USER_AGENT } = require('../config');
const { Aborted, countdown, jitter, sleep, throwIfAborted, withTimeout } = require('../lib');
const { normalizeCookie, sanitizeFilename } = require('./api');

const RETRYABLE = /aborted|timeout|terminated|\b5\d\d\b/i;

let rateLimitedUntil = 0;

const holdRateLimit = ms => {
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + ms);
};

const awaitRateLimit = async (signal, onTick) => {
  const remaining = rateLimitedUntil - Date.now();
  if (remaining > 0) await countdown(remaining, signal, onTick);
};

const resolveDownloadUrl = async (assetId, placeIds, cookie, signal) => {
  const header = normalizeCookie(cookie);

  for (const placeId of placeIds) {
    throwIfAborted(signal);
    const guard = withTimeout(15000, signal);
    try {
      const response = await fetch(ENDPOINTS.assetBatch, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          Cookie: header,
          'Roblox-Place-Id': String(placeId),
        },
        body: JSON.stringify([
          { requestId: String(assetId), assetType: 'Animation', assetId: String(assetId) },
        ]),
        signal: guard.signal,
      });
      if (!response.ok) continue;
      const location = (await response.json())?.[0]?.locations?.[0]?.location;
      if (location) return location;
    } catch (error) {
      if (error instanceof Aborted) throw error;
    } finally {
      guard.done();
    }
  }
  return ENDPOINTS.assetLegacy(assetId);
};

const downloadAsset = async (url, cookie, destination, { attempts = 4, signal } = {}) => {
  const header = normalizeCookie(cookie);
  if (!header) return { ok: false, error: 'Invalid cookie' };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) return { ok: false, error: 'aborted' };
    const guard = withTimeout(30000, signal);
    try {
      const response = await fetch(url, {
        headers: { Cookie: header, 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: guard.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('Empty response body');
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
      return { ok: true, path: destination };
    } catch (error) {
      await fsp.rm(destination, { force: true }).catch(() => {});
      if (signal?.aborted) return { ok: false, error: 'aborted' };
      const message = error?.message ?? 'unknown';
      if (attempt === attempts || !RETRYABLE.test(message)) return { ok: false, error: message };
      await sleep(jitter(3000, 2000));
    } finally {
      guard.done();
    }
  }
  return { ok: false, error: 'retries exhausted' };
};

const buildUpload = (buffer, name, creator) => {
  const form = new FormData();
  form.append(
    'request',
    JSON.stringify({
      assetType: 'Animation',
      displayName: name,
      description: 'Placeholder',
      creationContext: { creator },
    })
  );
  form.append(
    'fileContent',
    new Blob([buffer], { type: 'model/x-rbxm' }),
    `${sanitizeFilename(name)}.rbxm`
  );
  return form;
};

const postAsset = (body, apiKey, signal) =>
  fetch(ENDPOINTS.openCloudAssets, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body,
    signal,
  });

const assetIdOf = payload => {
  const id = payload?.response?.assetId ?? payload?.response?.Id;
  return id ? String(id) : null;
};

const pollOperation = async (operationPath, apiKey, signal) => {
  const url = operationPath.startsWith('assets/')
    ? `https://apis.roblox.com/${operationPath}`
    : `https://apis.roblox.com/assets/v1/${operationPath}`;

  for (let attempt = 0; attempt < RUN.uploadPollAttempts; attempt++) {
    throwIfAborted(signal);
    await sleep(1000);
    const response = await fetch(url, { headers: { 'x-api-key': apiKey }, signal });
    const payload = await response.json().catch(() => ({}));
    if (!payload.done) continue;
    if (payload.error)
      throw new Error(`Roblox rejected the asset: ${payload.error.message ?? 'unknown'}`);
    const assetId = assetIdOf(payload);
    if (assetId) return assetId;
  }
  throw new Error('Upload timed out waiting for an asset id');
};

const uploadAsset = async ({ filePath, name, groupId, apiKey, userId, signal, onCooldown }) => {
  if (!apiKey) throw new Error('Uploads require an Open Cloud API key');
  const buffer = await fsp.readFile(filePath);
  const creator = groupId ? { groupId: String(groupId) } : { userId: String(userId) };

  let response;
  let payload;
  for (let attempt = 1; attempt <= RUN.rateLimitAttempts; attempt++) {
    throwIfAborted(signal);
    await awaitRateLimit(signal, onCooldown);
    response = await postAsset(buildUpload(buffer, name, creator), apiKey, signal);
    if (response.status !== 429) {
      payload = await response.json().catch(() => ({}));
      break;
    }
    if (attempt === RUN.rateLimitAttempts) throw new Error('HTTP 429 — rate limit exhausted');
    const retryAfter = Math.min(parseInt(response.headers.get('retry-after') ?? '30', 10), 60);
    holdRateLimit(jitter(retryAfter * 1000, 8000));
  }

  if (!response.ok)
    throw new Error(`Upload failed (${response.status}): ${JSON.stringify(payload)}`);

  const direct = payload.done ? assetIdOf(payload) : null;
  if (direct) return direct;
  if (payload.path) return pollOperation(payload.path, apiKey, signal);
  throw new Error(`Unexpected Open Cloud response: ${JSON.stringify(payload)}`);
};

const probeUploadPermission = async (apiKey, groupId) => {
  if (!apiKey) return { canUpload: false, reason: 'No API key saved for this account' };
  try {
    const response = await postAsset(
      buildUpload(
        new Uint8Array(0),
        '__probe__',
        groupId ? { groupId: String(groupId) } : { userId: '0' }
      ),
      apiKey
    );
    if (response.status === 401 || response.status === 403) {
      const body = await response.json().catch(() => null);
      return {
        canUpload: false,
        reason: body?.error?.message ?? `Permission denied (${response.status})`,
      };
    }
    if (response.status === 400) {
      const message = (await response.json().catch(() => null))?.error?.message ?? '';
      if (/permission|authorized/i.test(message)) return { canUpload: false, reason: message };
    }
    return { canUpload: true };
  } catch (error) {
    return { canUpload: false, reason: error.message };
  }
};

module.exports = { downloadAsset, probeUploadPermission, resolveDownloadUrl, uploadAsset };
