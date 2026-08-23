import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHIP = 'gpiochip0';
const FAN_LINE = '18'; // Fan SHIM's fan transistor, BCM18, active-high
const TEMP_PATH = '/sys/class/thermal/thermal_zone0/temp';
const POLL_INTERVAL_MS = 3000;

function readCpuTempC() {
  const raw = readFileSync(TEMP_PATH, 'utf-8').trim();
  return Number(raw) / 1000;
}

/**
 * Holds GPIO18 at a fixed level via a long-lived `gpioset` process. gpiod's
 * own docs are explicit that the line's level is only guaranteed while that
 * process stays alive ("not guaranteed" once it exits) - confirmed on this
 * hardware too: killing the holder lets the pin float back to its default
 * (which happens to read as active/HIGH here, i.e. fails toward the fan
 * being ON rather than stuck off). So changing state always means starting
 * a new holder and killing the old one, never just running gpioset once.
 */
class FanGpio {
  constructor() {
    this.child = null;
    this.state = null;
  }

  isAlive() {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  set(on) {
    if (this.state === on && this.isAlive()) return;
    const previous = this.child;
    const child = spawn('gpioset', ['-c', CHIP, `${FAN_LINE}=${on ? 1 : 0}`], { stdio: 'ignore' });
    child.on('error', (err) => {
      console.error(`Fan SHIM: gpioset failed to start - ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        // Died on its own (crash, external signal, anything) rather than
        // via our own kill() below - clear it so the next tick's ensure()
        // notices and respawns, instead of trusting a dead reference.
        console.error(`Fan SHIM: gpioset holder exited unexpectedly (code=${code}, signal=${signal})`);
        this.child = null;
      }
    });
    this.child = child;
    this.state = on;
    if (previous) previous.kill();
  }

  /**
   * Self-heal: the held process is the only thing keeping GPIO18 at the
   * intended level (gpiod itself says the level "is not guaranteed" once
   * the holder exits), so if it died for any reason without us noticing a
   * state change, respawn it here rather than leaving the pin's real level
   * silently out of sync with what we think it is.
   */
  ensure() {
    if (this.state !== null && !this.isAlive()) {
      this.set(this.state);
    }
  }

  stop() {
    if (this.child) this.child.kill();
    this.child = null;
    this.state = null;
  }
}

export function activate(ctx) {
  const fan = new FanGpio();
  fan.set(false); // known-safe starting state regardless of whatever held the pin before

  const timer = setInterval(() => {
    try {
      fan.ensure();
      const config = ctx.settings.get();
      if (!config.enabled) return;
      const onThreshold = Number(config.onThreshold) || 65;
      const offThreshold = Number(config.offThreshold) || 55;
      const tempC = readCpuTempC();
      // Hysteresis: which threshold applies depends on the fan's current
      // state, so it doesn't rapidly cycle right at one temperature.
      const shouldBeOn = fan.state ? tempC > offThreshold : tempC >= onThreshold;
      if (shouldBeOn !== fan.state) {
        fan.set(shouldBeOn);
        ctx.broadcast('feedback', `[Fan SHIM: ${shouldBeOn ? 'on' : 'off'} at ${tempC.toFixed(1)}°C]`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Fan SHIM: ${message}`);
      ctx.broadcast('error', `Fan SHIM: ${message}`);
    }
  }, POLL_INTERVAL_MS);

  ctx.registerAction('check-now', async () => {
    const tempC = readCpuTempC();
    return { message: `Fan SHIM: CPU at ${tempC.toFixed(1)}°C, fan is currently ${fan.state ? 'on' : 'off'}` };
  });

  ctx.registerAction('test-on', async () => {
    fan.set(true);
    return { message: 'Fan SHIM: forced on' };
  });

  ctx.registerAction('test-off', async () => {
    fan.set(false);
    return { message: 'Fan SHIM: forced off' };
  });

  return () => {
    clearInterval(timer);
    fan.stop();
  };
}

export default { activate };
