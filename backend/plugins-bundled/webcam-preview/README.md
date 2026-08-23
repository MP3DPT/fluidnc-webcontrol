# Webcam Preview

Live preview for up to 4 cameras — USB webcams plugged into the Pi, or IP cameras on your network that already serve an MJPEG stream — shown on the main screen.

## Before you install: one system package

USB cameras need **ffmpeg** and **v4l2-ctl** (from `v4l-utils`) installed on the Pi itself — neither comes with Node.js or this app, and neither gets installed automatically. Without them, a USB camera tile will just fail to start.

```bash
sudo apt update
sudo apt install -y ffmpeg v4l-utils
```

IP cameras (MJPEG URL) don't need either of these — they're only used for capturing from a local `/dev/videoN` device.

## Finding the right device

A single USB webcam often exposes more than one `/dev/videoN` node (e.g. `/dev/video0` and `/dev/video1`), and only one of them actually captures video — the other is usually a metadata node. Once the plugin's installed, use **Plugins → Webcam Preview → Configure → List USB Cameras** to see what's actually connected, rather than guessing.

## Configuring the plugin

In the app: **Plugins → Webcam Preview → Configure**, enable a camera slot, pick USB or IP as the source, and set the device path (USB) or stream URL (IP). Autofocus and manual focus only apply to USB webcams whose hardware actually supports focus control (e.g. the Logitech StreamCam) — on a fixed-focus camera, those fields simply won't do anything.
