# Testing Arcadia on your Mac

A checklist for the first real run. Each step says what to look for and, if it
fails, where to look. Use `ARCADIA_WINDOWED=1 pnpm dev` to keep a window you can move
around, and watch the terminal for `[helper]` and `[art]` logs.

## 0. Build

```sh
xcode-select --install          # if you haven't
pnpm install
pnpm build:helper               # → native/build/arcadia-helper
pnpm test                       # expect: all passed, 6 skipped (live tests)
ARCADIA_WINDOWED=1 pnpm dev
```

## 1. Setup flow (no controller needed yet)

- [ ] The home screen shows **Welcome to Arcadia** with three steps.
- [ ] Settings → Emulators → **Install all**: Dolphin, Ryubing and xemu download with
      progress and end as *Installed*. They appear in `~/Applications`.
      - Already verified by CI: the Dolphin and xemu installs work and both apps are
        notarized.
      - Ryubing's server blocked GitHub's runners, so it's unverified. If it fails,
        the error shows why (e.g. `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`).
        Download Ryubing from ryujinx.app in your browser, then on Ryubing's row
        choose **Install from a downloaded file…** and pick the `.tar.gz`.
- [ ] Open Ryubing from its menu → install your keys and firmware → quit it.
- [ ] Open xemu from its menu → set your BIOS, MCPX and HDD image → quit it.
- [ ] Back in Arcadia, the issues under each emulator disappear (re-open Settings).

## 2. Library

- [ ] Add a games folder. Wii/GameCube titles show their real names; Switch titles
      show title IDs (names come from the filename or from artwork).
- [ ] If you have Redump-format Xbox ISOs, they show the *needs XISO* note.

## 3. Controller

- [ ] Plug the DualSense in with USB-C. It navigates immediately.
- [ ] Settings → Controller → Pair a wireless controller → Start pairing → hold
      **Create + Home**. Expect *Searching… → Pairing… → Connected*.
      - The first time, macOS asks for **Bluetooth** permission for Arcadia
        (in dev: for your terminal or IDE). Allow it.
      - If it times out: System Settings → Bluetooth should list the controller,
        and the wizard's *Use System Settings instead* route still works.
      - The wizard always searches for a controller in pairing mode, so it also
        pairs a second controller. A controller you paired before reconnects on
        its own when you press Home; no wizard needed.
- [ ] Unplug: it keeps working, the battery shows in the top bar, and the light bar
      color in Settings changes the controller's light.
- [ ] Calibrate and test: both sticks draw, triggers fill, buttons light up, and
      *Test vibration* rumbles. (Rumble over Chromium may not work on macOS; that
      only affects this test button.)

## 4. Button layout

- [ ] Settings → Controller → Button layout → choose *Swap face buttons*. Arcadia's
      own confirm/back swap immediately.
- [ ] Select *Bottom button*, then press **L**: they swap, and the row shows → L.
- [ ] Reset to default.

## 5. Playing

Do each with one game per emulator.

- [ ] **Dolphin**: launches fullscreen. Buttons follow your layout. If the controller
      does nothing, open Dolphin → Controllers → Configure, note the device name
      shown (e.g. `SDL/0/PS5 Controller`), and enter it in Settings → Controller →
      Dolphin device name.
- [ ] **Ryubing**: the first time, open it from Settings → Emulators → Ryubing →
      Open Ryubing (not by launching a game), select the controller in Options →
      Settings → Input, save and quit. From then on, Arcadia applies your layout.
- [ ] **xemu**: same: open it from Settings → Emulators → xemu → Open xemu, open
      Input once with the controller connected, then quit.
- [ ] After a game starts, Arcadia's window hides (after ~2 s).

## 6. In-game menu (Home button)

- [ ] Press **Home** during a game: the menu appears over the game, and Dolphin
      pauses.
      - If Apple's Games app opens instead: System Settings → Game Controllers →
        DualSense → Home button → turn off the Games app. Or hold **Create + Options**.
      - The menu should respond to the D-pad and face buttons even if macOS kept
        focus on the emulator (the helper forwards them).
- [ ] **Resume** returns to the game with focus. **Quit game** needs two presses, then
      Arcadia comes back on the same tile.
- [ ] ⌘⇧Esc quits a game directly from the keyboard.

## 7. Artwork

- [ ] Settings → Artwork → paste your SteamGridDB key. Covers, backgrounds and logos
      appear over the next minute.
- [ ] On a wrong match: press **Options** on the game → Choose artwork… → pick the
      right one.

## Reporting back

Most useful to send:
- The terminal output.
- Which checklist items failed.
- For controller-mapping problems: the emulator's own device name and the
  generated config in `~/Library/Application Support/Arcadia/emulators/<id>/`.
