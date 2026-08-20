'use strict';

const APP_ID = 'com.github.jonuffykk.jSpoofer';
const REPO = { owner: 'jonuffykk', name: 'jSpoofer' };
const USER_AGENT = 'RobloxStudio/WinInet';

const BRIDGE = {
  host: '127.0.0.1',
  port: 28476,
  pollIntervalMs: 2000,
  heartbeatTimeoutMs: 7000,
};

const RUN = {
  scanTimeoutMs: 120000,
  maxConcurrency: 25,
  maxRunHistory: 30,
  maxAccounts: 10,
  uploadPollAttempts: 30,
  rateLimitAttempts: 4,
};

const ENDPOINTS = {
  authenticated: 'https://users.roblox.com/v1/users/authenticated',
  headshot: 'https://thumbnails.roblox.com/v1/users/avatar-headshot',
  groupRoles: id => `https://groups.roblox.com/v1/users/${id}/groups/roles`,
  userGames: id => `https://games.roblox.com/v2/users/${id}/games?sortOrder=Asc&limit=50`,
  groupGames: id => `https://games.roblox.com/v2/groups/${id}/games?limit=50`,
  assetBatch: 'https://assetdelivery.roblox.com/v2/assets/batch',
  assetLegacy: id => `https://assetdelivery.roblox.com/v1/asset/?id=${id}`,
  openCloudAssets: 'https://apis.roblox.com/assets/v1/assets',
  releases: `https://api.github.com/repos/${REPO.owner}/${REPO.name}/releases/latest`,
};

const EXTERNAL_HOSTS = new Set([
  'github.com',
  'discord.gg',
  'roblox.com',
  'www.roblox.com',
  'create.roblox.com',
]);

const FALLBACK_PLACE_IDS = [99840799534728, 606849621, 155615604, 5704517949];

module.exports = {
  APP_ID,
  BRIDGE,
  ENDPOINTS,
  EXTERNAL_HOSTS,
  FALLBACK_PLACE_IDS,
  REPO,
  RUN,
  USER_AGENT,
};
