#!/usr/bin/env node
// Keeps the three copies of each bundled plugin in sync from one source of
// truth: plugins/<id>/ (the editable source).
//
//   plugins/<id>.zip        - what the app's "Browse" install-from-index
//                              feature actually downloads and installs
//                              (see plugins.json + PluginsManagerPanel.tsx)
//   backend/plugins-bundled/<id>/ - what ensureBundled() copies into a
//                              fresh install's data directory
//
// Confirmed the hard way (twice) that editing plugins/<id>/ alone is not
// enough - a real crash fix and a real GPIO-spam fix both shipped to
// source but silently kept reaching users through these stale copies for
// days, because nothing regenerated them automatically. Run this (or let
// the pre-commit hook run it) after ANY change under plugins/<id>/.
//
// Usage:
//   node scripts/sync-plugins.mjs          # sync, print what changed
//   node scripts/sync-plugins.mjs --check  # exit 1 if anything is stale, change nothing (for CI)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');
const BUNDLED_DIR = join(REPO_ROOT, 'backend', 'plugins-bundled');
const CHECK_ONLY = process.argv.includes('--check');

// node_modules/package-lock.json are runtime-install artifacts, never part
// of the source of truth - a stray one on a dev machine must not leak into
// what ships. Dotfiles (.DS_Store etc.) are OS junk, never intentional.
const EXCLUDE = new Set(['node_modules', 'package-lock.json']);
function shouldInclude(name) {
  return !EXCLUDE.has(name) && !name.startsWith('.');
}

function listPluginDirs() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PLUGINS_DIR, e.name, 'plugin.json')))
    .map((e) => e.name);
}

/** All files under `dir`, recursively, as paths relative to `dir` (posix-style, sorted for reproducible output). */
function listFiles(dir) {
  const out = [];
  const walk = (sub) => {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
      if (!shouldInclude(entry.name)) continue;
      const relPath = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else out.push(relPath);
    }
  };
  walk('');
  return out.sort();
}

/** Mirrors `srcDir` into `destDir` exactly - copies changed/missing files, deletes anything at dest that's no longer in src. Returns true if anything changed. */
function syncDir(srcDir, destDir, id, label) {
  const srcFiles = listFiles(srcDir);
  const destFiles = existsSync(destDir) ? listFiles(destDir) : [];
  let changed = false;

  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  for (const rel of srcFiles) {
    const srcPath = join(srcDir, rel);
    const destPath = join(destDir, rel);
    const srcContent = readFileSync(srcPath);
    const destContent = existsSync(destPath) ? readFileSync(destPath) : null;
    if (destContent === null || !srcContent.equals(destContent)) {
      changed = true;
      if (!CHECK_ONLY) {
        mkdirSync(join(destDir, rel, '..'), { recursive: true });
        writeFileSync(destPath, srcContent);
      }
      console.log(`  ${CHECK_ONLY ? 'stale' : 'wrote'}: ${label}/${id}/${rel}`);
    }
  }

  for (const rel of destFiles) {
    if (!srcFiles.includes(rel)) {
      changed = true;
      if (!CHECK_ONLY) rmSync(join(destDir, rel), { force: true });
      console.log(`  ${CHECK_ONLY ? 'extra' : 'removed'}: ${label}/${id}/${rel}`);
    }
  }

  return changed;
}

/** Rebuilds plugins/<id>.zip from plugins/<id>/ if its contents differ from what's currently zipped. Flat structure (no wrapping folder) - matches what loader.ts's install() already handles either way, but keeps the archive minimal. */
function syncZip(srcDir, zipPath, id) {
  const srcFiles = listFiles(srcDir);
  const wantedContent = new Map(srcFiles.map((rel) => [rel, readFileSync(join(srcDir, rel))]));

  let currentContent = new Map();
  if (existsSync(zipPath)) {
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory) currentContent.set(entry.entryName.replace(/\\/g, '/'), entry.getData());
    }
  }

  const sameKeys =
    wantedContent.size === currentContent.size && [...wantedContent.keys()].every((k) => currentContent.has(k));
  const sameContent =
    sameKeys && [...wantedContent.entries()].every(([k, v]) => v.equals(currentContent.get(k)));

  if (sameContent) return false;

  if (!CHECK_ONLY) {
    const zip = new AdmZip();
    for (const rel of srcFiles) zip.addFile(rel, wantedContent.get(rel));
    zip.writeZip(zipPath);
  }
  console.log(`  ${CHECK_ONLY ? 'stale' : 'wrote'}: plugins/${id}.zip`);
  return true;
}

function main() {
  const ids = listPluginDirs();
  let anyChanged = false;

  for (const id of ids) {
    const srcDir = join(PLUGINS_DIR, id);
    console.log(`${id}:`);
    const bundledChanged = syncDir(srcDir, join(BUNDLED_DIR, id), id, 'backend/plugins-bundled');
    const zipChanged = syncZip(srcDir, join(PLUGINS_DIR, `${id}.zip`), id);
    if (!bundledChanged && !zipChanged) console.log('  already in sync');
    anyChanged = anyChanged || bundledChanged || zipChanged;
  }

  if (CHECK_ONLY && anyChanged) {
    console.error('\nOut of sync - run `npm run sync-plugins` and commit the result.');
    process.exit(1);
  }
  console.log(anyChanged ? '\nDone.' : '\nEverything already in sync.');
}

main();
