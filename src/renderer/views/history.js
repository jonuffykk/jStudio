import { $, delegate, escapeHtml, fill, on, onState, setStatus } from '../lib.js';
import { t } from '../i18n.js';

const api = window.jspoofer;

const BADGE = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  partial: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  stopped: 'border-paper-line text-ink-faint dark:text-night-faint dark:border-night-line',
  failed: 'border-red-500/30 bg-red-500/10 text-red-500',
};

const outcomeOf = run => {
  if (run.aborted) return 'stopped';
  if (run.failed > 0) return run.done > 0 ? 'partial' : 'failed';
  return run.done > 0 ? 'success' : 'failed';
};

const targetOf = run => {
  if (run.downloadOnly) return t('history.downloadOnly');
  if (!run.target) return t('history.personal');
  const [kind, id] = run.target.split(':');
  return kind === 'group' ? t('history.group', { id }) : t('history.personal');
};

const describeWhen = run =>
  new Date(run.finishedAt ?? run.startedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const plural = count => (count === 1 ? '' : 's');

const detailRows = run =>
  run.mappings
    .map(
      pair => `<div class="flex items-center gap-2 px-3 py-1 num text-[10px]">
        <span class="min-w-0 flex-1 truncate text-ink-faint dark:text-night-faint">${escapeHtml(pair.name || '—')}</span>
        <span class="text-ink-faint dark:text-night-faint line-through">${escapeHtml(pair.from)}</span>
        <span class="text-ink-faint dark:text-night-faint">→</span>
        <span class="text-ink dark:text-night-text">${escapeHtml(pair.to)}</span>
      </div>`
    )
    .join('');

const renderRun = run => {
  const outcome = outcomeOf(run);
  const seconds = Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000));
  const count = run.mappings.length;

  const actions = count
    ? `<div class="flex items-center gap-1.5 border-t border-paper-line px-3 py-1.5 dark:border-night-line">
        <span class="num text-[10px] text-ink-faint dark:text-night-faint">
          ${escapeHtml(t('history.mappings', { count, plural: plural(count) }))} ·
          ${escapeHtml(t(run.applied ? 'history.stateApplied' : 'history.stateReverted'))}
        </span>
        <span class="flex-1"></span>
        <button class="btn btn-quiet !h-6 !px-2 !text-[10.5px]" data-run-detail="${run.id}">
          ${escapeHtml(t('history.details'))}
        </button>
        <button class="btn btn-quiet !h-6 !px-2 !text-[10.5px]" data-run-apply="${run.id}">
          ${escapeHtml(t('history.reapply'))}
        </button>
        <button class="btn btn-quiet !h-6 !px-2 !text-[10.5px]" data-run-revert="${run.id}">
          ${escapeHtml(t('history.revert'))}
        </button>
      </div>
      <div class="hidden max-h-40 overflow-y-auto border-t border-paper-line py-1 dark:border-night-line" id="runDetail-${run.id}">
        ${detailRows(run)}
      </div>`
    : '';

  return `<div class="border border-paper-line dark:border-night-line">
    <div class="flex items-center justify-between gap-3 px-3 py-2">
      <div class="min-w-0">
        <p class="truncate text-[12px] font-medium">${escapeHtml(targetOf(run))}</p>
        <p class="text-[10.5px] text-ink-faint dark:text-night-faint">${escapeHtml(describeWhen(run))} · ${seconds}s</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="num text-[10px] text-ink-faint dark:text-night-faint">${run.done}/${run.total}</span>
        <span class="badge ${BADGE[outcome]}">${escapeHtml(t(`history.${outcome}`))}</span>
      </div>
    </div>
    ${actions}
  </div>`;
};

export const renderHistory = async () => {
  const runs = await api.history.runs().catch(() => []);
  const list = $('runList');
  if (!runs.length) return fill(list, `<p class="hint">${escapeHtml(t('history.empty'))}</p>`);
  fill(list, runs.map(renderRun).join(''));
};

const apply = async (runId, mode) => {
  setStatus(t('history.applying'), 'busy');
  try {
    const { count, applied } = await api.history.apply(runId, mode);
    const key = applied ? 'history.appliedToast' : 'history.revertedToast';
    setStatus(t(key, { count, plural: plural(count) }), 'ok');
    await renderHistory();
  } catch (error) {
    setStatus(error.message, 'bad');
  }
};

export const mountHistory = () => {
  on($('btnClearRuns'), 'click', async () => {
    await api.history.clearRuns();
    renderHistory();
  });

  const list = $('runList');
  delegate(list, 'data-run-detail', id => $(`runDetail-${id}`)?.classList.toggle('hidden'));
  delegate(list, 'data-run-apply', id => apply(id, 'apply'));
  delegate(list, 'data-run-revert', id => apply(id, 'revert'));

  onState('language', renderHistory);
};
