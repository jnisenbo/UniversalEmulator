# Arcadia

A console-style, controller-driven launcher for emulators on Apple Silicon Macs.
Arcadia doesn't contain an emulator. It finds your games, writes each emulator's
config, starts the emulator fullscreen as its own process, and comes back when the
game ends.

| Platform | Emulator | Formats |
|---|---|---|
| Wii, GameCube | Dolphin | `.iso` `.gcm` `.rvz` `.wia` `.wbfs` `.gcz` |
| Switch | Ryubing | `.nsp` `.xci` |
| Xbox 360 (experimental) | Xenia / XeniOS | `.iso` `.xex`, XBLA/GoD STFS packages |

Arcadia never downloads, bundles or fetches games, keys, firmware or BIOS files.
You supply them from your own hardware.

## Getting started

```sh
pnpm install
pnpm build:helper   # native Swift helper (Xcode command line tools required)
pnpm dev            # fullscreen; ARCADIA_WINDOWED=1 pnpm dev for a window
pnpm dev:web        # UI only, in a browser, with mock data
pnpm test           # header probes, config writers
pnpm dist           # Arcadia.app in dist/ (ad-hoc signed, arm64)
```

First run: **Settings → Emulators → Find installed emulators** (or choose each
`.app`), then **Settings → Library → Add a game folder**.

Controls: D-pad or left stick to move · bottom face button to select · right face
button to go back · L/R to switch between Library and Settings. On a keyboard:
arrows, Enter, Esc, Q/E. **To quit a game**, hold Home (or Create + Options) for one
second, or press ⌘⇧Esc.

## Architecture

```
src/shared     IPC contract, settings schema, types (no Node/DOM)
src/main       Electron main: library scan, emulator adapters, sessions, helper client
  library/probes   reads game IDs from file headers (no decompression, no external tools)
  emulators/       one adapter per emulator: detect · writeConfig · getLaunchArgs
  session/         spawn → running → exit, focus restore
  controller/      JSON-lines client for the Swift helper
src/preload    contextBridge: a typed `window.arcadia` with invoke/on only
src/renderer   React UI. One rAF loop drives gamepad input → springs → sound
native/        ArcadiaHelper (Swift): Bluetooth pairing, battery/light bar, quit gesture
```

**Adding an emulator** means writing an adapter in `src/main/emulators/<id>/`,
registering it in `registry.ts`, and adding a probe if the formats are new.

**Managed configs.** Each emulator runs with an Arcadia-owned config folder under
`~/Library/Application Support/Arcadia/emulators/<id>`. Your normal emulator setup
isn't modified.
- **Dolphin** (`-u`): Arcadia writes `Config/`. `GC`, `Wii`, `StateSaves`, `Load`
  and `ScreenShots` are symlinked to your normal Dolphin folder, so saves are shared.
- **Ryubing** (`-r`): every entry of your Ryubing data folder (keys, firmware, saves,
  mods) is symlinked. `Config.json` is a patched copy, rebuilt at each launch.
- **Xenia**: launch arguments come from an editable template. No config is written yet.

## macOS notes

- **Gatekeeper.** Emulators downloaded from the web are quarantined. If one isn't
  notarized, launching it from Arcadia can fail silently. Settings flags this.
  Open the emulator once from Finder, then use System Settings → Privacy & Security
  → **Open Anyway** (on macOS 15+ the right-click → Open bypass is gone).
- **Privacy prompts are charged to Arcadia.** Child processes inherit Arcadia as
  their "responsible process", so prompts for game folders in
  Documents/Downloads/Desktop, external drives or Bluetooth appear once, for Arcadia.
  In `pnpm dev` they're charged to your terminal or IDE instead.
- **No Space switching.** Arcadia uses `simpleFullScreen` (no separate Space) and
  stays behind the game. If an emulator uses native fullscreen and creates its own
  Space, quitting returns to Arcadia's.
- **Focus after exit.** macOS 14+ limits focus stealing. Arcadia activates itself,
  then falls back to `open <Arcadia.app>` through LaunchServices.
- **Home button.** macOS 15+ can send the DualSense Home button to Apple's Games
  app. Turn that off in System Settings → Game Controllers. Create + Options is the
  fallback quit gesture.
- **Ryubing** returns to its game list when a game stops instead of exiting, so use
  the quit gesture. Select your controller once in Ryubing's Input settings; Arcadia
  then keeps the mapping and dead zones in sync. The SDL controller ID can't be
  derived ahead of time.

## Status

Verified here: TypeScript build, unit tests for every header format and config
writer, and the UI driven in Chromium with mock data.

Not yet verified on a Mac (this was built without one):
- The Swift helper hasn't been compiled.
- Pairing, battery and the background quit gesture haven't been tried with a real
  DualSense.
- Dolphin's SDL device name for the DualSense (editable in Settings → Controller).
- Ryubing's config keys against a current build.
- XeniOS's command-line flags.
