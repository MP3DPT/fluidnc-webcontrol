import { ArrowUpCircle, Coffee, GitFork, Tag } from 'lucide-react';
import { APP_VERSION, type LatestAppVersion } from '../version';

interface Props {
  /** null when up to date, offline, or the check hasn't resolved yet - see useLatestAppVersion(). */
  latestVersion: LatestAppVersion | null;
  onOpenUpdate: () => void;
}

/** Static "what is this app" blurb - its own sidebar destination, not folded into Settings. */
export function AboutPanel({ latestVersion, onOpenUpdate }: Props) {
  return (
    <div className="drawer-panel">
      <h3>fluidnc-webcontrol v{APP_VERSION}</h3>
      <p className="hint">
        A free, open-source web control interface for FluidNC CNC controllers - jog, stream G-code, probe, and
        monitor a machine from any browser on the network.
      </p>
      <a
        className="about-github-link"
        href="https://github.com/MP3DPT/fluidnc-webcontrol"
        target="_blank"
        rel="noopener noreferrer"
      >
        <GitFork size={15} />
        github.com/MP3DPT/fluidnc-webcontrol
      </a>
      {/* Always visible, not just when an update is pending - the banner
          below only appears while behind, so this is the only way to see
          what's new after already being on the latest version. GitHub's own
          "/releases/latest" redirect, so it's never stale and needs no API
          call to keep correct. */}
      <a
        className="about-github-link"
        href="https://github.com/MP3DPT/fluidnc-webcontrol/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Tag size={15} />
        Latest release notes
      </a>

      {latestVersion && (
        <div className="about-update-banner">
          <ArrowUpCircle size={16} />
          <div>
            <strong>Update available: v{latestVersion.version}</strong>
            <p className="hint">
              Review what's new and update in place, right from here - a short service restart at the end, no SSH
              needed. (See{' '}
              <a href={latestVersion.url} target="_blank" rel="noopener noreferrer">
                the release notes
              </a>{' '}
              on GitHub if you'd rather read them there first.)
            </p>
            <button className="primary" onClick={onOpenUpdate}>
              Update to v{latestVersion.version}
            </button>
          </div>
        </div>
      )}

      <div className="settings-section">
        <h4>Why this exists</h4>
        <p className="hint">
          FluidNC ships with a built-in web UI - including on boards like the PiBot V4.96 PRO, where it comes
          pre-loaded - but it's a bare-bones one: enough to jog and run a job, not much else. Its file list is flat,
          with no folders, no thumbnails, and no job info before you hit run - no feed/speed, no size, no time
          estimate. No live toolpath preview either, thin jog controls, and no way to extend it without touching
          firmware. This app exists to fill those gaps - the same FluidNC controller underneath, a fuller browser
          interface on top, and a plugin system so anyone can bolt on what their own setup needs.
        </p>
      </div>

      <div className="settings-section">
        <h4>Why FluidNC, not GRBL</h4>
        <p className="hint">
          The PiBot V4.96 PRO is built around an ESP32 - a 32-bit, dual-core chip with WiFi built in. Classic GRBL
          targets 8-bit AVR boards (Uno, Mega): far less RAM, no networking, and no room for the extras this board
          can actually do. FluidNC is the modern, actively-maintained successor built specifically for ESP32 - it
          keeps GRBL's G-code compatibility but adds a YAML config (remap pins, change drivers, without recompiling
          firmware), native WiFi/web server, and support for things GRBL doesn't have out of the box, like the
          dual-motor auto-squaring this setup uses. Flashing back to GRBL would mean giving that up to run on
          hardware that was never designed for it.
        </p>
      </div>

      <div className="settings-section">
        <h4>Status</h4>
        <p className="hint">
          Work in progress - actively developed, expect rough edges, breaking changes, and missing features.
        </p>
      </div>

      <div className="settings-section">
        <h4>Built with</h4>
        <p className="hint">TypeScript throughout - React on the frontend, Node.js on the backend.</p>
      </div>

      <div className="settings-section">
        <h4>License</h4>
        <p className="hint">MIT - free to use, modify, and redistribute.</p>
      </div>

      <div className="settings-section">
        <h4>Hardware</h4>
        <p className="hint">
          Built and tested on a Raspberry Pi 4, paired with a PiBot V4.96 PRO (FluidNC) controller board over USB
          serial - but works with any FluidNC-based controller and machine: routers, mills, laser or plasma setups.
        </p>
        <p className="hint">
          The pre-flashed image is 64-bit Raspberry Pi OS (confirmed: <code>aarch64</code> on the actual hardware
          it's tested on), which rules out the <strong>original Raspberry Pi Zero W</strong> entirely - its
          single-core ARMv6 chip has no 64-bit support at all, so the image simply won't boot, not a performance
          question. The <strong>Raspberry Pi Zero 2 W</strong> is a different, later board with a quad-core chip
          from the same family as the Pi 3, and is architecturally compatible - genuinely untested by us, but the
          backend itself is lightweight (Node.js, Express, WebSockets), so the core app (jogging, streaming G-code,
          monitoring) is plausible there. Its 512MB RAM (half the Pi 3's 1GB) is reason enough to skip the webcam
          plugin on it regardless - save that one for a Pi 3 or 4. The Pi 3 itself is likewise untested but expected
          to run the whole app just as comfortably as the Pi 4 it was actually built on.
        </p>
      </div>

      <div className="settings-section">
        <h4>Plugins</h4>
        <p className="hint">
          FluidNC can't know what's sitting next to your machine - a shop fan, a smart plug wired to the spindle, or
          that you'd rather get a free notification straight to your phone when a job errors out or finishes. The
          plugin system is how this app catches up to your specific setup instead of the other way around: a plugin
          can watch machine state and react to it, like switching a
          smart plug on before a job starts (with a spin-up delay) and back off however the job ends - no G-code
          M-codes or relay wiring changes required. See the Plugins tab for what's installed.
        </p>
      </div>

      <div className="settings-section">
        <h4>Roadmap &amp; contributing</h4>
        <p className="hint">
          This app was built to solve its developer's own, immediate needs - that's why the plugins available today
          cover exactly what he needed on his own machine, not a wishlist of everything FluidNC could ever do. More
          features and plugins are likely to show up over time simply from continued use. If you run into something
          missing, don't just work around it -{' '}
          <a href="https://github.com/MP3DPT/fluidnc-webcontrol/issues" target="_blank" rel="noopener noreferrer">
            open an issue
          </a>{' '}
          or contribute it yourself, whether that's a core app change or a brand new plugin.
        </p>
      </div>

      <div className="settings-section">
        <h4>Credits</h4>
        <div className="about-credit">
          <img src="/mp-logo.png" alt="" className="about-credit-logo" />
          <p className="hint">
            Created by Miguel Pires (MP3DPT) · <a href="mailto:mp3dpt@gmail.com">mp3dpt@gmail.com</a>
          </p>
        </div>
        <p className="hint">Built with the help of Claude (Anthropic).</p>
      </div>

      <div className="about-footer">
        <p className="hint">Free, and free to keep using - if it saved you time, you can buy me a coffee.</p>
        <a
          className="about-coffee-link"
          href="https://paypal.me/mmpires?locale.x=pt_PT&country.x=PT"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Coffee size={15} />
          Buy me a coffee
        </a>
      </div>
    </div>
  );
}
