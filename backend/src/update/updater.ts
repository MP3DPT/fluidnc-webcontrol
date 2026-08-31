import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import AdmZip from 'adm-zip';

// Same reasoning as plugins/loader.ts's identical constants: systemd (and
// most service managers) run this process with a minimal PATH that has
// node's directory but not npm's - resolving npm next to the running node
// binary sidesteps depending on the service's PATH at all. Not imported
// from loader.ts since that module doesn't export them; small enough to
// duplicate rather than introduce a shared-utility module for two lines.
const NODE_BIN_DIR = dirname(process.execPath);
const NPM_BINARY = join(NODE_BIN_DIR, process.platform === 'win32' ? 'npm.cmd' : 'npm');
const NPM_BINARY_RESOLVED = existsSync(NPM_BINARY) ? NPM_BINARY : 'npm';

/** Runs one step of the update as a real child process (not execSync) - a
 * blocking exec would freeze this entire single-threaded server (WebSocket,
 * HTTP, machine control, everything) for however long `npm install`/build
 * takes, which is exactly the "why can't I jog while it's updating" bug this
 * avoids. Streams stdout/stderr line-by-line to onLine as real progress,
 * instead of a blind multi-minute wait. */
function runCommand(command: string, args: string[], cwd: string, onLine: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PATH: `${NODE_BIN_DIR}${delimiter}${process.env.PATH ?? ''}` },
    });
    let lastError = '';
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) {
        if (line.trim()) {
          onLine(line);
          lastError = line;
        }
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (err) => reject(new Error(`${command} ${args.join(' ')} failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}${lastError ? ` - ${lastError}` : ''}`));
    });
  });
}

const npm = (args: string[], cwd: string, onLine: (line: string) => void) => runCommand(NPM_BINARY_RESOLVED, args, cwd, onLine);

/**
 * Downloads a release's source zip straight from GitHub. Deliberately
 * server-side, unlike every other "download from GitHub" in this app
 * (plugin zips, the update-available check) - those all fetch from
 * raw.githubusercontent.com or api.github.com, which send permissive CORS
 * headers for exactly this kind of cross-origin browser use. GitHub's own
 * archive-download endpoint (github.com/.../archive/refs/tags/*.zip, i.e.
 * codeload.github.com under the hood) does not - a browser fetch() of it
 * fails outright with a generic "Failed to fetch" TypeError, no matter what
 * this app does client-side. A server-to-server request isn't subject to
 * CORS at all, so this is the one part of the whole flow that has to run
 * here instead of in UpdateModal.
 */
async function fetchUpdateZip(tag: string): Promise<Buffer> {
  const url = `https://github.com/MP3DPT/fluidnc-webcontrol/archive/refs/tags/${tag}.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Release download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Applies an app update: downloads the given release tag's source zip
 * (server-side - see fetchUpdateZip above for why this can't be a client-side
 * fetch like everything else this app downloads from GitHub) into a fresh
 * staging directory, installs dependencies and builds both workspaces
 * THERE, and only if every step succeeds, swaps it in for the live install
 * directory's contents.
 *
 * Deliberately NOT an in-place overlay of the live directory: building in
 * total isolation first means a failed build (bad network mid-download,
 * disk full, whatever) never touches the running app at all - it just
 * discards the staging directory and the live install is exactly as it was.
 * A fresh `npm install` in an empty staging dir is also inherently cleaner
 * than overlaying onto existing node_modules - no leftover-dependency risk
 * to reason about.
 *
 * Staging/extract/previous all live *inside* installDir (installDir/.update/...),
 * not as siblings of it - confirmed the hard way (EACCES trying to mkdir a
 * sibling directory) that the service account which owns installDir (via a
 * one-time chown -R at install time) does NOT have write permission on
 * installDir's own *parent* (/opt, typically root-owned) - only within
 * installDir's own tree. Staying nested needs no permission beyond what the
 * account already has. The tradeoff: swapping in the new version is a loop
 * of per-entry renames (move every one of installDir's current top-level
 * entries into .update/previous, then move every one of staging's built
 * entries into installDir), not a single directory rename - still every
 * individual move is an instant same-filesystem rename, and the whole loop
 * only starts after the build has already fully succeeded, so the risk
 * window is small and well past the actual work. End result is identical
 * either way: installDir ends up with exactly staging's content, nothing
 * old left mixed in, since every one of installDir's own entries is moved
 * out before anything new is moved in.
 *
 * Settings, the G-code library, and installed plugins all live under
 * DATA_DIR (see dataDir.ts), which is a separate path from the install
 * directory on both install methods (/var/lib/... vs /opt/..., or
 * ~/.fluidnc-webcontrol vs the repo dir) - untouched by this regardless.
 *
 * On a manually-installed (install.sh, git-cloned) Pi, this replaces the
 * working tree with a plain source copy, i.e. it stops being a git
 * checkout - documented in the README, not worth solving for the sake of a
 * `.git` folder nobody's using at runtime anyway.
 */
export async function applyUpdate(tag: string, onProgress: (step: string) => void): Promise<void> {
  const installDir = process.cwd();
  const updateRoot = join(installDir, '.update');
  const extractDir = join(updateRoot, 'extract');
  const stagingDir = join(updateRoot, 'staging');
  const previousDir = join(updateRoot, 'previous');

  rmSync(updateRoot, { recursive: true, force: true }); // leftover from a prior attempt, if any
  mkdirSync(updateRoot, { recursive: true });

  onProgress('Downloading update…');
  const zipBuffer = await fetchUpdateZip(tag);

  onProgress('Extracting update…');
  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const firstFile = entries.find((e) => !e.isDirectory);
    if (!firstFile) throw new Error('Downloaded update archive is empty');
    // GitHub's source zip always wraps everything in one "<repo>-<tag>/"
    // top-level folder - strip it, same idea as loader.ts's install() does
    // for a plugin zip's own wrapper folder.
    const topLevel = firstFile.entryName.split('/')[0];
    const prefix = `${topLevel}/`;

    // Extracted entry-by-entry (not zip.extractAllTo, which discards this)
    // so each file's Unix permission bits survive - notably the executable
    // bit on scripts/*.sh. GitHub's archive-zip generation stores them in
    // the zip's external file attributes field (the upper 16 bits of
    // entry.attr), the same convention Info-ZIP/Python's zipfile use.
    // Confirmed the hard way: an earlier update left every .sh script
    // downgraded to non-executable (rw-rw-r--), discovered while trying to
    // run sanitize-image.sh by hand over SSH after an in-app update.
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName.replace(/\\/g, '/');
      if (!name.startsWith(prefix)) continue;
      const relative = name.slice(prefix.length);
      if (!relative) continue;
      const destPath = join(extractDir, relative);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, entry.getData());
      const unixMode = (entry.attr >>> 16) & 0xffff;
      if (unixMode) chmodSync(destPath, unixMode);
    }
    // Every entry above was written with the zip's own "<repo>-<tag>/"
    // wrapper folder already stripped from its path (destPath uses
    // `relative`, not `name`) - so extractDir itself IS the extracted root,
    // there's no nested topLevel folder to descend into here. A real repo
    // always has its own package.json at the root; missing that means the
    // archive's layout wasn't what was expected, not that this specific
    // path is wrong.
    if (!existsSync(join(extractDir, 'package.json'))) throw new Error('Update archive had an unexpected layout');

    renameSync(extractDir, stagingDir);

    onProgress('Installing dependencies…');
    await npm(['install'], stagingDir, onProgress);

    onProgress('Building frontend…');
    await npm(['run', 'build:frontend'], stagingDir, onProgress);

    onProgress('Building backend…');
    await npm(['run', 'build:backend'], stagingDir, onProgress);

    onProgress('Switching to the new version…');
    mkdirSync(previousDir, { recursive: true });
    for (const name of readdirSync(installDir)) {
      if (name === '.update') continue; // our own working directory - never move this into itself
      renameSync(join(installDir, name), join(previousDir, name));
    }
    for (const name of readdirSync(stagingDir)) {
      renameSync(join(stagingDir, name), join(installDir, name));
    }
    // previousDir (installDir/.update/previous) is kept, not deleted, as a
    // manual rollback option over SSH if the new version somehow fails to
    // even start - move its contents back up over installDir's own.
    // Cleaned up automatically by the *next* successful update's own
    // rmSync(updateRoot, ...) at the top of this function, not here, so
    // it's always available until superseded.
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
    rmSync(stagingDir, { recursive: true, force: true }); // empty after a successful swap; only non-empty if we bailed out before it
  }
}
