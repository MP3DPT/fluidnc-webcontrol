# Notifications

Pushes a notification for machine events — alarms, job completion, connection loss, and more — even when you're not looking at the browser tab. No OS-level setup needed, just picking one provider below and getting its credentials.

## Choose one provider

### ntfy.sh (easiest — free, no signup)
1. Pick a topic name that's hard to guess — anyone who knows it can read your notifications, since there's no authentication.
2. Install the [ntfy app](https://ntfy.sh/) (iOS/Android) or just open `https://ntfy.sh/<your-topic>` in a browser, and subscribe to that same topic.
3. In the plugin, set **Server URL** to `https://ntfy.sh` (or your own self-hosted ntfy server) and **Topic** to the name you picked.

### Discord webhook (free)
1. In your Discord server: **Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**.
2. Paste that URL into the plugin's **Webhook URL** field.
3. Notifications show up as a message in that channel — handy if you or your shop already live in Discord.

### Telegram bot (free)
1. Message **@BotFather** on Telegram to create a new bot; it gives you a **Bot Token**.
2. Send your new bot any message (it can't message you first).
3. Open `https://api.telegram.org/bot<token>/getUpdates` in a browser to find your numeric **Chat ID** in the response.
4. Enter both the Bot Token and Chat ID in the plugin.

## Configuring the plugin

In the app: **Plugins → Notifications → Configure**, pick a provider, fill in its fields, choose which events should notify you, then use **Send Test Notification** to confirm it actually arrives before relying on it.
