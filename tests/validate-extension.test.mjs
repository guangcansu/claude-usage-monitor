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
  writeFileSync(join(root, 'README.md'), '# Test extension\n');
  writeFileSync(join(root, 'worker.js'), 'export default null;');
  writeFileSync(join(root, 'popup.html'), '<main></main>');
  writeFileSync(join(root, 'icons', 'icon-16.png'), 'placeholder');
  return root;
}

test('requires a README for unpacked extension instructions', () => {
  const root = fixture(baseManifest());
  try {
    rmSync(join(root, 'README.md'));
    assert.throws(() => validateExtension(root), /README\.md is required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects insecure and non-Claude external origins in executable files', () => {
  const root = fixture(baseManifest());
  try {
    writeFileSync(join(root, 'worker.js'), "const endpoint = 'http://claude.ai/api/organizations';");
    assert.throws(() => validateExtension(root), /must not contain http:\/\//);

    writeFileSync(join(root, 'worker.js'), "const endpoint = 'https://example.com/api/usage';");
    assert.throws(() => validateExtension(root), /https:\/\/example\.com/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects console logging in collector, background, and content code', () => {
  for (const relativePath of ['src/collector/unsafe.js', 'src/background.js', 'src/content.js']) {
    const root = fixture(baseManifest());
    try {
      mkdirSync(join(root, 'src', 'collector'), { recursive: true });
      writeFileSync(join(root, relativePath), "console.log('usage response');");
      assert.throws(() => validateExtension(root), new RegExp(`${relativePath.replaceAll('/', '\\/')} must not call console\\.log`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('limits approved Demo fixture numbers to popup code or tests', () => {
  const root = fixture(baseManifest());
  try {
    writeFileSync(join(root, 'worker.js'), 'const demoSessionUsage = 45;');
    assert.throws(() => validateExtension(root), /worker\.js must not contain Demo fixture number 45/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
