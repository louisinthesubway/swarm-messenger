# SWARM Messenger — every change from upstream Signal Desktop

Upstream base: `abe80d32445e53b047b42d10c5b751c4fbfbbfc0` = `v8.31.0-alpha.1`,
preserved on branch `upstream-main` and tag `upstream-abe80d3` in
`Swarm-Official/swarm-messenger`. Work happens on `swarm-main`, so every change
below is `git diff upstream-abe80d3..swarm-main`.

Milestone M1, 2026-09-26, Opus M-A.

**Nothing cryptographic was changed.** `@signalapp/libsignal-client` 0.101.2 is the
unmodified npm package. No primitive, key schedule or wire format was touched.

---

## 1. Making the tree build on a Windows box without Visual Studio

The build workstation has no Visual Studio and cannot get one (system drive full),
and `node-gyp` refuses to configure without it. Three of the four failures were
for work that does not need to happen on Windows at all.

| File                                                                                                    | Change                                                                                                                    | Why                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/mute-state-change/scripts/swarm-install.mjs` (new), `packages/mute-state-change/package.json` | An `install` script that runs `node-gyp` only on macOS.                                                                   | The addon is macOS-only. Its `binding.gyp` declares an empty `noop` target elsewhere, but node-gyp's _configure_ step still demanded MSVC — for a target that compiles nothing. |
| `packages/windows-ucv/scripts/swarm-install.mjs` (new), `packages/windows-ucv/package.json`             | An `install` script that reports a failed native build loudly and continues **only** when `SWARM_ALLOW_MISSING_NATIVE=1`. | Windows Hello re-authentication genuinely needs MSVC. CI never sets the variable, so a release build still fails if the addon cannot be built.                                  |
| `packages/windows-ucv/index.ts`                                                                         | `loadBinding()` wrapped in try/catch; new `isAvailable()` and `getLoadError()`.                                           | Upstream threw at _import_ time when the `.node` file was missing, which killed the main process.                                                                               |
| `ts/util/os/promptOSAuthMain.main.ts`                                                                   | `checkAvailability()` wrapped in try/catch → returns `'unsupported'`.                                                     | Same outcome as a PC with no Windows Hello device, instead of an unhandled rejection.                                                                                           |
| `scripts/swarm-install-app-deps.mjs` (new), `package.json` (`electron:install-app-deps`)                | Wrapper around `electron-builder install-app-deps` with the same `SWARM_ALLOW_MISSING_NATIVE=1` escape hatch.             | `@electron/rebuild` invokes node-gyp directly, bypassing the package `install` scripts above.                                                                                   |

Every native dependency that actually ships uses a prebuilt binary:
`@signalapp/libsignal-client` 0.101.2, `@signalapp/sqlcipher` 4.1.0 (node-gyp-build),
`@signalapp/ringrtc` 2.72.0 (downloads a prebuild),
`@indutny/simple-windows-notifications`. None of them needed a compiler.

## 2. Endpoints — never Signal, only SWARM

| File                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config/swarm-staging.json` (new)                                                                                                                    | The canonical SWARM endpoint set, and the four server-generated values as clearly labelled `SWARM-PLACEHOLDER-*` strings.                                                                                                                                                                                          |
| `config/default.json`                                                                                                                                | Rewritten. Every Signal staging endpoint replaced; Signal's zk parameters, trust roots, pinned CA, update feed, update signing keys and Stripe test key removed.                                                                                                                                                   |
| `config/production.json`                                                                                                                             | Rewritten the same way (this is the file a packaged app uses).                                                                                                                                                                                                                                                     |
| `ts/types/RendererConfig.std.ts`                                                                                                                     | `certificateAuthority` and `stripePublishableKey` made optional.                                                                                                                                                                                                                                                   |
| `app/main.main.ts`                                                                                                                                   | Reads those two with `config.has()` so an absent key means "use the system CA store" / "no donations".                                                                                                                                                                                                             |
| `ts/util/createHTTPSAgent.node.ts`                                                                                                                   | `HOST_LOG_ALLOWLIST` is now the SWARM hosts.                                                                                                                                                                                                                                                                       |
| `ts/services/networkObserver.preload.ts`                                                                                                             | Outage DNS probe moved from `uptime.signal.org` to `uptime.swarm.green`.                                                                                                                                                                                                                                           |
| `scripts/generate-dns-fallback.mjs`, `build/dns-fallback.json`                                                                                       | Domain list is the SWARM hosts; the shipped fallback file is now `[]`. It previously shipped Signal's hard-coded IP addresses, which the app would have used if DNS failed. Regenerate once the SWARM hosts resolve.                                                                                               |
| `app/updateDefaultSession.main.ts`                                                                                                                   | Spellchecker dictionary host moved off `updates.signal.org`. Dictionaries will not download until someone mirrors them — open item.                                                                                                                                                                                |
| `patches/node-fetch@3.3.2.patch`                                                                                                                     | Upstream patched node-fetch to keep the `Authorization` header across a redirect between `*.voip.signal.org` hosts. That string was the last Signal domain left in the shipped bundle. It is now `*.chat.swarm.green`, which is the same behaviour for our own hosts. `pnpm-lock.yaml` carries the new patch hash. |
| `ts/types/support.std.ts`, `ts/util/createSupportUrl.std.ts`, `ts/util/contactSupport.dom.tsx`, `app/main.main.ts` (`openForums`) and ~30 components | All Signal support / download / community URLs now point at `https://swarm.green/support`.                                                                                                                                                                                                                         |

See [`SWARM-CONFIG.md`](SWARM-CONFIG.md) for the endpoint table, the placeholder
procedure and the libsignal-net limitation.

### 2a. The libsignal-net finding

`ts/textsecure/preconnect.preload.ts` — `resolveLibsignalNet()` previously fell
through to `Net.Environment.Production` for any hostname it did not recognise.
`libsignal-client` 0.101.2 offers only Signal staging, Signal production and a
loopback test server, so a SWARM hostname would have sent chat and registration
traffic to **Signal's production servers**. It now refuses, with a message saying
what has to change. `getLibsignalNet()` returns a throwing proxy in that case so
the app still starts and shows its window — the refusal surfaces when something
actually touches the network. `SWARM-CONFIG.md` names the one place to change when
Opus M-D's SWARM environment lands.

### 2b. Startup guard

`app/swarmStartupGuard.main.ts` (new), called from `app.on('ready')` in
`app/main.main.ts` before any window opens:

- any configured endpoint on a Signal host → dialog + exit, **no override**;
- any `SWARM-PLACEHOLDER-*` value still present → dialog + exit, overridable with
  `SWARM_ALLOW_PLACEHOLDER_CONFIG=1` on an **unpackaged** tree only, so no
  installer can bypass it.

The decision logic is pure functions in `ts/util/swarm/endpointGuard.std.ts`,
tested in `ts/test-node/swarm/endpointGuard_test.node.ts`.

### 2c. The scan test

`ts/test-node/swarm/noSignalEndpoints_test.node.ts` walks `config/`, `ts/` and
`app/` and fails on `signal.org`, `signalcaptchas.org` or `whispersystems` outside:
licence headers, the AGPL attribution, the endpoint guard (which lists Signal's
domains so it can refuse them), and `ts/util/signalRoutes.std.ts` (see §7). It runs
as part of `pnpm run test-node`.

## 3. Standalone (phone-number) registration reachable

Phase 1 of the plan keeps phone-number identity exactly as upstream. What changed
is that it is reachable in a SWARM build, not only under `NODE_ENV=development`.

| File                                                                    | Change                                                                                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/state/ducks/app.preload.ts`                                         | `openStandalone()` no longer refuses in packaged builds. Added `useAppActions()`.                                                                                |
| `app/menu.std.ts`                                                       | "Create account on this computer" is always in the File menu, not only in development.                                                                           |
| `ts/components/installScreen/InstallScreenQrCodeNotScannedStep.dom.tsx` | A "Create account on this computer" button next to the linking QR code — the first-run choice. New prop `openStandalone`.                                        |
| `ts/components/installScreen/InstallScreenErrorStep.dom.tsx`            | The same button on the error screen. With no server reachable, "Something went wrong" is the **first** thing a new user sees, so the choice has to be there too. |
| `ts/state/smart/InstallScreen.preload.tsx`                              | Wires that prop.                                                                                                                                                 |

### Captcha — what upstream actually does

The brief said upstream already handles a server that asks for no captcha. **It
does not.** `ts/textsecure/WebAPI.preload.ts` `createVerificationSession()` threw
`'Expected captcha requirement'` when the server did not request a captcha, and the
registration flow always went `PHONE_NUMBER → CAPTCHA → VERIFICATION_CODE`.

Changed:

- `createVerificationSession()` now returns `{ sessionId, captchaRequired }`
  instead of throwing.
- `ts/state/ducks/standaloneInstaller.preload.ts` `moveToCaptchaStage()` skips
  straight to the verification code when `captchaRequired` is false. The shared
  tail of both paths was extracted into `proceedToVerificationCode()`, so the
  captcha and no-captcha routes request the code identically.

The challenge URLs point at `https://chat.swarm.green/challenge/...`, so the
captcha step works if the SWARM server does serve one.

## 3a. Wallet sign-in: registration without a telephone number

Added 2026-09-27 on the owner's decision, _"instead of a phone number make the
users sign in with our wallet."_ Registration now starts at a wallet - create one,
or restore one from its 24 words - and the phone number, captcha and
verification-code stages of section 3 are left in place but never reached.

`docs/WALLET-SIGN-IN.md` is the full account: the derivation, the protocol, what
the phrase is allowed to touch, what is proven and what is not. In short:

| File                                                                | Change                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/util/swarm/bip39.node.ts`, `ts/util/swarm/bip39Wordlist.std.ts` | new. BIP-39 as specified, over the specification's own wordlist (its SHA-256 is checked by a test).                                                                                                                 |
| `ts/util/swarm/walletIdentity.node.ts`                              | new. The ACI and PNI identity key pairs from the BIP-39 seed (libsignal's own HKDF), the synthetic `+888` account identifier, and the challenge signature.                                                          |
| `ts/components/standaloneRegistration/stages/WalletSignIn.dom.tsx`  | new. The one screen: choose, write the words down, or restore.                                                                                                                                                      |
| `ts/types/StandaloneRegistration.std.ts`                            | the `WALLET_SIGN_IN` stage; `PROFILE_ENTRY` may now complete registration, because there is no PIN.                                                                                                                 |
| `ts/state/ducks/standaloneInstaller.preload.ts`                     | `startRegistration` starts at the wallet stage; `createWalletForSignIn`, `enterRecoveryPhrase`, `backToWalletChoice`, `signInWithWallet`; the PIN stages are skipped for a SWARM account.                           |
| `ts/textsecure/WebAPI.preload.ts`                                   | `POST /v1/swarm/registration/challenge` and `/verify`; `createAccount` takes a verified session **or** a registration password, and without a session uses libsignal's own `RegistrationService.reregisterAccount`. |
| `ts/textsecure/AccountManager.preload.ts`                           | `registerAsPrimaryDevice` accepts the derived identity key pairs instead of always generating random ones.                                                                                                          |
| `_locales/en/messages.json`                                         | 19 strings under `icu:StandaloneRegistration--WalletSignIn--`.                                                                                                                                                      |

No change to libsignal, to the protocol, or to any cryptographic primitive: the
checksum and the seed are Node's, the HKDF and the signature are libsignal's. The
server half is in `Swarm-Official/swarm-messenger-server`, `docs/WALLET-SIGN-IN.md`.

## 3b. Usernames: the three writes went over REST (superseded)

**Superseded the same day by 3c** (Opus M-H): with libsignal `0.101.2-swarm.2` the
SWARM environment has the HTTP/2 connection these calls need, so
`reserveUsername`, `deleteUsername` and `replaceUsernameLink` in
`ts/textsecure/WebAPI.preload.ts` and the error mapping in
`ts/services/username.preload.ts` are upstream's code again (libsignal's gRPC
`reserveUsernameHash` / `deleteUsernameHash` / `setUsernameLink`), as the
workaround's own comment asked. The record of the workaround follows.

Added 2026-09-27 (Opus M-G), found by the first desktop-to-desktop test on
`chat.swarm.green`. A SWARM account has no dialable number and there is no
contact discovery (CDSI) service, so a username is the only way one person can
find another in the app. Taking one did not work: libsignal 0.101 sends
`reserveUsernameHash`, `deleteUsernameHash` and `setUsernameLink` **only** as gRPC
over an HTTP/2 connection shared with the chat websocket, the SWARM environment
reaches `chat.swarm.green` over HTTP/1.1 because the server offers no gRPC, and
libsignal panicked with `requires an H2 connection`.

| File                              | Change                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/textsecure/WebAPI.preload.ts` | `reserveUsername`, `deleteUsername` and `replaceUsernameLink` call the server's REST endpoints (`PUT v1/accounts/username_hash/reserve`, `DELETE v1/accounts/username_hash`, `PUT v1/accounts/username_link`) through `_ajax`, over the same authenticated websocket as every other call. `confirmUsername` was already REST. |
| `ts/services/username.preload.ts` | a reservation's HTTP 409 / 413 / 429 / 422 map to the screen's existing "taken", "too many attempts" and "unprocessable" results.                                                                                                                                                                                             |

The lookups (`lookUpUsernameHash`, `lookUpUsernameLink`) already travel over the
websocket and are unchanged. Proven in the app: B took `swarmtestb.19`
(`reserve` 200, `confirm` 200), A typed it under _New chat_, _Find by username_
answered (`GET v1/accounts/username_hash/…` 200) and the message that followed
was delivered. Other libsignal calls that are gRPC-only and so still fail on
SWARM: `getDevices`, `setDeviceName` (linked devices) and the phone-number
discoverability switch. Go back to the libsignal calls once the SWARM server
offers gRPC and the SWARM environment in libsignal is switched to HTTP/2.

## 3c. libsignal 0.101.2-swarm.2: the HTTP/2 chat connection

Added 2026-09-27 (Opus M-H). `vendor/signalapp-libsignal-client-0.101.2-swarm.2.tgz`
(sha256 `3711e83fe42b991380bbb769e5afa7970708a8e9db9fde97634a54ce62ef1565`, release
`swarm-libsignal-0.101.2-swarm.2`, run 36342119193 at swarm-libsignal `dd6456489`)
replaces `swarm.1`; `package.json`, `pnpm-workspace.yaml` (`allowBuilds`),
`pnpm-lock.yaml` and `vendor/SHA256SUMS.txt` follow. The only change in the library:
`Environment.Swarm` dials `chat.swarm.green` over HTTP/2 (ALPN `h2`, TLS 1.3, the
`x-signal-timestamp` confirmation header), so libsignal's gRPC-only calls - username
writes, username links, device name, linked devices, discoverability - have the
connection they need. The protocol crates are unchanged. See `docs/SWARM-CONFIG.md`.

## 3d. `genericServerPublicParams` is the calling set

Added 2026-09-27 (Opus M-H). The desktop verifies call-link credentials with
`genericServerPublicParams`; the server signs them with `callingZkConfig`. The
config carried the chat set (`chatZkConfig`, which pairs with
`backupServerPublicParams`), so `groupCredentialFetcher` looped on
`Verification failure in zkgroup` in `CallLinkAuthCredentialResponse.receive`, and
since call-link and group auth credentials come in one response, groups could not
be created. `config/default.json`, `config/production.json` and
`config/swarm-staging.json` now carry the calling set (`AMzkIq08…`), from the
corrected `shared/staging-public-params.json` (server fix `23a524ce1`). No server
secret changed and no account is affected. The comment in
`scripts/swarm-import-params.mjs` and `docs/SWARM-CONFIG.md` say which field pairs
with which server set; `endpointGuard_test.node.ts` checks the two generic sets are
distinct, decode, and agree across the three files.

## 4. Rebrand

| Area             | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product identity | `package.json`: `name` `swarm-messenger`, `productName` `SWARM Messenger`, author SWARM, `build.appId` `green.swarm.messenger`, Linux `executableName`/`StartupWMClass` `swarm-messenger`. `app/startup_config.main.ts`: Windows AUMID `green.swarm.messenger`.                                                                                                                                                                                                                                                                                                                                                                                    |
| Strings          | `_locales/en/messages.json`, swept by `scripts/swarm-rebrand-locale.mjs` (200 strings). The script is idempotent and re-runnable after an upstream merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| About window     | `ts/components/About.dom.tsx`: swarm.green links, and the AGPL attribution via the new `icu:SwarmAbout__attribution`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Icons            | `build/icons/win/icon.ico`, `build/icons/png/*` from `D:\privacy\brand\swarm-mark\dist`. Window/tray icons: `images/swarm-mark.svg`, `images/swarm-lockup.svg`, `images/swarm-lockup-with-text.svg`, `images/swarm-logo-desktop-linux.png`, `images/swarm-login.svg`, `images/swarm-heart.svg`, `images/app-icon-with-error.png`, and `images/tray-icons/**` regenerated as `swarm-tray-icon-*` by `pnpm run build:tray-icons`. References updated in `background.html`, `stylesheets/_modules.scss`, `stylesheets/components/InstallScreenSignalLogo.scss`, `stylesheets/components/PreferencesDonations.scss` and the components that used them. |
| Type             | `fonts/swarm/` (Sora, Manrope, JetBrains Mono — latin and latin-ext subsets of the variable fonts, SIL OFL 1.1), registered in `stylesheets/_swarm-fontfaces.scss`, imported from `stylesheets/manifest.scss`. Stacks updated in `stylesheets/_variables.scss` (`$inter` now starts with Manrope, new `$swarm-display`, `$monospace` starts with JetBrains Mono) and `ts/axo/_tailwind-theme/fonts.css` (`--font-sans`, `--font-mono`, new `--font-display`). Inter is kept as a fallback so no glyph is lost.                                                                                                                                     |
| Colour           | Hive Orange `#FF8A1F` replaces Signal ultramarine: `stylesheets/_variables.scss` (`$color-accent-blue`, the `$color-ultramarine*` scale) and `ts/axo/_tailwind-theme/colors.css` (`--axo-color-brand-primary`).                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Theme            | Dark by default: `app/main.main.ts` `getThemeSetting()` and `ts/util/createIPCEvents.preload.ts`. The user can still choose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Data directory   | `app/user_config.main.ts`: the development and staging profiles were stored under `Signal-<profile>` in the user's roaming data. Now `SWARM-Messenger-<profile>`. A packaged build uses `app.getName()`, which is already "SWARM Messenger".                                                                                                                                                                                                                                                                                                                                                                                                       |
| polkit           | `build/policy-templates/green.swarm.*.policy` replace `org.signalapp.*`; ids updated in `scripts/gen-policy-files.mjs`, `scripts/ensure-linux-file-permissions.mjs`, `ts/util/os/promptOSAuthMain.main.ts`, and `package.json` (`linux.extraResources` filter).                                                                                                                                                                                                                                                                                                                                                                                    |
| Sticker creator  | `sticker-creator/package.json`, `sticker-creator/src/elements/PageHeader.tsx`: SWARM author and support link. The creator itself is a local page (`file://`), not a Signal service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Removed or hidden

| What                                      | How                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Donations / boost                         | Settings entry point removed (`ts/components/Preferences.dom.tsx`). The page is left in the tree so upstream merges stay small. `stripePublishableKey` gone from config; the two Stripe calls in `ts/textsecure/WebAPI.preload.ts` throw a plain message if reached.                                                                                                                                                                                      |
| Update checks                             | `updatesEnabled: false` everywhere, all `publish` targets emptied, Signal's custom NSIS mirror (`nsis.customNsisBinary`, `customNsisResources` — they downloaded from `updates.signal.org`) removed, `updatesPublicKey` and `appImageUpdatesPublicKey` removed. "Force update" removed from the View menu (`app/menu.std.ts`). `ts/updater/common.main.ts` and `ts/updater/linuxAppImage.main.ts` now explain themselves if the missing key is ever read. |
| Windows signing with Signal's certificate | `build.win.signtoolOptions` reduced to the hook and hash algorithm; `certificateSubjectName`, `certificateSha1` and `publisherName` removed. `scripts/sign-windows.mjs` already returns early without a certificate, so builds are unsigned.                                                                                                                                                                                                              |
| Signal support and community links        | All point at `https://swarm.green/support`.                                                                                                                                                                                                                                                                                                                                                                                                               |

### The brand check

`scripts/swarm-brand-check.mjs` unpacks the built `app.asar` and **fails** on:

- any Signal domain in the app's own files (excluding `node_modules`, licences,
  `ACKNOWLEDGMENTS.md`, `NOTICE-SWARM.md`);
- any packaged English string containing "Signal", except the AGPL attribution.

It **excuses exactly one thing**: the endpoint guard's refusal list
(`SIGNAL_HOST_SUFFIXES` in `ts/util/swarm/endpointGuard.std.ts`), recognised by
its first three entries in order. That list names Signal's domains so the app can
refuse them, so it is the one place they must be in the bundle.

The first run of the check in CI (run 36288590467, 2026-09-27) found two real
leaks, both fixed the same day:

| Found                                                                 | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/optional-resources.json`: 129 URLs on Signal's resource host   | The app fetched the emoji search index for the user's locale from there **on every start**, plus the large emoji font and the jumbomoji sheets on demand. The URLs now use `https://static.swarm.green/` (SWARM's `resourcesUrl`), same paths, same digests; `app/OptionalResourceService.main.ts` refuses a Signal URL outright (`refuseSignalUrl`). Until the files are mirrored there, localized emoji search and large emoji do not load. |
| 67 translated strings with Signal's support address and download page | `support@swarm.green` and `swarm.green/download`, as the English strings already said. Only those two substrings changed.                                                                                                                                                                                                                                                                                                                     |

`ts/test-node/swarm/noSignalEndpoints_test.node.ts` now also checks both files in
the source tree, so the next regeneration from upstream fails the tests before it
reaches a package.

It **reports without failing** the internal mentions — `window.SignalContext`,
`X-Signal-Agent`, `SignalSymbols`, the `@signalapp/*` package names, the
`signal.me`/`signal.group` deep-link vocabulary. Those are identifiers and
protocol-level names, not branding, and a check that failed on them would be
useless. It runs in CI against the artefact, because the wallet team's W-2 miss was
exactly a rebrand that looked finished in the source tree.

## 4a. Two helper scripts for the parameters

| Script                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/swarm-import-params.mjs` | Reads `shared/staging-public-params.json` in the format the server fork documents (`docs/STAGING.md` section 5a), validates it - `serverTrustRoots` must be a non-empty **list**, because a rotation publishes the new root beside the old one - and writes the four values into all three config files in one command, so the wiring cannot be half-done.                                                                                                                                                                                                               |
| `scripts/swarm-dev-params.mjs`    | Writes throwaway but structurally valid parameters into the git-ignored `config/local-development.json`, so the user interface can be opened before the server exists. The `SWARM-PLACEHOLDER-*` strings are not decodable, and libsignal throws on them while the app is still on its loading screen - which means no screen after it can be seen or worked on. What it writes is a freshly generated zkgroup server identity and a fresh trust root: real cryptographic material that belongs to nobody, authenticates nothing, and never reaches a commit or a build. |

## 5. The Wallet pane

M1 added the mount point; M3 wave 1 (2026-09-27) put the SWARM wallet behind it.
The design, the IPC surface, the threat notes and the wave-2 plan are in
[`WALLET-PANE.md`](WALLET-PANE.md).

- Mount point (M1): `ts/types/Nav.std.ts` (`NavTab.Wallet`),
  `ts/components/NavTabs.dom.tsx`, `ts/state/smart/NavTabs.preload.tsx`,
  `ts/components/Inbox.dom.tsx`, `ts/state/smart/Inbox.preload.tsx` (the
  `renderWalletTab` prop), `stylesheets/components/NavTabs.scss`
  (`.NavTabs__ItemIcon--Wallet`).
- The pane (M3): `ts/components/SwarmWalletPane.dom.tsx`, its container
  `ts/state/smart/SwarmWalletTab.preload.tsx` (renamed from `.dom.tsx`), the
  renderer client `ts/services/swarmWallet.preload.ts`, the shared schemas
  `ts/types/SwarmWallet.std.ts`, amounts `ts/util/swarm/swmAmount.std.ts`.
- The wallet (M3): `app/SwarmWalletService.main.ts`, created from
  `app/main.main.ts` and sealed on the way out; its validators
  `ts/util/swarm/walletIpc.node.ts`; the worker thread
  `ts/workers/swarmWalletWorker.node.ts`, `swarmWalletHandler.node.ts`,
  `swarmWalletProtocol.std.ts`, bundled by `rolldown.config.ts` as
  `bundles/workers/swarmWallet.js`.
- Sign-in hands the recovery phrase to the wallet once
  (`ts/state/ducks/standaloneInstaller.preload.ts`, `adoptWalletPhrase`).
- `swarm-wallet-core` 0.2.0 vendored as `vendor/swarm-wallet-core-0.2.0.tgz`
  (a devDependency, bundled); its Rust addon pinned by
  `vendor/swarm-wallet-core-native.json` and fetched by
  `scripts/swarm-fetch-wallet-addon.mjs` into the git-ignored
  `vendor/swarm-wallet-native/`; `build.files` packages it.
- `.oxlint/rules/enforceFileSuffix.mjs`: `swarm-wallet-core` is a Node package.
- `ts/axo/_tailwind-theme/fonts.css`: `--font-swarm-mono`, JetBrains Mono first,
  because `--font-mono` starts with MonoSpecial, whose letters are all capitals.
- `_locales/en/messages.json`: the `icu:SwarmWallet__*` strings; the two
  placeholder strings are gone.

### 5a. Payments inside a chat (M3 wave 2)

Added 2026-09-28 by Opus M3-W2. A SWARM payment notice and a SWARM address
request or share travel as fields of the app's own `DataMessage`, inside the
existing end-to-end encryption; libsignal and the Signal protocol are not
touched. What a person sees, the rules and the proof:
[`WALLET-PANE.md`](WALLET-PANE.md) sections 11 and 12.

| File                                                                                                                                                     | Change                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protos/SignalService.proto`                                                                                                                             | `DataMessage.Payment.SwarmNotification` as `Payment.Item` arm 3, and `DataMessage.SwarmAddress` as field 30: the next free numbers; nothing upstream renumbered. `pnpm run build:protobuf` regenerates `ts/protobuf/compiled.std.*` (git-ignored).                                                                                                                             |
| `ts/types/Payment.std.ts`                                                                                                                                | `PaymentEventKind.SwarmNotification` / `SwarmAddressRequest` / `SwarmAddressShare` (101-103, apart from upstream's kinds) and their event types.                                                                                                                                                                                                                               |
| `ts/textsecure/processDataMessage.preload.ts`                                                                                                            | `processPayment` gains the SWARM branch, refusing a notice for another network or in a group; `swarmAddress` becomes a payment event the same way.                                                                                                                                                                                                                             |
| `ts/messages/payments.std.ts`                                                                                                                            | The sentences; the amount through `formatZatoshiAsSwm`, eight decimals. A notification, preview or quote says "SWARM payment" without an amount.                                                                                                                                                                                                                               |
| `ts/textsecure/SendMessage.preload.ts`, `ts/jobs/helpers/sendNormalMessage.preload.ts`, `ts/models/conversations.preload.ts`                             | `swarmPayment` carried from `enqueueMessageForSend` to `Message.toProto`; refused on a group send.                                                                                                                                                                                                                                                                             |
| `ts/messages/handleDataMessage.preload.ts`                                                                                                               | After a SWARM message arrives: a shared address is checked by the wallet and kept on the conversation; a notice is remembered for the Wallet pane.                                                                                                                                                                                                                             |
| `ts/model-types.d.ts`, `ts/state/ducks/conversations.preload.ts`, `ts/util/getConversation.preload.ts`                                                   | `swarmPayments` on the conversation (this device only; not a profile field, not in any storage-service record).                                                                                                                                                                                                                                                                |
| `ts/components/CompositionArea.dom.tsx`, `ts/state/smart/CompositionArea.preload.tsx`                                                                    | Pay with SWARM, Request SWARM address and Share SWARM address in the composer's + menu, one-to-one chats only.                                                                                                                                                                                                                                                                 |
| `ts/components/conversation/Message.dom.tsx`, `TimelineItem.dom.tsx`, `ts/state/smart/TimelineItem.preload.tsx`, `ts/state/selectors/message.preload.ts` | A SWARM payment event renders in the message bubble (`renderSwarmPayment`), not as a system line.                                                                                                                                                                                                                                                                              |
| `ts/components/conversation/Quote.dom.tsx`                                                                                                               | A reply to a SWARM message quotes its label.                                                                                                                                                                                                                                                                                                                                   |
| `ts/services/backups/export.preload.ts`                                                                                                                  | SWARM payment messages are left out of the chat backup.                                                                                                                                                                                                                                                                                                                        |
| `ts/components/SwarmWalletPane.dom.tsx`, `ts/state/smart/SwarmWalletTab.preload.tsx`                                                                     | The send flow moved into `SwarmSendFlow.dom.tsx` (shared with the chat, unchanged); transactions labelled "from" / "to" a contact when a notice named them.                                                                                                                                                                                                                    |
| `app/SwarmWalletService.main.ts`, `ts/util/swarm/walletIpc.node.ts`, `ts/types/SwarmWallet.std.ts`, `ts/services/swarmWallet.preload.ts`                 | `swarm-wallet:new-address`, `swarm-wallet:check-address`, `swarm-wallet:find-transaction`, each sender-checked and validated; `confirm-send` also answers `chain` and `memoHash`.                                                                                                                                                                                              |
| `ts/workers/swarmWalletHandler.node.ts`, `swarmWalletProtocol.std.ts`                                                                                    | The worker makes a new address and lists one transaction's value transfers; it reads the SDK's `status` and `memos`, which swarm-wallet-core 0.2.0 does not.                                                                                                                                                                                                                   |
| `app/main.main.ts`, `ts/types/RendererConfig.std.ts`                                                                                                     | `swarmWalletChain` in the window's config, so notices are held to the wallet's network from the first message.                                                                                                                                                                                                                                                                 |
| New                                                                                                                                                      | `ts/util/swarm/swarmChatPayments.std.ts`, `swarmConversation.std.ts`, `swarmNoticeBinding.std.ts`, `swarmWalletChain.dom.ts`, `ts/services/swarmChatPayments.preload.ts`, `ts/components/SwarmSendFlow.dom.tsx`, `SwarmChatPaymentDialog.dom.tsx`, `conversation/SwarmPaymentBubble.dom.tsx`, `ts/state/smart/SwarmChatPayment.preload.tsx`, `SwarmPaymentBubble.preload.tsx`. |
| `_locales/en/messages.json`                                                                                                                              | The `icu:SwarmChat__*` strings.                                                                                                                                                                                                                                                                                                                                                |
| Tests                                                                                                                                                    | Eight new files under `ts/test-node/swarm/` (listed in WALLET-PANE.md section 8); `ts/test-helpers/fakeSwarmWalletAddon.node.ts` answers SDK-shaped value transfers and new addresses; `ts/test-node/processDataMessage_test.preload.ts` gains the new field.                                                                                                                  |

## 6. CI

`.github/workflows/swarm-build.yml` (new). Upstream `ci.yml` targets Signal's
self-hosted runners (`ubuntu-22.04-8-cores`, `windows-latest-8-cores`) which do
not exist in this org. Its jobs were left alone; since M4 only its `on:`
triggers are changed, to `upstream-main` pushes and pull requests, because
every pull request to `swarm-main` queued jobs that could never start. The
same for `icu-book.yml` (`ubuntu-latest-8-cores`). Upstream's original
triggers are quoted in a comment in each file.

- `lint-and-test` on `ubuntu-latest`: install, generate, `check:types`, `oxlint:ci`,
  `lint-prettier`, `test-node`. `test-node` runs under `xvfb-run` with
  `kernel.apparmor_restrict_unprivileged_userns=0`: Ubuntu 24.04 blocks the user
  namespaces Chromium's sandbox needs, and Electron then aborts on the setuid
  helper before a single test runs. Upstream runs the same tests on 22.04 under
  `xvfb-run`.
- `windows-installer` on `windows-latest`: install (**without**
  `SWARM_ALLOW_MISSING_NATIVE`, so a native failure fails the build), generate,
  `test-node`, `build:release --publish=never`, `swarm-brand-check.mjs`, sha256.
- The installer and `SHA256SUMS.txt` are attached to a GitHub Release tagged
  `swarm-messenger-m1-<shortsha>`. `actions/upload-artifact` is
  `continue-on-error: true` because the org's Actions artifact storage quota is
  exhausted; the Release is the deliverable.

`check:types` runs on Linux only, as upstream does: `fs-xattr` is an optional
non-Windows dependency and `ts/windows/main/attachments.preload.ts` imports its
types, so `tsc` reports one unresolved module on a Windows machine. That error is
pre-existing and unrelated to any SWARM change.

### 6a. Installers for Windows, Linux and macOS, released by version (M4)

Added 2026-09-27 by Opus M4. The workflow now has five jobs: `lint-and-test`
(unchanged), `installer-windows` (the M1 job, renamed), `installer-linux` (.deb
and AppImage, x64), `installer-mac` (.dmg and .zip, Apple Silicon, ad-hoc
signed and not notarized) and `release`, which writes one `SHA256SUMS.txt`
over all five installers and, on a push to `swarm-main` only, publishes one
pre-release tagged `swarm-messenger-desktop-<yyyymmdd>-<shortsha>` on that
commit. It replaces the M1 `swarm-messenger-m1-<shortsha>` releases, whose tags
were created on `upstream-main` because no `target_commitish` was given.
Artifact uploads are no longer best effort: the repository is public. Every
installer job runs M3's `scripts/swarm-fetch-wallet-addon.mjs` before
`build:release`, so each package carries its platform's hash-pinned wallet
addon; the Linux and Mac start tests fail if the app reports the addon
missing, and check that the packaged addon loads.
[`RELEASES.md`](RELEASES.md) is the full account: every file, how it is built,
where its hash is, what is signed (nothing yet) and the install steps per
system.

| File                                                                  | Change                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (`build`)                                              | Linux targets deb **and** AppImage; Mac targets zip and dmg for **arm64 only** (the SWARM libsignal build has no darwin-x64 library, so x64 or universal would not start); `mac.icon` is the SWARM icns; `deb.afterInstall`/`afterRemove`; `extraMetadata.homepage`. |
| `build/icons/mac/icon.icns` (new), `build/dmg/icon.icns`              | The SWARM mark. The Mac app icon was Signal's (`AppIcon.icon`, left in the tree unused) and the .dmg volume icon said "Signal is a nonprofit".                                                                                                                       |
| `build/installerIcon.ico`, `build/installerHeaderIcon.ico`            | The SWARM mark. The Windows installer .exe and its progress banner showed Signal's logo.                                                                                                                                                                             |
| `build/SignalStrings.nsh`                                             | Regenerated by `scripts/gen-nsis-script.mjs`: the two English installer messages say SWARM Messenger. Other languages still say Signal, like every translated string (§7).                                                                                           |
| `build/linux/after-install.tpl`, `build/linux/after-remove.tpl` (new) | The .deb's postinst and postrm. Upstream's patched templates install `org.signalapp.*` polkit policies that a SWARM build does not ship; these install and remove the `green.swarm.*` ones the app asks `pkcheck` about.                                             |
| `package.json` `build.extraMetadata.homepage`                         | `https://swarm.green`. The .deb's `Homepage` was derived from `repository`, which is still Signal's GitHub URL.                                                                                                                                                      |
| `scripts/swarm-brand-check.mjs`                                       | Finds the arm64 Mac app (`release/mac-arm64/`) and every other platform directory, and checks every packaged app it finds.                                                                                                                                           |
| `scripts/swarm-prepare-unsigned-mac-build.mjs` (new)                  | CI only: removes `build.mac.sign`, sets `identity` to `-` (ad hoc) and `hardenedRuntime` to `false` in the job's copy of `package.json`. The committed file keeps the signed-build configuration.                                                                    |
| `scripts/swarm-release-notes.mjs` (new)                               | Checks the release has exactly one .exe, .deb, .AppImage, .dmg and .zip, writes `SHA256SUMS.txt`, the tag, the name and the release text.                                                                                                                            |

## 7. Deliberately _not_ changed

| Thing                                                                                                                                   | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/util/signalRoutes.std.ts` — `signal.me`, `signal.group`, `signal.link`, `signal.art` and the `sgnl:` / `signalcaptcha:` URL schemes | These are the deep-link vocabulary shared between clients and the server, not branding, and nothing is _fetched_ from those hosts (the app intercepts them). Removing `sgnl:` breaks device linking outright. Renaming them to `swarm:` needs one coordinated change across Signal-Desktop, Signal-iOS, Signal-Android and the server's captcha page — a later milestone. `build.protocols` now registers `swarm` alongside `sgnl` and `signalcaptcha` so the SWARM scheme is claimed. |
| Other locales (`_locales/<lang>/messages.json`)                                                                                         | 67 locales still say "Signal" in already-translated strings. New SWARM keys fall back to English correctly (`app/locale.node.ts` merges English first, then the matched locale key by key), so nothing is missing — but a French user still reads "Signal" in translated sentences. Re-translation is an owner decision.                                                                                                                                                               |
| `ts/updater/**` beyond the two key getters                                                                                              | The updater never starts while `updatesEnabled` is false (`ts/updater/index.main.ts` `autoUpdateDisabled()`).                                                                                                                                                                                                                                                                                                                                                                          |
| Donations pages, badge parsing                                                                                                          | Left in the tree with the entry points removed, to keep upstream merges small.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Anything in `libsignal`                                                                                                                 | Project rule. Opus M-D forks it separately.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 8. Tests touched

- `ts/test-node/updater/curve_test.node.ts`: the case that verified a signature
  made with **Signal's** update signing key is `it.skip`ped with an explanation —
  the key is not in config any more and SWARM has no update feed. The sign/verify
  roundtrip case still runs.
- Sample URLs in stories and tests moved from `signal.org` to `swarm.green` so the
  scan test in §2c can be strict.
- New: `ts/test-node/swarm/endpointGuard_test.node.ts`,
  `ts/test-node/swarm/noSignalEndpoints_test.node.ts`.

## 3e. First screen: the wallet sign-in, not the phone-linking code

Added 2026-09-28 (Messenger planner, owner decision: desktop first, no phone app
yet). `ts/background.preload.ts` opens the standalone registration
(`app.openStandalone()`, which starts at the wallet stage) on a fresh install
instead of `installer.startInstaller()` (upstream's "scan this code with your
phone" screen). The linking screen and its code are unchanged and reachable from
File > Set up as new device, for the day a SWARM phone app can link a desktop.
Everything after the first screen (create or restore the 24 words, profile,
inbox) is as in section 3a.

## 3f. Version 0.1.0: the first public desktop release

2026-09-28, owner decision ("deploy it"): `package.json` `version` becomes `0.1.0`
(upstream's `8.31.0-alpha.1` was the fork base's number). Installer names and the
release name follow it (`swarm-messenger-win-x64-0.1.0.exe`, …). Upstream merges
keep this line; the upstream version is recorded in `docs/SWARM-CHANGES.md` section 1.
