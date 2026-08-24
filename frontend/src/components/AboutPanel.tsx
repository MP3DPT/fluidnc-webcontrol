import { Coffee, GitFork } from 'lucide-react';

/** Static "what is this app" blurb - its own sidebar destination, not folded into Settings. */
export function AboutPanel() {
  return (
    <div className="drawer-panel">
      <h3>fluidnc-webcontrol v0.2.0</h3>
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
          The backend itself is lightweight (Node.js, Express, WebSockets - nothing heavy), so a Pi 3 is expected to
          run it just as comfortably - untested, not confirmed yet. A Pi Zero W is likewise untested but should
          still work for the core app - jogging, streaming G-code, monitoring. Its single core and 512MB RAM are the
          reason not to run the webcam plugin on it, though; save that one for a Pi 3 or 4.
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
