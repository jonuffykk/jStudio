'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'src', 'plugin', 'plugin.lua'), 'utf8');
const outputDir = path.join(root, 'dist');
const outputPath = path.join(outputDir, `jSpoofer-v${version}.rbxmx`);

const escapeXml = value =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const document = `<?xml version="1.0" encoding="utf-8"?>
<roblox version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Script" referent="RBX_jSpoofer">
    <Properties>
      <bool name="Disabled">false</bool>
      <Content name="LinkedSource"><null></null></Content>
      <string name="Name">jSpoofer</string>
      <ProtectedString name="Source">${escapeXml(source)}</ProtectedString>
    </Properties>
  </Item>
</roblox>
`;

fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(outputPath, { force: true });
for (const name of fs.readdirSync(outputDir)) {
  if (/^jSpoofer-v.*\.rbxmx$/i.test(name)) fs.rmSync(path.join(outputDir, name), { force: true });
}
fs.writeFileSync(outputPath, document, 'utf8');

process.stdout.write(`Built ${path.relative(root, outputPath)}\n`);
