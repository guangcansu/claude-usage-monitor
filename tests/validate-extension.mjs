import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(extensionRoot, 'manifest.json');

function readText(relativePath) {
  return readFileSync(resolve(extensionRoot, relativePath), 'utf8');
}

function collectSourceFiles(manifest) {
  const files = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
  ];
  for (const contentScript of manifest.content_scripts ?? []) {
    files.push(...(contentScript.js ?? []), ...(contentScript.css ?? []));
  }
  return files.filter(Boolean);
}

function walkSourceFiles(directory = extensionRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(fullPath);
    return /\.(?:js|html|css)$/i.test(entry.name) ? [fullPath] : [];
  });
}

function assertLocalHtmlReferences(relativePath) {
  const source = readText(relativePath);
  for (const match of source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (/^(?:https?:)?\/\//i.test(reference)) continue;
    assert.ok(existsSync(resolve(extensionRoot, dirname(relativePath), reference)), `${relativePath} references a missing file: ${reference}`);
  }
}

function assertSafeSource(relativePath) {
  const source = readText(relativePath);
  assert.doesNotMatch(source, /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i, `${relativePath} must not load remote scripts`);
  assert.doesNotMatch(source, /<all_urls>/i, `${relativePath} must not grant all URL access`);
  assert.doesNotMatch(source, /chrome\.cookies\b/i, `${relativePath} must not access cookies`);
  assert.doesNotMatch(source, /\.innerHTML\b/i, `${relativePath} must not use innerHTML`);

  for (const match of source.matchAll(/https?:\/\/[^/'"`$\s<]+/g)) {
    assert.equal(match[0], 'https://claude.ai', `${relativePath} may use only https://claude.ai as an external origin`);
  }
}

assert.ok(existsSync(manifestPath), 'manifest.json is required');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
assert.deepEqual(manifest.permissions, ['storage', 'alarms'], 'permissions must be exactly storage and alarms');
assert.deepEqual(manifest.host_permissions, ['https://claude.ai/*'], 'host_permissions must be exactly https://claude.ai/*');

for (const relativePath of collectSourceFiles(manifest)) {
  assert.ok(existsSync(resolve(extensionRoot, relativePath)), `referenced file is missing: ${relativePath}`);
}

for (const fullPath of [...walkSourceFiles(resolve(extensionRoot, 'src')), ...walkSourceFiles(resolve(extensionRoot, 'popup'))]) {
  const relativePath = fullPath.slice(extensionRoot.length + 1).replaceAll('\\', '/');
  assertSafeSource(relativePath);
  if (/\.html$/i.test(relativePath)) assertLocalHtmlReferences(relativePath);
}

console.log('Extension validation passed.');
