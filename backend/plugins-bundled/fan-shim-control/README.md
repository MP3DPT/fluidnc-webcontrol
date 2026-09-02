# Fan SHIM Control

Automatic temperature-based fan control for the [Pimoroni Fan SHIM](https://shop.pimoroni.com/products/fan-shim), turning the fan on and off around thresholds you set instead of leaving it always-on or manually toggled.

## Before you install

You need the physical Fan SHIM board seated on the Pi's GPIO header — this plugin drives it directly over **GPIO18** using the `gpiod` command-line tools (`gpioset` specifically), not Pimoroni's own Python `fanshim` package. That means:

- **No Python packages to install** — deliberately avoided, since the point of a Node-based plugin is not depending on a separate Python environment.
- `gpiod` (which provides `gpioset`) is installed automatically by `scripts/install.sh` - nothing to do here on a normal install. If you're on an older install from before that, or `gpioset` still isn't found (check with `which gpioset`), install it yourself:
  ```bash
  sudo apt update
  sudo apt install -y gpiod
  ```

Temperature is read from `/sys/class/thermal/thermal_zone0/temp`, which is standard on Raspberry Pi OS — no extra setup needed there.

## Configuring the plugin

In the app: **Plugins → Fan SHIM Control → Configure**, set "Turn on at" and "Turn off at" temperatures. Keep "Turn off at" comfortably below "Turn on at" — that gap (hysteresis) is what stops the fan rapidly clicking on and off right at one temperature. Use **Check Temp & Fan State** to confirm it's reading correctly, and **Test: Force Fan On** / **Test: Force Fan Off** to confirm GPIO control actually works before relying on the automatic thresholds.
