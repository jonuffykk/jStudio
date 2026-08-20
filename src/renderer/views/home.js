import {
  $,
  downloadJson,
  emit,
  escapeHtml,
  fill,
  icon,
  on,
  onState,
  rememberGroup,
  savedGroup,
  setProgress,
  setStatus,
  settings,
  show,
  showFlex,
  state,
} from '../lib.js';
import { t } from '../i18n.js';
import {
  appendLog,
  queueSize,
  renderQueue,
  resetConsole,
  showConsole,
  trackQueue,
} from './console.js';

const api = window.jspoofer;

const nextSteps = () => {
  const steps = [];
  if (!state.account) {
    steps.push({ text: t('next.signIn'), cta: t('next.signInCta'), action: 'accounts' });
  }
  if (state.plugin?.supported && !state.plugin.installed) {
    steps.push({
      text: t('next.installPlugin'),
      cta: t('next.installCta'),
      action: 'install-plugin',
    });
  } else if (state.pluginUpdate?.hasUpdate) {
    steps.push({
      text: t('next.updatePlugin'),
      cta: t('next.updateCta'),
      action: 'install-plugin',
    });
  }
  if (settings.downloadOnly && !settings.downloadFolder) {
    steps.push({ text: t('next.pickFolder'), cta: t('next.pickFolderCta'), action: 'pick-folder' });
  }
  if (state.release?.hasUpdate) {
    steps.push({
      text: t('next.appUpdate', { version: state.release.latest }),
      cta: t('next.appUpdateCta'),
      action: 'update',
    });
  }
  return steps;
};

export const renderNextSteps = () => {
  const container = $('nextStep');
  const steps = nextSteps();
  show(container, steps.length > 0);
  if (!steps.length) return;

  fill(
    container,
    steps
      .map(
        step => `<div class="flex items-center gap-2.5 px-3 py-2">
          <span class="text-amber-500">${icon('triangle-alert')}</span>
          <span class="flex-1 text-[11.5px] text-ink dark:text-night-text">${escapeHtml(step.text)}</span>
          ${
            step.action
              ? `<button class="btn btn-quiet !h-6 !px-2 !text-[11px]" data-step="${step.action}">${escapeHtml(step.cta)}</button>`
              : ''
          }
        </div>`
      )
      .join('')
  );

  container.querySelectorAll('[data-step]').forEach(button => {
    on(button, 'click', () => emit('next-step', button.dataset.step));
  });
};

const renderStudio = () => {
  const { connected, placeName } = state.studio;
  $('studioDot').className = `h-[7px] w-[7px] shrink-0 ${
    connected ? 'bg-emerald-500' : 'bg-ink-faint/50'
  }`;
  $('studioText').textContent = connected
    ? t('studio.connected', { place: placeName ?? '—' })
    : t('studio.disconnected');

  const canScanSelection = connected && !state.running && state.selectionCount > 0;
  showFlex($('btnScanSelected'), canScanSelection);
  if (canScanSelection) {
    $('selectionText').textContent = t('studio.selection', { count: state.selectionCount });
  }
};

const setRunning = running => {
  state.running = running;
  show($('btnRun'), !running);
  showFlex($('btnPause'), running);
  showFlex($('btnStop'), running);
  if (!running) {
    state.paused = false;
    fill($('btnPause'), icon('pause'));
  }
  renderStudio();
};

const runOptions = selectedOnly => ({
  groupId: $('groupSelect').value,
  selectedOnly,
  downloadOnly: settings.downloadOnly,
  downloadFolder: settings.downloadFolder,
  autoNameAnimations: settings.autoNameAnimations,
  forceReupload: settings.forceReupload,
  uploadConcurrency: settings.uploadConcurrency,
  downloadConcurrency: settings.downloadConcurrency,
  maxPlaceIds: settings.maxPlaceIds,
  uploadRetries: settings.uploadRetries,
  overridePlaceId: settings.overridePlaceId,
});

export const startRun = async (selectedOnly = false) => {
  if (state.running) return;
  if (!state.account) return emit('next-step', 'accounts');

  resetConsole();
  state.logEntries = [];
  state.mappings = [];
  show($('btnExportMappings'), false);
  setProgress(0);
  setRunning(true);
  setStatus(t('status.running'), 'busy');

  try {
    await api.run.start(runOptions(selectedOnly));
  } catch (error) {
    appendLog({ kind: 'error', message: error.message });
    setStatus(error.message, 'bad');
    setRunning(false);
  }
};

export const refreshGroups = async () => {
  const select = $('groupSelect');
  const personal = `<option value="">${escapeHtml(t('home.personal'))}</option>`;
  select.innerHTML = personal;
  if (!state.account) return;

  try {
    const groups = await api.auth.groups();
    select.innerHTML =
      personal +
      groups
        .map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
        .join('');
    const saved = savedGroup();
    if (saved && select.querySelector(`option[value="${saved}"]`)) {
      select.value = saved;
      select.dispatchEvent(new Event('change'));
    }
  } catch {
    const warning = $('groupWarning');
    warning.textContent = t('home.groupsFailed');
    show(warning, true);
  }
};

const checkGroupPermission = async groupId => {
  const warning = $('groupWarning');
  rememberGroup(groupId);
  if (!groupId) return show(warning, false);

  warning.textContent = t('home.groupChecking');
  show(warning, true);
  const result = await api.auth.checkGroup(groupId).catch(() => ({ canUpload: true }));
  if (result.canUpload) return show(warning, false);
  warning.textContent = result.reason || t('home.groupDenied');
};

const finishRun = result => {
  setRunning(false);
  state.mappings = result.mappings ?? [];
  show($('btnExportMappings'), state.mappings.length > 0);

  if (result.stopped) {
    return setStatus(
      t('status.stopped', { done: result.done, total: result.done + result.failed }),
      'idle'
    );
  }
  if (!result.ok && result.error) return setStatus(result.error, 'bad');
  if (!result.done && !result.failed) return setStatus(t('status.nothing'), 'idle');

  setProgress(100, `${result.done}/${result.done + result.failed}`);
  setStatus(
    result.failed
      ? t('status.donePartial', { done: result.done, failed: result.failed })
      : t('status.done', { done: result.done }),
    result.failed ? 'busy' : 'ok'
  );
};

export const mountHome = () => {
  resetConsole();
  showConsole('queue');
  renderStudio();

  on($('tabQueue'), 'click', () => showConsole('queue'));
  on($('tabLog'), 'click', () => showConsole('log'));
  on($('btnRun'), 'click', () => startRun(false));
  on($('btnScanSelected'), 'click', () => startRun(true));
  on($('btnStop'), 'click', () => api.run.stop());
  on($('btnPause'), 'click', () => {
    state.paused = !state.paused;
    fill($('btnPause'), icon(state.paused ? 'play' : 'pause'));
    state.paused ? api.run.pause() : api.run.resume();
    setStatus(t(state.paused ? 'status.paused' : 'status.resuming'), 'busy');
  });

  on($('groupSelect'), 'change', event => checkGroupPermission(event.target.value));
  on($('btnCopyLog'), 'click', async () => {
    await navigator.clipboard.writeText($('logView').innerText.trim());
    setStatus(t('status.logCopied'), 'ok');
  });
  on($('btnExportLog'), 'click', () => downloadJson('jspoofer-log', state.logEntries));
  on($('btnExportMappings'), 'click', () =>
    downloadJson(
      'jspoofer-mappings',
      state.mappings.map(entry => {
        const [oldId, newId] = entry.split('=');
        return { oldId, newId };
      })
    )
  );

  onState('language', () => {
    renderQueue();
    renderStudio();
    renderNextSteps();
  });
  onState('account', () => {
    renderNextSteps();
    refreshGroups();
  });
  onState('plugin', renderNextSteps);
  onState('release', renderNextSteps);

  api.on('run:event', event => {
    state.logEntries.push(event);
    appendLog(event);
    trackQueue(event);
  });
  api.on('run:status', message => setStatus(message, 'busy'));
  api.on('run:progress', ({ done, failed }) => {
    const total = Math.max(queueSize(), done + failed, 1);
    setProgress(
      Math.round((done / total) * 100),
      `${done}/${total}${failed ? ` · ${failed} failed` : ''}`
    );
  });
  api.on('run:result', finishRun);

  api.on('studio:status', ({ connected, connection }) => {
    state.studio = { connected, placeName: connection?.placeName ?? null };
    if (!connected) state.selectionCount = 0;
    renderStudio();
    renderNextSteps();
  });
  api.on('studio:selection', ({ count }) => {
    state.selectionCount = count;
    renderStudio();
  });
  api.on('studio:replace', ({ replacedCount }) =>
    setStatus(t('studio.replaced', { count: replacedCount }), 'ok')
  );
};
