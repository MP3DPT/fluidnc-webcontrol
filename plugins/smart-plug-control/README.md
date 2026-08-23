# Smart Plug Control

Turns a Tuya-protocol smart plug on before a job (with a spin-up delay) and off after, regardless of how the job ended. Many budget/white-label smart plugs — including generic ones sold under other brand names — are Tuya devices under a different sticker, so this covers more hardware than the name suggests.

## Before you install: the one real hurdle

This plugin talks to the plug **locally, over your LAN** — no cloud round-trip once it's set up, and no Tuya account needed for day-to-day use. But to talk to it locally at all, you need three values the plug doesn't hand out on its own:

- **IP address** — of the plug, on your network
- **Device ID**
- **Local Key**

There's no way around a one-time extraction step to get the Local Key. The plug has to have been set up in the Tuya/Smart Life (or equivalent) phone app first, then you pull its keys back out using a tool like [tinytuya](https://github.com/jasonacox/tinytuya)'s setup wizard:

```bash
pip install tinytuya
python -m tinytuya wizard
```

The wizard asks for credentials from Tuya's IoT Platform (a free developer account, separate from the Smart Life app account) and a **Data Center region** matching where your Smart Life account is registered (e.g. Western Europe, Central Europe, Americas, Eastern America, China, India). Picking the wrong region is the single most common way this step silently fails — the wizard's QR code just keeps expiring with no clearer error than that. If it's not working, double-check the region before anything else.

Once the wizard finds your device, note down its **IP**, **Device ID**, and **Local Key** — that's all this plugin needs. Nothing after this point touches Tuya's servers again.

## Configuring the plugin

In the app: **Plugins → Smart Plug Control → Configure**, set Driver to "Tuya (local network)", and fill in the three values above. If **Test: Turn On** times out with "Timeout waiting for status response," it's almost always the wrong **Protocol version** — try the other options (3.1/3.3/3.4/3.5); 3.3 is the most common.
