# SWARM Messenger desktop releases

Last updated 2026-09-27 (M4, Opus M4).

What each desktop installer is, how it is built, where its hash is, what is
and is not signed, and the exact steps to install and start it on each system.
The build itself is `.github/workflows/swarm-build.yml`; every change it
depends on is listed in [`SWARM-CHANGES.md`](SWARM-CHANGES.md).

## When a release appears

Every push to `swarm-main` runs the **SWARM build** workflow. When all of its
jobs pass - lint and tests included - the `release` job publishes **one GitHub
pre-release** in `Swarm-Official/swarm-messenger`:

| Field    | Value                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Tag      | `swarm-messenger-desktop-<yyyymmdd>-<shortsha>`, created on that commit |
| Name     | `SWARM Messenger desktop (<version>, <shortsha>)`                       |
| Files    | the five installers below and `SHA256SUMS.txt`                          |
| Body     | unsigned warning, install notes per system, every file's SHA-256        |
| Pre-rel. | always; it is never marked "latest"                                     |

`<yyyymmdd>` is the commit's date in UTC and `<shortsha>` the first seven
characters of the commit, so running the workflow again for the same commit
updates the same release. `<version>` is `version` in `package.json`.

Pull requests and manual runs (`gh workflow run swarm-build.yml --ref <branch>`)
build, check and hash everything and **publish nothing**. Their files are the
run's artifacts, kept 30 days: `installer-windows-x64`, `installer-linux-x64`,
`installer-mac-arm64`, and `release-sha256sums` (`SHA256SUMS.txt` plus the
release text).

Nothing is published anywhere else: not to `swarm-releases`, not to the
website, not to users. SWARM Messenger has no update feed and never updates
itself (`updatesEnabled` is `false`), so a new version is installed by hand.

## The files

`<version>` is `0.1.4` since 2026-10-03 (`0.1.3` on 2026-09-30, `0.1.2` on 2026-09-29, `0.1.1` on 2026-09-29, `0.1.0` on 2026-09-28, the fork base's `8.31.0-alpha.1` before that).

| File                                        | System                         | What it is                                                                                                                                                        |
| ------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swarm-messenger-win-x64-<version>.exe`     | Windows 10 or 11, x64          | One-click NSIS installer. Installs for the current user only, no administrator prompt, then starts the app.                                                       |
| `swarm-messenger_<version>_amd64.deb`       | Debian 12+, Ubuntu 22.04+, x64 | Debian package: the app in `/opt/SWARM Messenger/`, the `swarm-messenger` command, a menu entry, an AppArmor profile (Ubuntu 24.04+) and SWARM's polkit policies. |
| `swarm-messenger_<version>_x86_64.AppImage` | other Linux distributions, x64 | The same app as one self-contained file; nothing is installed.                                                                                                    |
| `swarm-messenger-mac-arm64-<version>.dmg`   | macOS on Apple Silicon         | Disk image holding `SWARM Messenger.app`; drag it to Applications.                                                                                                |
| `swarm-messenger-mac-arm64-<version>.zip`   | macOS on Apple Silicon         | The same `SWARM Messenger.app`, zipped.                                                                                                                           |
| `SHA256SUMS.txt`                            | all                            | SHA-256 of the five files above, in `sha256sum` format.                                                                                                           |

There is **no Intel Mac build**: the SWARM build of libsignal
(`vendor/signalapp-libsignal-client-0.101.2-swarm.*.tgz`) carries a macOS
library for arm64 only, so an x64 or universal app would not start. There is
no Windows or Linux arm64 build for the same reason. Since 0.1.4 the wallet
addon is published for Intel Macs too (`darwin-x64` in
`vendor/swarm-wallet-core-native.json`); the missing piece is a `darwin-x64`
prebuild of the SWARM libsignal (`louisinthesubway/swarm-libsignal`), after
which `build.mac.target` gains `x64` and CI a second Mac job.

The .deb needs glibc 2.34 or newer (`libc6 (>= 2.34)`), which is Ubuntu 22.04,
Debian 12 or later. The Mac app needs macOS 13 (Ventura) or later: its
`LSMinimumSystemVersion` is `13.0` (read from the built app in CI run
36346185304).

**Every installer contains the SWARM wallet's Rust addon** for its platform,
`vendor/swarm-wallet-native/native-<platform>-<arch>.node` (about 80 MB, in
`app.asar.unpacked`), which the Wallet pane runs on. It is not in git: the
build fetches it from the `swarm-wallet-core` release with
`scripts/swarm-fetch-wallet-addon.mjs` and refuses it unless its size and
SHA-256 are the ones pinned in `vendor/swarm-wallet-core-native.json`
(swarm-wallet-core 0.3.0 since 0.1.4: `win32-x64` `72e9b946…`, `linux-x64`
`beafca69…`, `darwin-arm64` `1853bc50…`, and `darwin-x64` `18a95b3d…` not yet
used). An installer built without it still chats, and
its Wallet pane says the wallet component is missing. On macOS the ad-hoc
signature is written into the addon too, so the copy inside the Mac app no
longer hashes to the pinned value; CI checks that it still loads.

## How each file is built

All five come from one run of `.github/workflows/swarm-build.yml` on GitHub's
standard runners. Each installer job installs with `pnpm install
--frozen-lockfile` - **without** `SWARM_ALLOW_MISSING_NATIVE`, so a native
module that fails to build fails the release - runs `pnpm run generate`,
fetches the pinned wallet addon, then `pnpm run build:release
--publish=never`, which is electron-builder with the
`build` section of `package.json`. Then `scripts/swarm-brand-check.mjs` unpacks
the packaged app and fails on any Signal domain or Signal wording.

| Job                 | Runner           | Also runs                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installer-windows` | `windows-latest` | the SWARM endpoint and guard tests (`pnpm run test-node:swarm`)                                                                                                                                                                                                                                                                                                                                                                     |
| `installer-linux`   | `ubuntu-latest`  | a check of what the brand check cannot see (the .deb's control fields and desktop entry must not mention Signal, its maintainer scripts must use the `green.swarm.*` polkit policies); then `sudo apt install` of the .deb, a start of the installed app with its sandbox that must open the main window within 120 seconds, a check that its wallet addon is the pinned file and loads, `apt remove`; then a start of the AppImage |
| `installer-mac`     | `macos-latest`   | `scripts/swarm-prepare-unsigned-mac-build.mjs` first (see "Signing" below), the SWARM tests, then `codesign --verify --deep --strict` on the app, a start of the packaged app that must open its main window within 120 seconds, a check that its wallet addon loads, and the same signature check on the app inside the mounted .dmg and the unpacked .zip                                                                         |
| `release`           | `ubuntu-latest`  | waits for the three installer jobs **and** `lint-and-test`, downloads the installers, checks there is exactly one of each kind, writes `SHA256SUMS.txt` and the release text (`scripts/swarm-release-notes.mjs`), and on a push to `swarm-main` publishes the pre-release                                                                                                                                                           |

A release build cannot be made on the Windows workstation: it has no Visual
Studio, so the Windows Hello addon cannot be compiled there (see
`SWARM-CHANGES.md` section 1). CI is the release path.

## Where the hashes are

- the release body lists every file's SHA-256;
- `SHA256SUMS.txt` is attached to the release, and is the `release-sha256sums`
  artifact of a pull-request or manual run;
- each installer job prints the SHA-256 of the files it built, so the release
  job's list can be compared with the job that made each file.

To hash a downloaded file:

| System  | Command                                                |
| ------- | ------------------------------------------------------ |
| Windows | `Get-FileHash .\<file> -Algorithm SHA256` (PowerShell) |
| Linux   | `sha256sum <file>`                                     |
| macOS   | `shasum -a 256 <file>`                                 |

The result must equal the line for that file in `SHA256SUMS.txt`.

## Signing: nothing is signed yet

| System  | State                                                                                                                                                                                        | What the user sees                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Windows | Not signed. There is no code-signing certificate; `scripts/sign-windows.mjs` returns without one.                                                                                            | SmartScreen: "Windows protected your PC".                                                         |
| Linux   | Not signed. A local .deb installed with `apt` is not signature-checked anyway.                                                                                                               | apt may print a note that the download was "performed unsandboxed as root"; that is harmless.     |
| macOS   | Ad-hoc signature only (`codesign` identity `-`): no Developer ID, not notarized, hardened runtime off. Apple Silicon refuses code without any signature, so ad hoc is the minimum that runs. | Gatekeeper refuses to open it ("damaged" or "cannot be checked") until the quarantine is removed. |

For macOS, `package.json` keeps the configuration a signed build needs
(`hardenedRuntime`, the entitlements, the `sign` hook). The CI job changes three
keys in its own copy only, with `scripts/swarm-prepare-unsigned-mac-build.mjs`:
it removes `build.mac.sign` (that hook hands the app to Signal's own signing
script, `SIGN_MACOS_SCRIPT`, which SWARM does not have), sets
`build.mac.identity` to `-` (ad hoc), and sets `build.mac.hardenedRuntime` to
`false` (library validation under the hardened runtime needs a Team ID, which an
ad-hoc signature does not have).

**Proposed, not done:** Mac signing and notarization later, on the owner's Mac,
once the organisation's Apple Developer membership exists. Outline: a
_Developer ID Application_ certificate in that Mac's login keychain; build there
without the prepare script; replace the `sign` hook in `package.json` with
electron-builder's own signing (remove `build.mac.sign`, set
`build.mac.identity` to the certificate's name) or with a SWARM
`SIGN_MACOS_SCRIPT`; notarize with `APPLE_USERNAME`, `APPLE_PASSWORD` (an
app-specific password) and `APPLE_TEAM_ID` set, which `scripts/notarize.mjs`
already reads. None of this has been tried. Windows signing needs a
code-signing certificate and is not planned yet.

## Install and start, step by step

Download from the release page: the file for your system and
`SHA256SUMS.txt`. Hash the file (table above) and compare before running it.

### Windows 10 or 11 (x64)

1. Double-click `swarm-messenger-win-x64-<version>.exe`.
2. If SmartScreen says "Windows protected your PC": click **More info**, then
   **Run anyway**.
3. The installer needs no administrator rights. It installs to
   `%LOCALAPPDATA%\Programs\swarm-messenger`, adds **SWARM Messenger** to the
   Start menu and the desktop, and starts the app.
4. The first screen shows a device-link code and, under it, **Create account
   on this computer**. Click that: the next screen is **Your SWARM wallet**,
   with **Create a wallet** and **Restore a wallet** (from its 24 words).

Later starts: Start menu or desktop, **SWARM Messenger**.

Uninstall: Settings, Apps, Installed apps, **SWARM Messenger**, Uninstall - or
run `%LOCALAPPDATA%\Programs\swarm-messenger\Uninstall SWARM Messenger.exe`.
Uninstalling also deletes the app's data folder, `%APPDATA%\SWARM Messenger`
(upstream's `nsis.deleteAppDataOnUninstall`), and with it the message history
on this computer; your 24 words restore the account, not the messages.

### Linux, Debian or Ubuntu (x64) - the .deb

1. In a terminal, in the folder with the download:
   `sudo apt install ./swarm-messenger_<version>_amd64.deb`
   (the `./` matters: it tells apt this is a file, not a package name).
2. Start **SWARM Messenger** from the application menu, or run
   `swarm-messenger`.

Uninstall: `sudo apt remove swarm-messenger`. The app's data stays in
`~/.config/SWARM Messenger` until you delete it.

### Linux, any distribution (x64) - the AppImage

1. `chmod +x swarm-messenger_<version>_x86_64.AppImage`
2. `./swarm-messenger_<version>_x86_64.AppImage`

It needs FUSE 2: `sudo apt install libfuse2` on Ubuntu 22.04,
`libfuse2t64` on 24.04. Ubuntu 24.04 and later also restrict the user
namespaces Electron's sandbox uses; the .deb installs an AppArmor profile that
allows them, an AppImage cannot. If the AppImage exits with a message about the
"SUID sandbox helper", use the .deb on that system.

### macOS on Apple Silicon

1. Open `swarm-messenger-mac-arm64-<version>.dmg` and drag **SWARM Messenger**
   onto **Applications**. Eject the disk image.
2. Open Terminal and run, once:
   `xattr -dr com.apple.quarantine "/Applications/SWARM Messenger.app"`
   This removes the "downloaded from the internet" flag that makes Gatekeeper
   refuse an app that is not notarized.
3. Open **SWARM Messenger** from Applications or Launchpad.

The .zip holds the same app: double-click it, move `SWARM Messenger.app` to
Applications, then steps 2 and 3.

Uninstall: move the app to the Bin. The app's data stays in
`~/Library/Application Support/SWARM Messenger` until you delete it.

## Where the app keeps its data

| System          | Folder                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Windows         | `%APPDATA%\SWARM Messenger`                                                                                        |
| Linux, .deb     | `~/.config/SWARM Messenger`                                                                                        |
| Linux, AppImage | `~/.config/SWARM Messenger AppImage` (kept apart from the .deb's on purpose, upstream's `app/user_config.main.ts`) |
| macOS           | `~/Library/Application Support/SWARM Messenger`                                                                    |

That folder holds the encrypted message database, the account's keys and the
logs (`logs/main.log`). Deleting it while the app is closed starts the app from
scratch.

## What has been tried so far

As of 2026-09-27 (M4). "CI" means every run of the workflow does it again; the
results quoted are from run 36356943379.

| What                                                                                                                                               | Where                                                                                   | Result                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows installer: SHA-256 against `SHA256SUMS.txt`, silent per-user install, first start                                                          | the SWARM workstation, Windows 11, build from run 36346185304 (before the wallet addon) | Installed to `%LOCALAPPDATA%\Programs\swarm-messenger`; connected to the chat server; showed the link screen, then **Your SWARM wallet**. No account made.                                                                                                           |
| Windows installer with the wallet addon: SHA-256, per-user install over the first one, first start, Wallet pane                                    | the SWARM workstation, build from run 36356943379                                       | The installed addon is the pinned file (`ba1117d2…`); the wallet service started on mainnet; the Wallet pane (opened on the unregistered test install through the app's DevTools port) shows **Open your wallet**, not the missing-component message. Nothing typed. |
| .deb: `sudo apt install ./<file>.deb`, start of the installed app with its sandbox, wallet addon checks, `apt remove`                              | CI, `ubuntu-latest` (Ubuntu 24.04)                                                      | Policies and AppArmor profile installed; main window opened; the addon in the package is the pinned file and loads; policies removed again                                                                                                                           |
| AppImage: start, extracted, with its sandbox                                                                                                       | CI, `ubuntu-latest`                                                                     | Main window opened                                                                                                                                                                                                                                                   |
| Mac app: `codesign --verify --deep --strict`, start of the packaged app, wallet addon loads; the app inside the mounted .dmg and the unpacked .zip | CI, `macos-latest` (Apple Silicon)                                                      | Ad-hoc signature valid, arm64, main window opened, addon signature valid and loads                                                                                                                                                                                   |

Not tried yet: the .dmg or .zip on a real Mac with Gatekeeper and the
quarantine flag (the `xattr` step is untested), the .deb on a desktop Ubuntu
or Debian with a real session, the AppImage with FUSE instead of extracted,
Windows SmartScreen on a downloaded copy (the tested copy came from the
artifact through `curl`, which sets no download mark), and opening or using a
wallet in any installed build.
