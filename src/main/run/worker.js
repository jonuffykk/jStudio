'use strict';

const path = require('path');
const fs = require('fs').promises;
const { FALLBACK_PLACE_IDS } = require('../config');
const { Aborted, jitter, retry, sleep } = require('../lib');
const { classifyError, getPlaceIds, sanitizeFilename } = require('../roblox/api');
const { downloadAsset, resolveDownloadUrl, uploadAsset } = require('../roblox/assets');
const { mappingKey, saveMapping } = require('../history');

const createWorker = ({ settings, credentials, history, target, signal, report }) => {
  const placeIds = new Map();

  const placeIdsFor = async entry => {
    const key = `${entry.creatorType}:${entry.creatorId}`;
    if (!placeIds.has(key)) {
      const found = await retry(
        () =>
          getPlaceIds(entry.creatorType, entry.creatorId, credentials.cookie, settings.maxPlaceIds),
        { attempts: 3, delayMs: 1000, signal }
      ).catch(() => []);
      placeIds.set(
        key,
        found.length ? [...new Set([...found, ...FALLBACK_PLACE_IDS])] : [...FALLBACK_PLACE_IDS]
      );
    }
    const ids = placeIds.get(key);
    if (!settings.overridePlaceId) return ids;
    return [settings.overridePlaceId, ...ids.filter(id => String(id) !== settings.overridePlaceId)];
  };

  const ownedByTarget = entry =>
    settings.groupId
      ? entry.creatorType === 'group' && String(entry.creatorId) === settings.groupId
      : entry.creatorType === 'user' && String(entry.creatorId) === credentials.id;

  const upload = (entry, filePath) =>
    retry(
      () =>
        uploadAsset({
          filePath,
          name: entry.name,
          groupId: settings.groupId,
          apiKey: credentials.apiKey,
          userId: credentials.id,
          signal,
          onCooldown: seconds => report.cooldown(entry, seconds),
        }),
      {
        attempts: settings.uploadRetries,
        delayMs: 5000,
        signal,
        onRetry: (attempt, max, error) =>
          report.log('warn', {
            id: entry.id,
            name: entry.name,
            reason: `${classifyError(error).category} (${attempt}/${max})`,
          }),
      }
    );

  return async entry => {
    if (report.stopped()) return;
    await sleep(jitter(100, 150));
    await report.paused();
    if (report.stopped()) return;

    if (!settings.downloadOnly && !settings.forceReupload) {
      if (ownedByTarget(entry)) return report.succeeded(entry, 'owned');
      const cached = history[mappingKey(target, entry.id)];
      if (cached?.newId) return report.succeeded(entry, 'cached', { newId: cached.newId });
    }

    const url = await resolveDownloadUrl(
      entry.id,
      await placeIdsFor(entry),
      credentials.cookie,
      signal
    );
    const filePath = path.join(
      settings.workDir,
      `${sanitizeFilename(entry.name)}_${entry.id}.rbxm`
    );

    report.log('download', { id: entry.id, name: entry.name });
    const downloaded = await downloadAsset(url, credentials.cookie, filePath, { signal });
    if (!downloaded.ok) {
      if (report.stopped()) return;
      return report.failed(entry, 'download-failed', classifyError(downloaded.error).category);
    }

    if (settings.downloadOnly) return report.succeeded(entry, 'saved');

    report.log('upload', { id: entry.id, name: entry.name });
    await report.paused();
    if (report.stopped()) return;

    try {
      const newId = await report.uploadSlot(() => upload(entry, filePath));
      await saveMapping(target, entry.id, newId, entry.name);
      report.succeeded(entry, 'uploaded', { newId });
    } catch (error) {
      if (report.stopped() || error instanceof Aborted) return;
      report.failed(entry, 'upload-failed', classifyError(error).category);
    } finally {
      await fs.rm(filePath, { force: true }).catch(() => {});
    }
  };
};

module.exports = { createWorker };
