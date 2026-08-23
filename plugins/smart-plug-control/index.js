import TuyAPI from 'tuyapi';

const OPERATION_TIMEOUT_MS = 10_000;

/**
 * A stuck Tuya connection must never hang forever - beforeRun() awaits
 * this before a job starts, and a promise that never settles would
 * permanently wedge the "is a job starting?" guard in the app's job-run
 * handler, silently no-op-ing every future Run click.
 */
function withTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), OPERATION_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Controls a Tuya-protocol smart plug over the local network - no cloud
 * round-trip. Many budget/white-label smart plugs (including SPC's) are
 * Tuya devices under a different sticker. Requires the device's
 * local_key, extracted once via Tuya's IoT platform + a discovery tool
 * (e.g. tinytuya's wizard) - a real one-time hurdle, not something this
 * plugin can do on your behalf.
 *
 * A fresh connection is opened per action rather than held persistently -
 * simpler and safer for the occasional on/off calls this plugin makes.
 */
class TuyaLocalDriver {
  constructor(ip, deviceId, localKey, protocolVersion) {
    this.ip = ip;
    this.deviceId = deviceId;
    this.localKey = localKey;
    this.protocolVersion = protocolVersion;
  }

  async withDevice(action) {
    const device = new TuyAPI({ id: this.deviceId, key: this.localKey, ip: this.ip, version: this.protocolVersion });
    // tuyapi emits its own 'error' events straight on the device/socket,
    // independently of whether connect() itself has settled yet (e.g. an
    // unreachable IP surfaces this way, not as a connect() rejection). An
    // EventEmitter 'error' with no listener is fatal in Node - it throws
    // and takes the whole process down, not just this plugin. Funnel it
    // into the same rejection path as everything else here instead.
    const deviceError = new Promise((_, reject) => {
      device.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
    });
    try {
      return await withTimeout(
        Promise.race([
          (async () => {
            await device.connect();
            return action(device);
          })(),
          deviceError,
        ]),
        `Smart plug at ${this.ip} did not respond within ${OPERATION_TIMEOUT_MS / 1000}s`,
      );
    } finally {
      device.disconnect();
    }
  }

  turnOn() {
    return this.withDevice((device) => device.set({ dps: 1, set: true }));
  }

  turnOff() {
    return this.withDevice((device) => device.set({ dps: 1, set: false }));
  }
}

function createDriver(config) {
  if (!config.enabled) return null;
  if (config.driver === 'tuya-local') {
    if (!config.ip || !config.deviceId || !config.localKey) return null;
    return new TuyaLocalDriver(config.ip, config.deviceId, config.localKey, config.protocolVersion ?? '3.3');
  }
  return null;
}

/** @param {import('../../src/plugins/types.js').PluginContext} ctx */
export function activate(ctx) {
  ctx.registerBeforeRun(async () => {
    const config = ctx.settings.get();
    if (!config.enabled || !config.autoStart) return;
    const driver = createDriver(config);
    if (!driver) return;
    const spinUpSeconds = Math.max(0, Number(config.spinUpSeconds) || 0);
    ctx.broadcast('feedback', `[Smart plug: turning on, waiting ${spinUpSeconds}s for spin-up]`);
    await driver.turnOn();
    await new Promise((resolve) => setTimeout(resolve, spinUpSeconds * 1000));
  });

  // Job-end automation:
  //  - always turn off, regardless of *how* the job ended (complete,
  //    stopped, or error) - the spindle should never be left running just
  //    because the job didn't finish cleanly.
  //  - only on a *clean* completion, optionally return to work X0 Y0. Not
  //    on stop/error - after an abnormal end the position isn't
  //    necessarily trustworthy, so auto-driving further moves could
  //    compound a problem (same reasoning as not auto-retracting on
  //    emergency stop). There's deliberately no automatic Z-retract here -
  //    a file's own end routine usually already retracts, and an
  //    additional automatic lift risks pushing past the machine's real Z
  //    travel (a "Soft limit" alarm right after an otherwise-successful
  //    job - this happened in testing before it was removed).
  const onProgramStatus = (state) => {
    const config = ctx.settings.get();
    const driver = createDriver(config);
    if (!driver) return;

    (async () => {
      if (state.state === 'complete' && config.autoReturnToOrigin) {
        await ctx.connection.sendLine('G90');
        await ctx.connection.sendLine('G0 X0 Y0');
      }
      if ((state.state === 'complete' || state.state === 'stopped' || state.state === 'error') && config.autoStop) {
        await driver.turnOff();
      }
    })().catch((err) => {
      ctx.broadcast('error', `Smart plug automation: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  ctx.runner.on('programStatus', onProgramStatus);

  ctx.registerAction('test-on', async () => {
    const driver = createDriver({ ...ctx.settings.get(), enabled: true });
    if (!driver) throw new Error('Smart plug is not fully configured yet.');
    await driver.turnOn();
    return { message: 'Smart plug: turned on' };
  });

  ctx.registerAction('test-off', async () => {
    const driver = createDriver({ ...ctx.settings.get(), enabled: true });
    if (!driver) throw new Error('Smart plug is not fully configured yet.');
    await driver.turnOff();
    return { message: 'Smart plug: turned off' };
  });

  // Cleanup on uninstall.
  return () => {
    ctx.runner.off('programStatus', onProgramStatus);
  };
}

export default { activate };
