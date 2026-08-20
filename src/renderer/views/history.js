import { $, escapeHtml, fill, on, onState } from '../lib.js';
import { t } from '../i18n.js';

const api = window.jspoofer;

const BADGE = {
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  stopped: 'bg-ink-faint/15 text-ink-faint',
  failed: 'bg-red-500/15 text-red-500',
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

export const renderHistory = async () => {
  const runs = await api.history.runs().catch(() => []);
  const list = $('runList');
  if (!runs.length) return fill(list, `<p class="hint">${escapeHtml(t('history.empty'))}</p>`);

  fill(
    list,
    runs
      .map(run => {
        const outcome = outcomeOf(run);
        const seconds = Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000));
        return `<div class="flex items-center justify-between gap-3 rounded border border-paper-line px-3 py-2 text-[12px] dark:border-night-line">
          <div class="min-w-0">
            <p class="truncate">${escapeHtml(targetOf(run))}</p>
            <p class="text-[10.5px] text-ink-faint">${escapeHtml(describeWhen(run))} · ${seconds}s</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="font-mono text-[10px] text-ink-faint">${run.done}/${run.total}</span>
            <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[outcome]}">${escapeHtml(t(`history.${outcome}`))}</span>
          </div>
        </div>`;
      })
      .join('')
  );
};

export const mountHistory = () => {
  on($('btnClearRuns'), 'click', async () => {
    await api.history.clearRuns();
    renderHistory();
  });
  onState('language', renderHistory);
};
