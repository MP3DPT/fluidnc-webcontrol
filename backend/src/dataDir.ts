import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where settings, the G-code library, and installed plugins persist -
 * outside the deployable project tree so they survive redeploys and
 * reboots. Defaults to the running user's home directory (works
 * unchanged for a manual per-user install), but a fixed system install
 * (a dedicated service account with no real home to speak of) sets
 * FLUIDNC_DATA_DIR explicitly instead.
 */
export const DATA_DIR = process.env.FLUIDNC_DATA_DIR ?? join(homedir(), '.fluidnc-webcontrol');
