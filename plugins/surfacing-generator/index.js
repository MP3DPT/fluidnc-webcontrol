/**
 * Generates a facing toolpath - flattening a spoilboard or panel - as
 * either a raster (horizontal/vertical boustrophedon/zig-zag) or a
 * rectangular inward spiral, from a small set of dimensions, then loads the
 * result straight into the Program tab via the same path File Manager uses
 * (see PluginToolDialog's "loadGcode" message), not ctx.runner.load()
 * directly - the frontend's 3D preview and filename are local React state,
 * only ever set by the browser's own load path.
 *
 * This is a "tool" plugin (manifest "tool": true), not a "panel" one like
 * zprobe-touchplate - it's configured occasionally and used once per
 * surfacing job, not glanced at during every job, so it lives behind the
 * sidebar's Tools tab as an on-demand dialog instead of permanently
 * occupying dashboard space.
 *
 * Deliberately doesn't touch work coordinates or zero anything itself - it
 * assumes you've already jogged to and zeroed work X/Y/Z at whichever
 * corner you pick as "Origin" below, same convention zprobe-touchplate uses
 * for Z. The Origin selector only changes the *sign* of the generated
 * coordinates, not any machine offset.
 *
 * No coolant support (M7/M8) - deliberately left out for now. Most CNC
 * routers this app targets don't have a coolant system at all; add it back
 * if the community actually asks.
 */

function currentConfig(ctx) {
  const c = ctx.settings.get();
  return {
    xDimension: Number(c.xDimension ?? 100),
    yDimension: Number(c.yDimension ?? 100),
    mode: c.mode === 'wasteboard' ? 'wasteboard' : 'target-depth',
    originH: c.originH ?? 'left',
    originV: c.originV ?? 'bottom',
    direction: c.direction ?? 'horizontal',
    targetDepth: Number(c.targetDepth ?? 0.5),
    depthOfCut: Number(c.depthOfCut ?? 0.5),
    stepoverPercent: Number(c.stepoverPercent ?? 80),
    overrun: Number(c.overrun ?? 0),
    retractHeight: Number(c.retractHeight ?? 5),
    bitDiameter: Number(c.bitDiameter ?? 25),
    feedRate: Number(c.feedRate ?? 2000),
    spindleRpm: Number(c.spindleRpm ?? 12000),
    spindleDelay: Number(c.spindleDelay ?? 0),
  };
}

function fmt(n) {
  // Trim to 4 decimals but drop trailing zeros - keeps the file readable
  // without accumulating float noise (25.400000000000002 etc).
  return Number(n.toFixed(4)).toString();
}

/**
 * One Z pass's worth of zig-zag rows across the rectangle, appended to
 * `lines`. `along` is the axis each row sweeps; `step` is the axis
 * incremented between rows (perpendicular). Overrun extends only the swept
 * axis, past both edges, so the cutter is already at full engagement (or
 * fully clear) at the moment it crosses the real edge of the stock -
 * without it, the outermost pass would leave a slight ridge where the
 * cutter changed direction exactly at the material's edge.
 */
function appendRasterPass(lines, { xMin, xMax, yMin, yMax, direction, stepover, overrun, z, feedRate, retractHeight }) {
  const alongAxis = direction === 'vertical' ? 'Y' : 'X';
  const stepAxis = alongAxis === 'X' ? 'Y' : 'X';
  const alongMin = (alongAxis === 'X' ? xMin : yMin) - overrun;
  const alongMax = (alongAxis === 'X' ? xMax : yMax) + overrun;
  const stepMin = stepAxis === 'X' ? xMin : yMin;
  const stepMax = stepAxis === 'X' ? xMax : yMax;
  const stepRange = Math.max(0, stepMax - stepMin);
  const rowCount = Math.max(1, Math.ceil(stepRange / stepover));
  const actualStepover = stepRange / rowCount;
  const plungeFeed = Math.max(50, Math.round(feedRate / 4));

  lines.push(`G0 ${alongAxis}${fmt(alongMin)} ${stepAxis}${fmt(stepMin)}`);
  lines.push(`G1 Z${fmt(z)} F${plungeFeed}`);

  let atMax = true;
  for (let row = 0; row <= rowCount; row++) {
    const target = atMax ? alongMax : alongMin;
    lines.push(`G1 ${alongAxis}${fmt(target)} F${feedRate}`);
    if (row < rowCount) {
      const stepPos = stepMin + actualStepover * (row + 1);
      lines.push(`G1 ${stepAxis}${fmt(stepPos)} F${feedRate}`);
      atMax = !atMax;
    }
  }

  lines.push(`G0 Z${fmt(retractHeight)}`);
}

/**
 * One Z pass of a rectangular inward spiral - full-perimeter loops that
 * step inward by `stepover` on all four sides each time, down to the
 * center. Every ring traces all 4 edges explicitly (not just 3 with a
 * diagonal shortcut) so nothing near the middle is left uncut - the
 * shortcut would skip an edge on every ring but the outermost, relying on
 * bit-radius reach alone to clear it. Unlike the raster's overrun (which
 * only extends the swept axis), overrun here extends all four sides
 * equally, since a spiral has no single "direction of travel" to overrun
 * past.
 */
function appendSpiralPass(lines, { xMin, xMax, yMin, yMax, overrun, stepover, z, feedRate, retractHeight }) {
  const plungeFeed = Math.max(50, Math.round(feedRate / 4));
  let left = xMin - overrun;
  let right = xMax + overrun;
  let bottom = yMin - overrun;
  let top = yMax + overrun;

  lines.push(`G0 X${fmt(left)} Y${fmt(bottom)}`);
  lines.push(`G1 Z${fmt(z)} F${plungeFeed}`);

  while (true) {
    lines.push(`G1 X${fmt(right)} Y${fmt(bottom)} F${feedRate}`);
    lines.push(`G1 X${fmt(right)} Y${fmt(top)} F${feedRate}`);
    lines.push(`G1 X${fmt(left)} Y${fmt(top)} F${feedRate}`);
    lines.push(`G1 X${fmt(left)} Y${fmt(bottom)} F${feedRate}`);

    const nextLeft = left + stepover;
    const nextRight = right - stepover;
    const nextBottom = bottom + stepover;
    const nextTop = top - stepover;
    if (nextLeft >= nextRight || nextBottom >= nextTop) break;

    left = nextLeft;
    right = nextRight;
    bottom = nextBottom;
    top = nextTop;
    lines.push(`G1 X${fmt(left)} Y${fmt(bottom)} F${feedRate}`);
  }

  lines.push(`G0 Z${fmt(retractHeight)}`);
}

function buildGcode(p) {
  const xMin = p.originH === 'left' ? 0 : p.originH === 'right' ? -p.xDimension : -p.xDimension / 2;
  const xMax = xMin + p.xDimension;
  const yMin = p.originV === 'bottom' ? 0 : p.originV === 'top' ? -p.yDimension : -p.yDimension / 2;
  const yMax = yMin + p.yDimension;

  const stepover = Math.max(0.1, p.bitDiameter * (p.stepoverPercent / 100));
  const passes = Math.max(1, Math.ceil(p.targetDepth / Math.max(0.01, p.depthOfCut)));
  const perPassDepth = p.targetDepth / passes;

  const lines = [];
  lines.push('; Surfacing / Facing - generated by fluidnc-webcontrol');
  lines.push(`; ${p.xDimension}x${p.yDimension}mm, target depth ${p.targetDepth}mm, bit diameter ${p.bitDiameter}mm, ${passes} pass(es)`);
  lines.push('G21 ; millimeters');
  lines.push('G90 ; absolute positioning');
  lines.push(`G0 Z${fmt(p.retractHeight)}`);
  lines.push(`M3 S${Math.round(p.spindleRpm)} ; spindle on`);
  if (p.spindleDelay > 0) lines.push(`G4 P${p.spindleDelay} ; wait for spindle to reach speed`);

  for (let pass = 1; pass <= passes; pass++) {
    const z = -(perPassDepth * pass);
    lines.push(`; pass ${pass}/${passes} - Z${fmt(z)}`);
    const passArgs = { xMin, xMax, yMin, yMax, stepover, overrun: p.overrun, z, feedRate: p.feedRate, retractHeight: p.retractHeight };
    if (p.direction === 'spiral') {
      appendSpiralPass(lines, passArgs);
    } else {
      appendRasterPass(lines, Object.assign({ direction: p.direction }, passArgs));
    }
  }

  lines.push('M5 ; spindle off');
  lines.push('M30');
  return lines.join('\n');
}

function renderDialogHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {
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
    --warning: #f59e0b;
    --warning-soft: rgba(245, 158, 11, 0.1);
    --danger: #ef4444;
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    --radius-sm: 0.375rem;
    --radius: 0.4375rem;
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
      --warning: #b45309;
      --warning-soft: rgba(180, 83, 9, 0.08);
      --danger: #dc2626;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font: 500 0.875rem/1.4 var(--font-sans); color: var(--text-primary); padding: 1.25rem; }
  h3 { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin: 0 0 0.75rem; padding-bottom: 0.625rem; border-bottom: 1px solid var(--border); }
  .unit-pill { font-size: 0.625rem; font-weight: 600; letter-spacing: normal; text-transform: none; color: var(--primary); background: var(--primary-soft); border-radius: 1rem; padding: 0.1rem 0.5rem; }
  .columns { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .column { flex: 1; min-width: 15rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font: 600 0.6875rem/1.2 var(--font-sans); color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
  .field-row { display: flex; align-items: center; gap: 0.5rem; }
  .field-row span:last-child { font: 400 0.75rem/1.5 var(--font-sans); color: var(--text-muted); text-transform: none; letter-spacing: normal; }
  input, select {
    padding: 0 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border);
    background: var(--surface-elevated); color: var(--text-primary); margin: 0; height: 2rem;
    width: 100%; font: 500 0.875rem/1.4 var(--font-sans); font-variant-numeric: tabular-nums;
  }
  input:hover, select:hover { border-color: var(--text-muted); }
  input:focus-visible, select:focus-visible { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  input:disabled { opacity: 0.55; cursor: not-allowed; }
  .origin-picker { display: grid; grid-template-columns: repeat(3, 1.75rem); grid-template-rows: repeat(3, 1.75rem); gap: 0.4rem; justify-content: start; }
  .origin-dot { width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--surface-elevated); border: 1px solid var(--border); cursor: pointer; }
  .origin-dot:hover { border-color: var(--text-muted); }
  .origin-dot.active { background: var(--primary); border-color: var(--primary); }
  .working-area-confirm { display: none; flex-direction: column; gap: 0.5rem; background: var(--warning-soft); border: 1px solid var(--warning); border-radius: var(--radius-sm); padding: 0.625rem 0.75rem; }
  .working-area-confirm p { margin: 0; font: 400 0.75rem/1.5 var(--font-sans); color: var(--text-primary); text-transform: none; }
  .working-area-confirm .actions { margin: 0; padding: 0; border: none; justify-content: flex-start; }
  .working-area-confirm button { height: 1.75rem; padding: 0 0.75rem; font-size: 0.75rem; }
  .actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem; padding-top: 1rem; border-top: 1px solid var(--border); }
  button {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
    padding: 0 1.25rem; height: 2.25rem; border-radius: var(--radius); cursor: pointer;
    font: 500 0.875rem/1.4 var(--font-sans);
  }
  button.primary { border: 1px solid var(--primary); background: var(--primary); color: #fff; }
  button.primary:not(:disabled):hover { background: var(--primary-hover); border-color: var(--primary-hover); }
  button.secondary { border: 1px solid var(--border); background: transparent; color: var(--text-secondary); }
  button.secondary:hover { background: var(--surface-hover); color: var(--text-primary); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .status { font: 400 0.8125rem/1.5 var(--font-sans); color: var(--text-muted); min-height: 1.2rem; margin-top: 0.5rem; }
  .status.error { color: var(--danger); }
  .disabled-notice { color: var(--danger); font-size: 0.8125rem; margin: 0 0 1rem; }
</style>
</head>
<body>
  <p class="disabled-notice" id="disabledNotice" style="display:none;">This plugin is disabled - enable it in the Plugins tab first.</p>

  <div class="columns">
    <div class="column">
      <h3>Dimensions <span class="unit-pill">mm</span></h3>
      <label>Mode
        <select id="mode">
          <option value="target-depth">Target depth</option>
          <option value="wasteboard" id="wasteboardOption">Wasteboard surfacing</option>
        </select>
      </label>
      <div class="working-area-confirm" id="workingAreaConfirm">
        <p id="workingAreaConfirmText"></p>
        <div class="actions">
          <button type="button" class="secondary" id="workingAreaCancelBtn">Cancel</button>
          <button type="button" class="primary" id="workingAreaUseBtn">Use it</button>
        </div>
      </div>
      <div class="field-grid">
        <label>Direction
          <select id="direction">
            <option value="horizontal">Horizontal (X)</option>
            <option value="vertical">Vertical (Y)</option>
            <option value="spiral">Spiral</option>
          </select>
        </label>
        <label>Origin
          <div class="origin-picker" id="originPicker"></div>
        </label>
      </div>
      <div class="field-grid">
        <label>X dimension<input type="number" id="xDimension" /></label>
        <label>Y dimension<input type="number" id="yDimension" /></label>
      </div>
      <label>Target depth<input type="number" id="targetDepth" step="0.01" /></label>
      <div class="field-grid">
        <label>Depth of cut<input type="number" id="depthOfCut" step="0.01" /></label>
        <label>Stepover<span class="field-row"><input type="number" id="stepoverPercent" /><span>%</span></span></label>
      </div>
      <div class="field-grid">
        <label>Overrun<input type="number" id="overrun" /></label>
        <label>Retract height<input type="number" id="retractHeight" /></label>
      </div>
    </div>

    <div class="column">
      <h3>Machine settings <span class="unit-pill">mm</span></h3>
      <div class="field-grid">
        <label>Bit diameter<input type="number" id="bitDiameter" step="0.01" /></label>
        <label>Feed rate<span class="field-row"><input type="number" id="feedRate" /><span>mm/min</span></span></label>
      </div>
      <div class="field-grid">
        <label>Spindle RPM<input type="number" id="spindleRpm" /></label>
        <label>Spindle delay<span class="field-row"><input type="number" id="spindleDelay" /><span>s</span></span></label>
      </div>
    </div>
  </div>

  <div class="status" id="status"></div>

  <div class="actions">
    <button class="secondary" id="cancelBtn">Cancel</button>
    <button class="primary" id="generateBtn">Generate G-code</button>
  </div>

<script>
(function () {
  var ORIGIN = window.location.origin;
  var config = {};
  var enabled = false;
  var workingArea = null;
  var requestCounter = 0;
  var pending = new Map();

  var fields = ['xDimension', 'yDimension', 'direction', 'targetDepth', 'depthOfCut', 'stepoverPercent', 'overrun', 'retractHeight', 'bitDiameter', 'feedRate', 'spindleRpm', 'spindleDelay'];
  var defaults = {
    xDimension: 100, yDimension: 100, direction: 'horizontal', targetDepth: 0.5, depthOfCut: 0.5,
    stepoverPercent: 80, overrun: 0, retractHeight: 5, bitDiameter: 25, feedRate: 2000,
    spindleRpm: 12000, spindleDelay: 0, originH: 'left', originV: 'bottom', mode: 'target-depth',
  };
  var els = {};
  fields.forEach(function (id) { els[id] = document.getElementById(id); });

  var modeEl = document.getElementById('mode');
  var wasteboardOption = document.getElementById('wasteboardOption');
  var workingAreaConfirm = document.getElementById('workingAreaConfirm');
  var workingAreaConfirmText = document.getElementById('workingAreaConfirmText');

  function reportHeight() {
    parent.postMessage({ type: 'contentHeight', height: document.body.scrollHeight }, ORIGIN);
  }

  var originPicker = document.getElementById('originPicker');
  // Only the 4 corners + true center - the only origin positions that
  // actually correspond to somewhere you'd realistically zero a machine
  // against a rectangular stock. The 4 edge-midpoints (top-center,
  // bottom-center, middle-left, middle-right) were dropped; they're still
  // valid grid cells (left empty) so the remaining 5 read as corners+center
  // at a glance instead of a dense, harder-to-parse 3x3.
  var originPositions = [
    { h: 'left', v: 'top', col: 1, row: 1 },
    { h: 'right', v: 'top', col: 3, row: 1 },
    { h: 'center', v: 'middle', col: 2, row: 2 },
    { h: 'left', v: 'bottom', col: 1, row: 3 },
    { h: 'right', v: 'bottom', col: 3, row: 3 },
  ];
  originPositions.forEach(function (pos) {
    var dot = document.createElement('div');
    dot.className = 'origin-dot';
    dot.dataset.h = pos.h;
    dot.dataset.v = pos.v;
    dot.style.gridColumn = pos.col;
    dot.style.gridRow = pos.row;
    dot.addEventListener('click', function () {
      persist({ originH: pos.h, originV: pos.v });
      renderOrigin();
    });
    originPicker.appendChild(dot);
  });

  function renderOrigin() {
    var h = config.originH ?? defaults.originH;
    var v = config.originV ?? defaults.originV;
    Array.from(originPicker.children).forEach(function (dot) {
      dot.classList.toggle('active', dot.dataset.h === h && dot.dataset.v === v);
    });
  }

  function setDimensionsLocked(locked) {
    els.xDimension.disabled = locked;
    els.yDimension.disabled = locked;
  }

  function render() {
    fields.forEach(function (id) {
      if (document.activeElement !== els[id]) els[id].value = config[id] ?? defaults[id];
    });
    renderOrigin();

    var mode = config.mode ?? defaults.mode;
    wasteboardOption.disabled = !workingArea;
    wasteboardOption.textContent = workingArea
      ? 'Wasteboard surfacing (' + workingArea.width + ' \\u00d7 ' + workingArea.height + ' mm)'
      : 'Wasteboard surfacing (set Settings \\u2192 Working Area first)';
    if (document.activeElement !== modeEl) modeEl.value = mode === 'wasteboard' && workingArea ? 'wasteboard' : 'target-depth';
    setDimensionsLocked(modeEl.value === 'wasteboard');

    document.getElementById('disabledNotice').style.display = enabled ? 'none' : 'block';
    document.getElementById('generateBtn').disabled = !enabled;
    reportHeight();
  }

  function persist(patch) {
    Object.assign(config, patch);
    parent.postMessage({ type: 'updateSettings', settings: patch }, ORIGIN);
  }

  fields.forEach(function (id) {
    els[id].addEventListener('input', function (e) {
      var value = e.target.tagName === 'SELECT' ? e.target.value : Number(e.target.value);
      var patch = {};
      patch[id] = value;
      persist(patch);
    });
  });

  modeEl.addEventListener('change', function (e) {
    if (e.target.value === 'wasteboard') {
      workingAreaConfirmText.textContent = 'This will generate G-code sized to your full working area (' + workingArea.width + ' \\u00d7 ' + workingArea.height + ' mm), not a custom size.';
      workingAreaConfirm.style.display = 'flex';
      reportHeight();
    } else {
      persist({ mode: 'target-depth' });
      setDimensionsLocked(false);
    }
  });

  document.getElementById('workingAreaCancelBtn').addEventListener('click', function () {
    modeEl.value = 'target-depth';
    workingAreaConfirm.style.display = 'none';
    reportHeight();
  });

  document.getElementById('workingAreaUseBtn').addEventListener('click', function () {
    persist({ mode: 'wasteboard', xDimension: workingArea.width, yDimension: workingArea.height });
    setDimensionsLocked(true);
    workingAreaConfirm.style.display = 'none';
    render();
  });

  function invokeAction(actionId, params) {
    return new Promise(function (resolve, reject) {
      var requestId = 'r' + requestCounter++;
      pending.set(requestId, { resolve: resolve, reject: reject });
      parent.postMessage({ type: 'invokeAction', actionId: actionId, params: params, requestId: requestId }, ORIGIN);
    });
  }

  document.getElementById('cancelBtn').addEventListener('click', function () {
    parent.postMessage({ type: 'closeToolDialog' }, ORIGIN);
  });

  document.getElementById('generateBtn').addEventListener('click', function () {
    var statusEl = document.getElementById('status');
    var btn = document.getElementById('generateBtn');
    btn.disabled = true;
    statusEl.className = 'status';
    statusEl.textContent = 'Generating…';
    invokeAction('generate', config)
      .then(function (result) {
        statusEl.textContent = 'Loaded ' + result.lines + ' lines into the Program tab.';
        parent.postMessage({ type: 'loadGcode', name: result.filename, gcode: result.gcode }, ORIGIN);
        setTimeout(function () {
          parent.postMessage({ type: 'closeToolDialog' }, ORIGIN);
        }, 700);
      })
      .catch(function (err) {
        statusEl.className = 'status error';
        statusEl.textContent = err.message;
        btn.disabled = !enabled;
      });
  });

  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'coreState') {
      enabled = Boolean(msg.config && msg.config.enabled);
      config = msg.config || {};
      workingArea = msg.workingArea && msg.workingArea.width > 0 && msg.workingArea.height > 0 ? msg.workingArea : null;
      render();
    } else if (msg.type === 'actionResult') {
      var pendingResult = pending.get(msg.requestId);
      if (pendingResult) {
        pending.delete(msg.requestId);
        pendingResult.resolve(msg.result);
      }
    } else if (msg.type === 'actionError') {
      var pendingError = pending.get(msg.requestId);
      if (pendingError) {
        pending.delete(msg.requestId);
        pendingError.reject(new Error(msg.error));
      }
    }
  });

  new ResizeObserver(reportHeight).observe(document.body);
  reportHeight();
})();
</script>
</body>
</html>`;
}

export function activate(ctx) {
  ctx.registerAction('generate', async (params) => {
    const c = ctx.settings.get();
    if (!c.enabled) throw new Error('Surfacing / Facing is disabled - enable it in the Plugins tab first.');
    const p = Object.assign(currentConfig(ctx), params || {});
    const gcode = buildGcode(p);
    return { success: true, gcode, filename: `surfacing-${p.xDimension}x${p.yDimension}.gcode`, lines: gcode.split('\n').length };
  });

  ctx.app.get('/dialog', (_req, res) => {
    res.set('Content-Type', 'text/html');
    res.send(renderDialogHtml());
  });
}

export default { activate };
