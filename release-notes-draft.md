# fluidnc-webcontrol v0.4.12

The time estimate is gone, replaced by what actually matters: a real job timer, and how long each file took the last time you cut it.

## Changed: real cutting time instead of an estimate

The estimate (distance ÷ feed rate) ignored acceleration, so it was badly optimistic on detailed work - a V-carve of thousands of tiny moves showed 3m 54s and really took about 9 minutes. Rather than show a number that can't be trusted, it's removed everywhere (Program tab, the overlay on the toolpath, and the File Manager hover) and replaced with measured time:

- **A timer that starts when the job starts**, shown next to the progress percentage while cutting. Time spent paused is not counted.
- **The real cut time when it finishes** (`Cut time: 9:02`), or `Stopped after …` if you stop it.
- **Last cut:** the app remembers how long each file really took the last time it ran to completion, and shows it (`Last cut: 9:01`) the next time you load that file. Files are matched by their content, so the same job saved under another name is still recognised. From the second cut onwards you have a real prediction, measured on your own machine.

The progress percentage and line count are unchanged.

## Changed: a job now finishes when the machine does

FluidNC acknowledges a line as soon as it is queued, so the stream used to be reported "Complete" while the machine was still cutting the last buffered moves - seconds' worth on a file made of many small segments. A job is now complete only once the controller reports Idle, which is also when the timer stops. In practice the percentage can reach 100% a little before the end, and **Run** becomes available again only once the machine has actually stopped. If the machine alarms or the connection drops during that final stretch, the job ends as an error instead of being recorded as finished.

## Upgrading

This reaches an already-flashed Pi through the in-app **Update now** button (About page) - no new SD card image needed, since it's a frontend/backend-only change.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
