import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultExtensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_FIXTURE_NUMBERS = [45, 55, 27, 73, 56, 44, 28.19, 50];
const DEMO_FIXTURE_NUMBER_PATTERNS = DEMO_FIXTURE_NUMBERS.map((value) => ({
  value,
  pattern: new RegExp(`(?:^|[^\\d.])${String(value).replace('.', '\\.')}(?:$|[^\\d.])`),
}));

function readText(extensionRoot, relativePath) {
  return readFileSync(resolve(extensionRoot, relativePath), 'utf8');
}

function iconFiles(icon) {
  if (typeof icon === 'string') return [icon];
  if (icon && typeof icon === 'object') return Object.values(icon);
  return [];
}

function collectManifestFiles(manifest) {
  const files = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...iconFiles(manifest.action?.default_icon),
    ...iconFiles(manifest.icons),
  ];
  for (const contentScript of manifest.content_scripts ?? []) {
    files.push(...(contentScript.js ?? []), ...(contentScript.css ?? []));
  }
  return [...new Set(files.filter((file) => typeof file === 'string' && file))];
}

function walkExecutableSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'tests' || entry.name === 'node_modules') return [];
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkExecutableSourceFiles(fullPath);
    return /\.(?:js|html|css)$/i.test(entry.name) ? [fullPath] : [];
  });
}

function assertLocalHtmlReferences(extensionRoot, relativePath) {
  const source = readText(extensionRoot, relativePath);
  for (const match of source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (/^(?:https?:)?\/\//i.test(reference)) continue;
    assert.ok(existsSync(resolve(extensionRoot, dirname(relativePath), reference)), `${relativePath} references a missing file: ${reference}`);
  }
}

function assertSafeSource(extensionRoot, relativePath) {
  const source = readText(extensionRoot, relativePath);
  assert.doesNotMatch(source, /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i, `${relativePath} must not load remote scripts`);
  assert.doesNotMatch(source, /<all_urls>/i, `${relativePath} must not grant all URL access`);
  assert.doesNotMatch(source, /chrome\.cookies\b/i, `${relativePath} must not access cookies`);
  assert.doesNotMatch(source, /\.innerHTML\b/i, `${relativePath} must not use innerHTML`);
  assert.doesNotMatch(source, /http:\/\//i, `${relativePath} must not contain http://`);

  for (const match of source.matchAll(/https:\/\/[^/'"`$\s<]+/gi)) {
    assert.equal(match[0], 'https://claude.ai', `${relativePath} may use only https://claude.ai as an external origin`);
  }

  if (relativePath === 'src/background.js' || relativePath === 'src/content.js' || relativePath.startsWith('src/collector/')) {
    assert.doesNotMatch(source, /\bconsole\.log\s*\(/, `${relativePath} must not call console.log`);
  }

  if (relativePath !== 'popup/popup.js') {
    for (const { value, pattern } of DEMO_FIXTURE_NUMBER_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${relativePath} must not contain Demo fixture number ${value}`);
    }
  }
}

function relativePath(extensionRoot, fullPath) {
  return fullPath.slice(extensionRoot.length + 1).replaceAll('\\', '/');
}

export function validateExtension(extensionRoot = defaultExtensionRoot) {
  const manifestPath = resolve(extensionRoot, 'manifest.json');
  assert.ok(existsSync(resolve(extensionRoot, 'README.md')), 'README.md is required');
  assert.ok(existsSync(manifestPath), 'manifest.json is required');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
  assert.deepEqual(manifest.permissions, ['storage', 'alarms'], 'permissions must be exactly storage and alarms');
  assert.deepEqual(manifest.host_permissions, ['https://claude.ai/*'], 'host_permissions must be exactly https://claude.ai/*');
  assert.equal('optional_permissions' in manifest, false, 'optional_permissions are not allowed');
  assert.equal('optional_host_permissions' in manifest, false, 'optional_host_permissions are not allowed');

  const manifestFiles = collectManifestFiles(manifest);
  for (const file of manifestFiles) {
    assert.ok(existsSync(resolve(extensionRoot, file)), `referenced file is missing: ${file}`);
  }

  const ordinarySources = walkExecutableSourceFiles(extensionRoot).map((fullPath) => relativePath(extensionRoot, fullPath));
  const manifestSources = manifestFiles.filter((file) => /\.(?:js|html|css)$/i.test(file));
  for (const file of new Set([...ordinarySources, ...manifestSources])) {
    assertSafeSource(extensionRoot, file);
    if (/\.html$/i.test(file)) assertLocalHtmlReferences(extensionRoot, file);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateExtension();
  console.log('Extension validation passed.');
}
