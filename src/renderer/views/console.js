import { $, escapeHtml, fill, icon, show } from '../lib.js';
import { t } from '../i18n.js';

const LOG_TONE = {
  found: 'text-sky-400',
  download: 'text-violet-400',
  upload: 'text-amber-400',
  uploaded: 'text-emerald-400',
  saved: 'text-emerald-400',
  cached: 'text-zinc-400',
  owned: 'text-zinc-400',
  'download-failed': 'text-red-400',
  'upload-failed': 'text-red-400',
  warn: 'text-orange-400',
  info: 'text-zinc-400',
  error: 'font-medium text-red-400',
};

const QUEUE_ROW = {
  found: ['circle-dashed', 'text-zinc-400'],
  download: ['arrow-down-to-line', 'text-violet-400'],
  upload: ['arrow-up-from-line', 'text-amber-400'],
  uploaded: ['check', 'text-emerald-400'],
  saved: ['check', 'text-emerald-400'],
  cached: ['zap', 'text-zinc-400'],
  owned: ['user-check', 'text-zinc-400'],
  'download-failed': ['x', 'text-red-400'],
  'upload-failed': ['x', 'text-red-400'],
};

// The log is a two-column list, not padded text: the label sits in its own
// fixed column so rows line up without needing a monospaced family.
const describe = event => {
  const label = event.name ? `${event.name} · ${event.id}` : event.id;
  switch (event.kind) {
    case 'found':
      return ['found', label];
    case 'download':
      return ['get', label];
    case 'upload':
      return ['put', label];
    case 'uploaded':
      return ['done', `${event.name} · ${event.id} → ${event.newId}`];
    case 'cached':
      return ['cached', `${event.name} · ${event.id} → ${event.newId}`];
    case 'saved':
      return ['saved', label];
    case 'owned':
      return ['owned', label];
    case 'download-failed':
      return ['fail', `${label} — download: ${event.reason}`];
    case 'upload-failed':
      return ['fail', `${label} — upload: ${event.reason}`];
    case 'warn':
      return ['retry', `${label} — ${event.reason}`];
    case 'error':
      return ['error', event.message];
    default:
      return ['info', event.message ?? label];
  }
};

const queue = new Map();
let logLines = 0;

const emptyState = message => `<p class="text-zinc-400">${escapeHtml(message)}</p>`;

export const renderQueue = () => {
  const view = $('queueView');
  if (!queue.size) return fill(view, emptyState(t('home.queueEmpty')));

  fill(
    view,
    [...queue.values()]
      .map(
        item => `<div class="flex items-center gap-2 py-[1px]">
          <span class="${item.tone}">${icon(item.icon)}</span>
          <span class="min-w-0 flex-1 truncate">${escapeHtml(item.name)}</span>
          <span class="num text-[10px] text-zinc-400">${escapeHtml(item.id)}</span>
        </div>`
      )
      .join('')
  );
  view.scrollTop = view.scrollHeight;
};

export const appendLog = event => {
  const view = $('logView');
  if (!logLines) view.textContent = '';
  logLines++;

  const line = document.createElement('div');
  line.className = 'flex gap-2.5';

  if (event.kind === 'summary') {
    line.className += ` pt-1.5 font-medium ${event.failed ? 'text-amber-400' : 'text-emerald-400'}`;
    line.textContent = `${event.done}/${event.total} completed${event.failed ? `, ${event.failed} failed` : ''}`;
  } else {
    const [tag, text] = describe(event);
    const tone = LOG_TONE[event.kind] ?? 'text-zinc-400';

    const marker = document.createElement('span');
    marker.className = `w-[42px] shrink-0 text-right ${tone}`;
    marker.textContent = tag;

    const body = document.createElement('span');
    body.className = 'num min-w-0 flex-1 break-words text-zinc-400';
    body.textContent = text;

    line.append(marker, body);
  }

  view.appendChild(line);
  view.scrollTop = view.scrollHeight;
};

export const trackQueue = event => {
  const row = QUEUE_ROW[event.kind];
  if (!row || !event.id) return;
  queue.set(event.id, {
    id: event.id,
    name: event.name || queue.get(event.id)?.name || event.id,
    icon: row[0],
    tone: row[1],
  });
  renderQueue();
};

export const queueSize = () => queue.size;

export const resetConsole = () => {
  queue.clear();
  logLines = 0;
  renderQueue();
  fill($('logView'), emptyState(t('home.logEmpty')));
};

export const showConsole = view => {
  const isQueue = view === 'queue';
  show($('queueView'), isQueue);
  show($('logView'), !isQueue);
  $('tabQueue').setAttribute('aria-selected', String(isQueue));
  $('tabLog').setAttribute('aria-selected', String(!isQueue));
};
