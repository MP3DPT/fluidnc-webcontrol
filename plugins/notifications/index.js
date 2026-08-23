const SEND_TIMEOUT_MS = 10_000;

function withTimeout(promise, message) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), SEND_TIMEOUT_MS)),
  ]);
}

async function sendNtfy(config, title, message, priority) {
  const base = (config.serverUrl || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(config.topic)}`;
  const res = await withTimeout(
    fetch(url, { method: 'POST', headers: { Title: title, Priority: priority }, body: message }),
    'ntfy request timed out',
  );
  if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
}

async function sendDiscord(config, title, message) {
  const res = await withTimeout(
    fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `**${title}**\n${message}` }),
    }),
    'Discord webhook request timed out',
  );
  if (!res.ok) throw new Error(`Discord webhook responded ${res.status}`);
}

async function sendTelegram(config, title, message) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text: `${title}\n${message}` }),
    }),
    'Telegram request timed out',
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(`Telegram responded ${res.status}${data?.description ? `: ${data.description}` : ''}`);
  }
}

async function send(config, title, message, priority) {
  if (!config.enabled) return;
  switch (config.driver) {
    case 'ntfy':
      if (!config.topic) throw new Error('ntfy topic is not set');
      return sendNtfy(config, title, message, priority);
    case 'discord':
      if (!config.webhookUrl) throw new Error('Discord webhook URL is not set');
      return sendDiscord(config, title, message);
    case 'telegram':
      if (!config.botToken || !config.chatId) throw new Error('Telegram bot token/chat ID is not set');
      return sendTelegram(config, title, message);
    default:
      return; // no provider selected
  }
}

// FluidNC's ExecAlarm codes (src/Alarm.h) - kept here since the app has no
// other need for a full alarm→description table.
const ALARM_DESCRIPTIONS = {
  1: 'Hard limit triggered',
  2: 'Soft limit exceeded (G-code target outside machine travel)',
  3: 'Cycle aborted (reset during motion - position may be lost)',
  4: 'Probe failed (not in expected initial state)',
  5: 'Probe failed (no contact within programmed travel)',
  6: 'Homing failed (reset during homing)',
  7: 'Homing failed (door opened during homing)',
  8: 'Homing failed (could not clear limit switch)',
  9: 'Homing failed (could not find limit switch)',
  10: 'Spindle control error',
  11: 'Control or limit pin active at startup',
  12: 'Homing failed (ambiguous switch)',
  13: 'Hard stop triggered',
  14: 'Machine not homed',
  15: 'Initialization error',
  16: 'I/O expander reset',
  17: 'G-code error',
  18: 'Probe triggered a hard limit',
};

export function activate(ctx) {
  const notify = (title, message, priority) => {
    const config = ctx.settings.get();
    send(config, title, message, priority).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Notifications: ${msg}`);
      ctx.broadcast('error', `Notifications: ${msg}`);
    });
  };

  const startupConfig = ctx.settings.get();
  if (startupConfig.enabled && startupConfig.notifyAppStarted) {
    notify('fluidnc-webcontrol', 'The Pi is on and the app is running.', '3');
  }

  const onAlarm = (code) => {
    const config = ctx.settings.get();
    if (!config.enabled || !config.notifyAlarm) return;
    const description = ALARM_DESCRIPTIONS[code] ?? 'Unknown alarm';
    notify('CNC alarm', `ALARM:${code} - ${description}`, '5');
  };
  ctx.connection.on('alarm', onAlarm);

  const onProgramStatus = (state) => {
    const config = ctx.settings.get();
    if (!config.enabled) return;
    if (state.state === 'complete' && config.notifyJobFinished) {
      notify('Job finished', 'The G-code program completed successfully.', '3');
    } else if (state.state === 'stopped' && config.notifyJobStopped) {
      notify('Job stopped', 'The G-code program was stopped.', '3');
    } else if (state.state === 'error' && config.notifyJobError) {
      notify('Job error', 'The G-code program stopped due to an error.', '4');
    }
  };
  ctx.runner.on('programStatus', onProgramStatus);

  // portError (not the generic 'close' event) is the right signal here -
  // 'close' also fires on a deliberate Disconnect click from the UI, but
  // portError only fires for a real serial port error (cable pulled, device
  // node vanished, etc.), so it won't nag on an intentional disconnect.
  const onPortError = (err) => {
    const config = ctx.settings.get();
    if (!config.enabled || !config.notifyDisconnected) return;
    const message = err instanceof Error ? err.message : String(err);
    notify('Connection lost', `Lost the connection to the controller: ${message}`, '4');
  };
  ctx.connection.on('portError', onPortError);

  ctx.registerAction('test-notification', async () => {
    const config = ctx.settings.get();
    await send({ ...config, enabled: true }, 'Test notification', 'fluidnc-webcontrol is talking to you!', '3');
    return { message: 'Notifications: test sent' };
  });

  return () => {
    ctx.connection.off('alarm', onAlarm);
    ctx.runner.off('programStatus', onProgramStatus);
    ctx.connection.off('portError', onPortError);
  };
}

export default { activate };
