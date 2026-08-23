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
