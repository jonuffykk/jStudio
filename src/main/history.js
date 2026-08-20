'use strict';

const { RUN } = require('./config');
const store = require('./lib');

const MAPPINGS = 'mappings.json';
const RUNS = 'runs.json';

const mappingKey = (target, assetId) => `${target}:${assetId}`;

const fromLegacyMappings = legacy => {
  const source = legacy?.entries ?? legacy ?? {};
  const entries = {};
  for (const [key, value] of Object.entries(source)) {
    if (!value?.originalId || !value?.newId) continue;
    entries[key.replace(/^Animation:/, '')] = {
      originalId: String(value.originalId),
      newId: String(value.newId),
      name: value.name ?? '',
      target: value.target ?? '',
      savedAt: value.savedAt ?? new Date().toISOString(),
    };
  }
  return { version: store.SCHEMA_VERSION, entries };
};

const fromLegacyRuns = legacy =>
  (Array.isArray(legacy) ? legacy : []).map(run => ({
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    aborted: !!run.aborted,
    downloadOnly: !!run.downloadOnly,
    target: run.downloadOnly ? null : (run.target ?? null),
    done: run.totalDone ?? 0,
    failed: run.totalFailed ?? 0,
    total: run.total ?? 0,
  }));

const migrateLegacyFiles = async () => {
  await store.adopt(MAPPINGS, 'jspoofer_mappings.json', fromLegacyMappings);
  await store.adopt(RUNS, 'jspoofer_runs.json', fromLegacyRuns);
};

const loadMappings = async () => {
  const file = await store.read(MAPPINGS, null);
  return file?.entries && typeof file.entries === 'object' ? file.entries : {};
};

const saveMapping = async (target, originalId, newId, name) => {
  if (!originalId || !newId) return;
  const entries = await loadMappings();
  entries[mappingKey(target, originalId)] = {
    originalId: String(originalId),
    newId: String(newId),
    name: name ?? '',
    target,
    savedAt: new Date().toISOString(),
  };
  await store.write(MAPPINGS, { version: store.SCHEMA_VERSION, entries });
};

const clearMappings = () => store.remove(MAPPINGS);

const loadRuns = async () => {
  const runs = await store.read(RUNS, []);
  return Array.isArray(runs) ? runs : [];
};

const recordRun = async entry => {
  const runs = await loadRuns();
  await store.write(RUNS, [entry, ...runs].slice(0, RUN.maxRunHistory));
};

const clearRuns = () => store.remove(RUNS);

module.exports = {
  clearMappings,
  clearRuns,
  loadMappings,
  loadRuns,
  mappingKey,
  migrateLegacyFiles,
  recordRun,
  saveMapping,
};
