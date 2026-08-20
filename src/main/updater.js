'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const { app } = require('electron');
const { ENDPOINTS } = require('./config');

const HEADERS = { 'User-Agent': 'jSpoofer', Accept: 'application/vnd.github+json' };

const request = async (url, { timeoutMs = 20000, headers = HEADERS } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const parseVersion = value =>
  String(value ?? '')
    .replace(/^v/i, '')
    .split('.')
    .map(part => parseInt(part, 10) || 0);

const compareVersions = (a, b) => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
};

const normalize = tag => String(tag ?? '').replace(/^v/i, '');

const getLatestRelease = async () => {
  const release = await (await request(ENDPOINTS.releases)).json();
  if (!release?.tag_name) throw new Error(release?.message || 'No release found');

  const assets = release.assets || [];
  const installer = assets.find(asset => /\.exe$/i.test(asset.name));
  const checksums = assets.find(asset => /^SHA256SUMS(\.txt)?$/i.test(asset.name));
  const current = app.getVersion();
  const latest = normalize(release.tag_name);

  return {
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    releaseUrl: release.html_url,
    assetUrl: installer?.browser_download_url || null,
    assetName: installer?.name || null,
    assetSize: installer?.size || 0,
    checksumUrl: checksums?.browser_download_url || null,
  };
};

const sha256File = async filePath => {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
};

const expectedChecksum = async (checksumUrl, assetName) => {
  const text = await (await request(checksumUrl, { headers: { 'User-Agent': 'jSpoofer' } })).text();
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === assetName) return match[1].toLowerCase();
  }
  return null;
};

const downloadRelease = async (url, destination, onProgress) => {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.rm(destination, { force: true });

  const response = await request(url, {
    timeoutMs: 300000,
    headers: { 'User-Agent': 'jSpoofer' },
  });
  const total = Number(response.headers.get('content-length') || 0);
  let received = 0;

  const source = Readable.fromWeb(response.body);
  source.on('data', chunk => {
    received += chunk.length;
    onProgress?.({ received, total, pct: total ? Math.round((received / total) * 100) : 0 });
  });

  try {
    await pipeline(source, fs.createWriteStream(destination));
  } catch (err) {
    await fsp.rm(destination, { force: true });
    throw err;
  }
  return { size: received, total };
};

const isExecutable = async filePath => {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    return buffer.toString('latin1') === 'MZ';
  } finally {
    await handle.close();
  }
};

const swapScript = ({ pid, source, target, logPath }) => {
  const quote = value => String(value).replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$src = '${quote(source)}'`,
    `$dst = '${quote(target)}'`,
    `$log = '${quote(logPath)}'`,
    `try { Wait-Process -Id ${pid} -Timeout 60 -ErrorAction Stop } catch {}`,
    '$ok = $false',
    'for ($i = 0; $i -lt 40; $i++) {',
    '  try { Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop; $ok = $true; break }',
    '  catch { Start-Sleep -Milliseconds 500 }',
    '}',
    'if ($ok) { Remove-Item -LiteralPath $src -Force; Start-Process -FilePath $dst }',
    'else { "$(Get-Date -Format o)  update failed" | Out-File -FilePath $log -Append -Encoding utf8 }',
    'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force',
  ].join('\r\n');
};

const applyUpdate = async updatePath => {
  if (!fs.existsSync(updatePath)) throw new Error('Update file missing');
  if (!(await isExecutable(updatePath))) {
    await fsp.rm(updatePath, { force: true });
    throw new Error('Update file is not a valid executable');
  }

  const dir = path.dirname(updatePath);
  const scriptPath = path.join(dir, `swap_${Date.now()}.ps1`);
  await fsp.writeFile(
    scriptPath,
    swapScript({
      pid: process.pid,
      source: updatePath,
      target: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      logPath: path.join(dir, 'update.log'),
    }),
    'utf8'
  );

  spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    { detached: true, stdio: 'ignore', windowsHide: true }
  ).unref();

  app.quit();
};

module.exports = {
  applyUpdate,
  compareVersions,
  downloadRelease,
  expectedChecksum,
  getLatestRelease,
  sha256File,
};
