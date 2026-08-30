import { spawn } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
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
 * fetch like everything else this app downloads from GitHub) into a fresh,
 * fully separate staging directory, installs dependencies and builds both
 * workspaces THERE, and only if every step succeeds, atomically swaps it in
 * for the live install directory via rename() (near-instant on the same
 * filesystem - no prolonged window where the live directory is
 * half-updated).
 *
 * Deliberately NOT an in-place overlay of the live directory: building in
 * total isolation first means a failed build (bad network mid-download,
 * disk full, whatever) never touches the running app at all - it just
 * discards the staging directory and the live install is exactly as it was.
 * A fresh `npm install` in an empty staging dir is also inherently cleaner
 * than overlaying onto existing node_modules - no leftover-dependency risk
 * to reason about.
 *
 * Settings, the G-code library, and installed plugins all live under
 * DATA_DIR (see dataDir.ts), which is a separate path from the install
 * directory on both install methods (/var/lib/... vs /opt/..., or
 * ~/.fluidnc-webcontrol vs the repo dir) - untouched by this regardless.
 *
 * Known tradeoff: this is a plain "replace with the new release's files"
 * swap, not an rsync --delete - a file *removed* between versions can be
 * left behind as an orphan in the new install dir. Accepted rather than
 * depending on rsync being installed on every user's Pi; revisit if it ever
 * actually matters (this project doesn't restructure files often).
 * Separately: on a manually-installed (install.sh, git-cloned) Pi, this
 * replaces the working tree with a plain source copy, i.e. it stops being a
 * git checkout - documented in the README, not worth solving for the sake
 * of a `.git` folder nobody's using at runtime anyway.
 */
export async function applyUpdate(tag: string, onProgress: (step: string) => void): Promise<void> {
  const installDir = process.cwd();
  const stagingDir = `${installDir}.staging`;
  const previousDir = `${installDir}.previous`;
  // A sibling of installDir, deliberately NOT os.tmpdir() - every rename()
  // below needs to stay on the same filesystem as installDir, and tmpdir()
  // is very likely a separate mount (tmpfs, on most Linux setups including
  // Raspberry Pi OS); renameSync() across filesystems fails with EXDEV.
  // Extracting the zip's own top-level wrapper folder here first, then
  // renaming just that inner folder onto stagingDir, keeps every move a
  // same-filesystem rename instead of needing a real copy anywhere.
  const extractDir = `${installDir}.extract`;

  rmSync(stagingDir, { recursive: true, force: true }); // leftover from a prior failed attempt, if any
  rmSync(extractDir, { recursive: true, force: true });

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
    zip.extractAllTo(extractDir, true);
    const extractedRoot = join(extractDir, topLevel);
    if (!existsSync(extractedRoot)) throw new Error('Update archive had an unexpected layout');

    renameSync(extractedRoot, stagingDir);

    onProgress('Installing dependencies…');
    await npm(['install'], stagingDir, onProgress);

    onProgress('Building frontend…');
    await npm(['run', 'build:frontend'], stagingDir, onProgress);

    onProgress('Building backend…');
    await npm(['run', 'build:backend'], stagingDir, onProgress);

    onProgress('Switching to the new version…');
    rmSync(previousDir, { recursive: true, force: true }); // leftover from an even-older attempt, if any
    renameSync(installDir, previousDir);
    renameSync(stagingDir, installDir);
    // Kept as .previous (not deleted) as a manual rollback option over SSH -
    // `mv` it back over the install dir - if the new version somehow fails
    // to even start. Cleaned up automatically by the *next* successful
    // update instead of here, so it's always available until superseded.
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
    rmSync(stagingDir, { recursive: true, force: true }); // only still exists if we bailed out before the swap
  }
}
