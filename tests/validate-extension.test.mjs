import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateExtension } from './validate-extension.mjs';

function fixture(manifest) {
  const root = mkdtempSync(join(tmpdir(), 'claude-usage-validator-'));
  mkdirSync(join(root, 'icons'));
  mkdirSync(join(root, 'isolated'));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'worker.js'), 'export default null;');
  writeFileSync(join(root, 'popup.html'), '<main></main>');
  writeFileSync(join(root, 'icons', 'icon-16.png'), 'placeholder');
  return root;
}

function baseManifest() {
  return {
    manifest_version: 3,
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://claude.ai/*'],
    background: { service_worker: 'worker.js' },
    action: { default_popup: 'popup.html', default_icon: { 16: 'icons/icon-16.png' } },
  };
}

test('validates action default icons and rejects optional permission declarations', () => {
  const manifest = baseManifest();
  manifest.action.default_icon[32] = 'icons/missing.png';
  manifest.optional_permissions = ['tabs'];
  const root = fixture(manifest);
  try {
    assert.throws(() => validateExtension(root), /optional_permissions/);
    delete manifest.optional_permissions;
    manifest.optional_host_permissions = ['https://example.com/*'];
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => validateExtension(root), /optional_host_permissions/);
    delete manifest.optional_host_permissions;
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => validateExtension(root), /icons\/missing\.png/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scans manifest-referenced executable assets outside ordinary source folders', () => {
  const manifest = baseManifest();
  manifest.content_scripts = [{ matches: ['https://claude.ai/*'], js: ['isolated/unsafe.js'] }];
  const root = fixture(manifest);
  writeFileSync(join(root, 'isolated', 'unsafe.js'), 'element.innerHTML = value;');
  try {
    assert.throws(() => validateExtension(root), /isolated\/unsafe\.js must not use innerHTML/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
