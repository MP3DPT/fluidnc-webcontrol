/**
 * Touch-plate Z probing - probes down, zeros work Z corrected for the
 * plate's thickness, then retracts clear. This used to be a core app
 * feature (connection.probeAndZero()); it's plugin-owned now because
 * Z-probe hardware varies a lot across the CNC market - anyone whose
 * probe works differently can swap this out for their own plugin instead
 * of being stuck with one hardcoded workflow.
 *
 * Renders its own live panel on the main dashboard (manifest "panel":
 * true) via a small postMessage bridge with the parent app - see
 * frontend/src/components/PluginPanels.tsx for the other half of the
 * protocol (coreState/probeResult down, invokeAction/updateSettings/
 * contentHeight up).
 */

function currentConfig(ctx) {
  const c = ctx.settings.get();
  return {
    maxTravel: Number(c.maxTravel ?? -25),
    feedrate: Number(c.feedrate ?? 100),
    plateThickness: Number(c.plateThickness ?? 0),
    retractDistance: Number(c.retractDistance ?? 5),
  };
}

/**
 * At the moment of contact the tool is `plateThickness` above the true
 * work zero, so instead of zeroing the current position, we tell the
 * controller the current position IS `plateThickness` (G10 L20 P1) - work
 * zero then correctly lands on the material surface once retracted.
 */
async function probeAndZero(ctx, { axis, distance, feedrate, plateThickness, retractDistance }) {
  const result = await new Promise((resolve, reject) => {
    ctx.connection.once('probeResult', (r) => resolve(r));
    ctx.connection.probe(axis, distance, feedrate).catch(reject);
  });

  if (!result.success) {
    throw new Error('Probe did not make contact within max travel');
  }

  const thicknessSign = plateThickness >= 0 ? '' : '-';
  await ctx.connection.sendLine(`G10 L20 P1 ${axis}${thicknessSign}${Math.abs(plateThickness)}`);

  if (retractDistance !== 0) {
    // Retract opposite to the direction the probe travelled to trigger.
    const retractValue = (distance >= 0 ? -1 : 1) * Math.abs(retractDistance);
    const retractSign = retractValue >= 0 ? '' : '-';
    await ctx.connection.sendLine('G91');
    await ctx.connection.sendLine(`G0 ${axis}${retractSign}${Math.abs(retractValue)}`);
    await ctx.connection.sendLine('G90');
  }

  return result;
}

function renderPanelHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {
    /* Without this, the iframe document's default canvas paints white
       (the light-scheme default) even with body background:transparent -
       color-scheme is what the canvas fill itself is keyed off. */
    color-scheme: dark;
    --surface-elevated: #1b1e23;
    --surface-hover: #21242a;
    --border: #292c32;
    --text-primary: #eceef0;
    --text-secondary: #9aa0aa;
    --text-muted: #5f6570;
    --primary: #3b82f6;
    --primary-hover: #2563eb;
    --primary-soft: rgba(59, 130, 246, 0.12);
    --danger: #ef4444;
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    --radius-sm: 0.375rem;
    --radius: 0.4375rem;
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
  }
  @media (prefers-color-scheme: light) {
    :root {
      color-scheme: light;
      --surface-elevated: #ffffff;
      --surface-hover: #f3f4f6;
      --border: #dfe2e7;
      --text-primary: #14161a;
      --text-secondary: #5b6270;
      --text-muted: #98a0ac;
      --primary: #1d63e0;
      --primary-hover: #154fb8;
      --primary-soft: rgba(29, 99, 224, 0.08);
      --danger: #dc2626;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font: 500 0.875rem/1.4 var(--font-sans);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .hint { color: var(--text-muted); font: 400 0.75rem/1.5 var(--font-sans); margin: 0; }
  .error-text { color: var(--danger); }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: 0 1rem;
    height: 2rem;
    border-radius: var(--radius);
    border: 1px solid var(--primary);
    background: var(--primary);
    color: #fff;
    cursor: pointer;
    font: 500 0.875rem/1.4 var(--font-sans);
  }
  button:not(:disabled):hover { background: var(--primary-hover); border-color: var(--primary-hover); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  svg { flex-shrink: 0; }
</style>
</head>
<body>
  <button id="probeBtn" disabled>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>
    <span id="btnLabel">Probe &amp; Zero Z</span>
  </button>
  <p class="hint" id="result"></p>
<script>
(function () {
  var ORIGIN = window.location.origin;
  var connectionOpen = false;
  var requestCounter = 0;
  var pending = new Map();

  var buttonEl = document.getElementById('probeBtn');
  var btnLabelEl = document.getElementById('btnLabel');
  var resultEl = document.getElementById('result');

  function reportHeight() {
    parent.postMessage({ type: 'contentHeight', height: document.body.scrollHeight }, ORIGIN);
  }

  // Just the button now - Max travel/Feed/Probe thickness/Retract distance
  // used to be editable right here, duplicating the same fields already in
  // Settings -> Plugins -> Z-Probe. probeAndZero (below) reads the current
  // Settings-configured values itself when called with no params, so
  // there's nothing left for this panel to own except triggering it.
  function render() {
    buttonEl.disabled = !connectionOpen;
    reportHeight();
  }

  function invokeAction(actionId, params) {
    return new Promise(function (resolve, reject) {
      var requestId = 'r' + requestCounter++;
      pending.set(requestId, { resolve: resolve, reject: reject });
      parent.postMessage({ type: 'invokeAction', actionId: actionId, params: params, requestId: requestId }, ORIGIN);
    });
  }

  function showResult(result) {
    if (!result) {
      resultEl.className = 'hint';
      resultEl.textContent = '';
      return;
    }
    resultEl.className = result.success ? 'hint' : 'hint error-text';
    resultEl.textContent = result.success
      ? 'Contact at Z=' + Number(result.position.z).toFixed(3) + ' (machine) — work Z zeroed to plate thickness'
      : 'No contact — probe did not trigger within travel distance';
    reportHeight();
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'coreState') {
      connectionOpen = Boolean(msg.connectionOpen);
      render();
    } else if (msg.type === 'probeResult') {
      showResult(msg.data);
    } else if (msg.type === 'actionResult') {
      var p1 = pending.get(msg.requestId);
      if (p1) { pending.delete(msg.requestId); p1.resolve(msg.result); }
    } else if (msg.type === 'actionError') {
      var p2 = pending.get(msg.requestId);
      if (p2) { pending.delete(msg.requestId); p2.reject(new Error(msg.error)); }
    }
  });

  buttonEl.addEventListener('click', function () {
    buttonEl.disabled = true;
    btnLabelEl.textContent = 'Probing…';
    invokeAction('probeAndZero', {})
      .then(showResult)
      .catch(function (err) {
        resultEl.className = 'hint error-text';
        resultEl.textContent = err.message;
        reportHeight();
      })
      .finally(function () {
        btnLabelEl.textContent = 'Probe & Zero Z';
        buttonEl.disabled = !connectionOpen;
      });
  });

  new ResizeObserver(reportHeight).observe(document.body);
  reportHeight();
})();
</script>
</body>
</html>`;
}

export function activate(ctx) {
  ctx.registerAction('probeAndZero', async (params) => {
    const config = ctx.settings.get();
    if (!config.enabled) throw new Error('Z-Probe | Touch Plate is disabled - enable it in Settings first.');
    const defaults = currentConfig(ctx);
    const p = params || {};
    return probeAndZero(ctx, {
      axis: 'Z',
      distance: Number(p.distance ?? defaults.maxTravel),
      feedrate: Number(p.feedrate ?? defaults.feedrate),
      plateThickness: Number(p.plateThickness ?? defaults.plateThickness),
      retractDistance: Number(p.retractDistance ?? defaults.retractDistance),
    });
  });

  ctx.app.get('/panel', (_req, res) => {
    res.set('Content-Type', 'text/html');
    res.send(renderPanelHtml());
  });
}

export default { activate };
