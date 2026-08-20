'use strict';

const { ENDPOINTS, USER_AGENT } = require('../config');
const { sleep, withTimeout } = require('../lib');

const ILLEGAL_FILENAME = /[<>:"/\\|?*\x00-\x1f]/g;
const ASSET_LINE = /^(\d+)\s+-\s+(.+?)\s+-\s+([GU]):\s*(\d+)$/;

const ERROR_RULES = [
  [/\b401\b|invalid roblox cookie|authentication failed/i, 'Invalid cookie'],
  [/api key/i, 'Invalid API key'],
  [/\b404\b|not found|moderated|no location/i, 'Asset unavailable'],
  [/\b403\b|permission|not authorized/i, 'No permission'],
  [/\b429\b|rate limit/i, 'Rate limited'],
  [/\b5\d\d\b|network|timeout|enotfound|econnreset/i, 'Network failure'],
  [/rbxm|enoent|conversion/i, 'File error'],
];

const sanitizeFilename = name =>
  String(name || 'asset')
    .replace(ILLEGAL_FILENAME, '_')
    .trim()
    .slice(0, 100) || 'asset';

const normalizeCookie = raw => {
  if (typeof raw !== 'string') return '';
  const unquoted = raw.trim().replace(/^['"]+|['"]+$/g, '');
  const embedded = unquoted.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/i);
  const value = (embedded ? embedded[1] : unquoted)
    .replace(/^\.ROBLOSECURITY=/i, '')
    .replace(/[;\r\n]+$/g, '')
    .trim();
  return value ? `.ROBLOSECURITY=${value}` : '';
};

const classifyError = error => {
  const raw = String(
    typeof error === 'string' ? error : (error?.message ?? error?.error ?? 'Unknown')
  );
  const rule = ERROR_RULES.find(([pattern]) => pattern.test(raw));
  return { category: rule ? rule[1] : 'Unknown', raw };
};

const parseAssetLines = input => {
  if (typeof input !== 'string') return [];
  const seen = new Set();
  const entries = [];

  for (const line of input.split('\n')) {
    const match = line.trim().match(ASSET_LINE);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    entries.push({
      id: match[1],
      name: match[2].trim() || 'Unnamed',
      creatorType: match[3] === 'G' ? 'group' : 'user',
      creatorId: match[4],
    });
  }
  return entries;
};

const authedJson = async (url, cookie, { signal, timeoutMs = 20000 } = {}) => {
  const header = normalizeCookie(cookie);
  if (!header) throw new Error('Missing or invalid ROBLOSECURITY cookie');

  const guard = withTimeout(timeoutMs, signal);
  try {
    const response = await fetch(url, {
      headers: { Cookie: header, 'User-Agent': USER_AGENT },
      signal: guard.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} — ${url}`);
    return await response.json();
  } finally {
    guard.done();
  }
};

const getAuthenticatedUser = async cookie => {
  const data = await authedJson(ENDPOINTS.authenticated, cookie);
  if (!data?.id) throw new Error('Authentication failed — no user id returned');
  return {
    id: String(data.id),
    name: data.name ?? '',
    displayName: data.displayName || data.name || '',
  };
};

const getAvatarUrl = async userId => {
  try {
    const url = `${ENDPOINTS.headshot}?userIds=${userId}&size=48x48&format=Png&isCircular=true`;
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return null;
    return (await response.json())?.data?.[0]?.imageUrl ?? null;
  } catch {
    return null;
  }
};

const getProfile = async cookie => {
  const user = await getAuthenticatedUser(cookie);
  return { ...user, avatarUrl: await getAvatarUrl(user.id) };
};

const getGroups = async cookie => {
  const { id } = await getAuthenticatedUser(cookie);
  const data = await authedJson(ENDPOINTS.groupRoles(id), cookie);
  return (data?.data ?? [])
    .map(item => ({
      id: String(item.group?.id ?? ''),
      name: item.group?.name ?? 'Unknown group',
      role: item.role?.name ?? '',
    }))
    .filter(group => group.id);
};

const getPlaceIds = async (creatorType, creatorId, cookie, max) => {
  const base =
    creatorType === 'group' ? ENDPOINTS.groupGames(creatorId) : ENDPOINTS.userGames(creatorId);
  const games = [];
  let cursor = null;

  while (games.length < max) {
    const page = await authedJson(
      cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base,
      cookie
    );
    if (!page?.data?.length) break;
    games.push(...page.data);
    cursor = page.nextPageCursor;
    if (!cursor) break;
    await sleep(500);
  }

  const ids = games
    .slice(0, max)
    .map(game => game.rootPlace?.id ?? game.id)
    .filter(Boolean);
  if (!ids.length) throw new Error('No root places found for this creator');
  return ids;
};

module.exports = {
  classifyError,
  getGroups,
  getPlaceIds,
  getProfile,
  normalizeCookie,
  parseAssetLines,
  sanitizeFilename,
};
