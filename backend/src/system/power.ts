import { exec } from 'node:child_process';

/**
 * Requires a scoped, passwordless sudo entry for /sbin/shutdown - the
 * project does not (and will not) modify sudoers itself. See README for
 * the exact line to add; this just fails cleanly with the raw error if
 * that hasn't been set up yet.
 */
function runShutdown(flag: '-r' | '-h', label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(`sudo /sbin/shutdown ${flag} now`, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`${label} failed: ${stderr || err.message}`));
        return;
      }
      resolve();
    });
  });
}

export function rebootSystem(): Promise<void> {
  return runShutdown('-r', 'Reboot');
}

export function shutdownSystem(): Promise<void> {
  return runShutdown('-h', 'Shutdown');
}

/**
 * Restarts *this same service* to pick up a just-applied in-app update (see
 * update/updater.ts) - a few seconds, not a full OS reboot, since only the
 * Node process itself needs to start fresh. Requires its own scoped,
 * passwordless sudo entry (same pattern/file as the shutdown one above, see
 * README) for exactly `systemctl restart fluidnc-webcontrol` - nothing
 * broader. Note this call's own Promise realistically never gets to resolve
 * from the caller's perspective: `systemctl restart` SIGTERMs the process
 * running this very code as part of restarting it, so the process is gone
 * before exec's callback would fire in the success case. That's expected,
 * not a bug - the caller should broadcast whatever it needs to tell
 * connected clients *before* calling this, not after.
 */
export function restartService(): Promise<void> {
  return new Promise((resolve, reject) => {
    exec('sudo /bin/systemctl restart fluidnc-webcontrol', (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`Service restart failed: ${stderr || err.message}`));
        return;
      }
      resolve();
    });
  });
}
