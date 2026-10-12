# Arcadia

A console-style, controller-driven launcher for emulators on Apple Silicon Macs.
Arcadia doesn't contain an emulator. It finds your games, writes each emulator's
config, starts the emulator fullscreen as its own process, and comes back when the
game ends.

| Platform | Emulator | Formats | Arcadia can install it |
|---|---|---|---|
| Wii, GameCube | Dolphin | `.iso` `.gcm` `.rvz` `.wia` `.wbfs` `.gcz` | Yes |
| Switch | Ryubing | `.nsp` `.xci` | Yes |
| Xbox | xemu | `.iso` (XISO) | Yes |
| Xbox 360 (experimental) | Xenia / XeniOS | `.iso` `.xex`, XBLA/GoD packages | Link to the project page |

Arcadia downloads **emulators only**, from their official sources. It never
downloads, bundles or fetches games, keys, firmware or BIOS files: you supply those
from your own hardware.

## Getting started on your Mac

```sh
xcode-select --install   # once, for the Swift helper
pnpm install
pnpm build:helper        # native helper: Bluetooth pairing, Home button, battery
pnpm dev                 # fullscreen; ARCADIA_WINDOWED=1 pnpm dev for a window
```

Or download the `Arcadia-mac-arm64` artifact from the latest CI run on this branch.
It's a ready-built, ad-hoc-signed `Arcadia.app`. GitHub-downloaded files are
quarantined, so right-click → Open the first time (or run
`xattr -dr com.apple.quarantine Arcadia.app`).

First run, from the welcome checklist on the home screen:

1. **Install emulators.** Settings → Emulators → **Install all** downloads the latest
   Dolphin, Ryubing and xemu into `~/Applications` and selects them. Then open
   Ryubing once to install *your* keys and firmware, and xemu once to choose *your*
   BIOS, boot ROM and HDD image.
2. **Add game folders.** Settings → Library → Add a game folder.
3. **Connect the controller.** Settings → Controller → Pair a wireless controller.
   Start with the controller on a USB-C cable so you can navigate while it pairs.

Optional: Settings → Artwork → paste a free SteamGridDB API key for covers,
backgrounds and logos.

## Controls

| | Controller | Keyboard |
|---|---|---|
| Move | D-pad / left stick | Arrows |
| Select | Bottom face button | Enter |
| Back | Right face button | Esc |
| Library / Settings | L / R | Q / E |
| Game options (artwork, Finder) | Options | M |
| **In a game: menu (Resume / Quit)** | **Home**, or hold Create + Options | ⌘⇧Esc quits directly |

## Button layout (one layout for every emulator)

Settings → Controller → **Button layout**. Pick a position and press the button you
want there. Whatever was on that button moves to the old spot, so nothing is ever
left unmapped. There are also presets, e.g. *Swap face buttons* for Switch A on the
bottom button.

Each row shows what the position means on each console ("GC A · Switch B · Xbox A…").
On the next launch the layout is written into:
- **Dolphin:** `GCPadNew.ini` and `WiimoteNew.ini`.
- **Ryubing:** `Config.json` input mappings.
- **xemu:** `xemu.toml` controller mapping.

Arcadia's own menus follow it too.

Limits:
- **Xenia** has no remapping, so it keeps the standard Xbox layout.
- **Ryubing and xemu** store mappings per controller, keyed by an ID only they know.
  Select your controller once inside each emulator; Arcadia then keeps the mapping in
  sync.
- **xemu** can't put a digital button on a trigger or the other way round. Arcadia
  tells you if your layout asks for that.

## Architecture

```
src/shared     IPC contract, settings schema, controller layout model, types
src/main       Electron main process
  library/probes   reads game IDs from file headers (no decompression, no external tools)
  emulators/       one adapter per emulator: detect · writeConfig · getLaunchArgs
  install/         emulator downloads: source resolution, verification, install
  art/             SteamGridDB client + local cache, served via arcadia-art://
  session/         spawn → running → exit, focus restore, in-game menu window
  controller/      JSON-lines client for the Swift helper
src/preload    contextBridge: a typed `window.arcadia` with invoke/on only
src/renderer   React UI (and the in-game menu at #overlay). One rAF loop drives
               gamepad input → springs → sound
native/        ArcadiaHelper (Swift): Bluetooth pairing, battery/light bar, Home button
```

**Adding an emulator** means writing an adapter in `src/main/emulators/<id>/`
(mapping its buttons from the shared positions in `src/shared/controls.ts`),
registering it, adding a catalog entry in `src/main/install/catalog.ts`, and adding a
probe if the formats are new.

**Managed configs.** Each emulator runs with an Arcadia-owned config under
`~/Library/Application Support/Arcadia/emulators/<id>`. Your own emulator setup is
never modified.
- **Dolphin** (`-u`): Arcadia writes `Config/`. Saves, NAND and states are symlinked
  to your normal Dolphin folder.
- **Ryubing** (`-r`): every entry of your Ryubing folder (keys, firmware, saves, mods)
  is symlinked. `Config.json` is a patched copy, rebuilt at each launch.
- **xemu** (`-config_path`): a patched copy of your `xemu.toml`. Your BIOS and HDD
  paths are kept.

**Emulator downloads.**
- **Source:** the Homebrew cask API (official URL + SHA-256) first, then GitHub
  releases (asset SHA-256 digest).
- **Checks:** https only, a per-emulator host allowlist (checked again after
  redirects), the checksum, then `codesign --verify --deep --strict`.
- **Install:** with `ditto` into `~/Applications`, so no admin password is needed.
  Arcadia only replaces copies it installed itself.

## macOS notes

- **Gatekeeper.** Emulators Arcadia installs aren't quarantined: Arcadia verified the
  checksum and signature itself. Emulators you download in a browser are; if one
  isn't notarized, Settings explains how to allow it (System Settings → Privacy &
  Security → **Open Anyway**).
- **Privacy prompts are charged to Arcadia.** Emulators started from Arcadia count
  Arcadia as their "responsible process", so prompts for game folders in
  Documents/Downloads/Desktop, external drives or Bluetooth appear once, for Arcadia.
  In `pnpm dev` they're charged to your terminal or IDE instead.
- **No Space switching.** Arcadia uses `simpleFullScreen` (no separate Space) and
  stays behind the game. The in-game menu is a separate always-on-top window that can
  appear over native-fullscreen emulators.
- **Focus.** macOS 14+ limits focus stealing. Arcadia's menu tries to take focus;
  when macOS refuses, the helper drives the menu from the controller. Dolphin pauses
  while its window isn't focused.
- **Home button.** macOS 15+ can send the controller's Home button to Apple's Games
  app. Turn that off in System Settings → Game Controllers, or use Create + Options.
- **Original Xbox.** xemu needs XISO images. Full Redump dumps are flagged in the
  library; convert them with `extract-xiso -r`.

## Development

```sh
pnpm dev:web    # UI only, in a browser, with mock data
pnpm test       # probes, config writers, layouts, installer, artwork (41 tests)
pnpm typecheck
LIVE_SOURCES=1 pnpm exec vitest run test/live.test.ts                  # real release lookups
LIVE_SOURCES=1 LIVE_INSTALL=1 pnpm exec vitest run test/live.test.ts   # real installs (macOS)
pnpm dist       # dist/mac-arm64/Arcadia.app
```

CI (`.github/workflows/ci.yml`) runs the tests on Linux and macOS. On macOS it also
compiles and smoke-tests the Swift helper, runs the live install tests, and packages
`Arcadia.app`.

## Status

**Verified in CI on Apple Silicon (macOS 14):**
- TypeScript build and 43 unit tests.
- The Swift helper compiles, runs and answers commands.
- `Arcadia.app` packages and passes `codesign --verify --deep --strict`.
- **Dolphin** (2609a) and **xemu** (0.8.136) install end to end through Arcadia's
  installer: download, checksum, unpack, signature check, install. Gatekeeper
  reports both as *Notarized Developer ID*.
- **Ryubing**: install from its Forgejo releases (being verified; see the latest CI
  log, "Live emulator sources and installs").

**Needs your hands on a real Mac** (see [TESTING.md](TESTING.md)):
- Pairing and the Home-button menu with a real DualSense.
- Dolphin's SDL device name for the controller (editable in Settings → Controller).
- Each emulator actually honouring the written config keys.
- XeniOS's command-line flags.
