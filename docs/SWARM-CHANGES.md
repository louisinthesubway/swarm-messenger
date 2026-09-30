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
| About window     | `ts/components/About.dom.tsx`: swarm.green links, and a "Licences" entry that opens the Licences document (section 3h), which carries the AGPL-3.0 attribution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
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
| Signal support and community links        | All point at `https://swarm.green/support`. "Go to Forums" and "Join the Beta" are gone from the Help menu (section 3h).                                                                                                                                                                                                                                                                                                                                  |

### The brand check

`scripts/swarm-brand-check.mjs` unpacks the built `app.asar` and **fails** on:

- any Signal domain in the app's own files (excluding `node_modules`, licences,
  `ACKNOWLEDGMENTS.md`, `NOTICE-SWARM.md`);
- any packaged English string containing "Signal" (no exception since section
  3h: the attribution is in the Licences document, not in a string);
- a packaged app whose Licences document (`build/licences.html`) is missing or
  lacks the licence paragraph, the AGPL-3.0 text or the third-party notices.

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

| Thing                                                                                                                                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/util/signalRoutes.std.ts` — `signal.me`, `signal.group`, `signal.art`, the `sgnl:` / `signalcaptcha:` URL schemes, and `signal.link` as an old form only | These are the deep-link vocabulary shared between clients and the server, not branding, and nothing is _fetched_ from those hosts (the app intercepts them). Removing `sgnl:` breaks device linking outright. Renaming them to `swarm:` needs one coordinated change across Signal-Desktop, Signal-iOS, Signal-Android and the server's captcha page — a later milestone. Call links moved first (MSG-P3, 2026-09-29): the app makes `https://swarm.green/call/#key=…` and `swarm://swarm.green/call/#key=…`, and accepts `https://signal.link/call/…` and `sgnl://signal.link/call/…` only so that links shared by 0.1.0 keep opening. The `swarm` scheme is registered by the app itself on every platform (`app/main.main.ts`, packaged builds only) and by the package metadata (`build.protocols`) on Mac (Info.plist) and Linux (the .desktop file). electron-builder's Windows (NSIS) installer ignores `build.protocols`, so on Windows the app's own registration is the only one. Since B2c (2026-09-29) `swarm` is the only scheme the app and the packages register: the parser still understands `sgnl:` and `signalcaptcha:` links that reach the app, but the operating system no longer sends them to it (section 3h). Since B3 (2026-09-29) the same holds for username, group, sticker pack, linking and Windows-notification links: the app makes only the swarm.green / `swarm:` forms, and the `signal.me`, `signal.group`, `signal.art` and `sgnl:` forms are read only (section 3i). |
| Other locales (`_locales/<lang>/messages.json`)                                                                                                              | 67 locales still say "Signal" in already-translated strings. New SWARM keys fall back to English correctly (`app/locale.node.ts` merges English first, then the matched locale key by key), so nothing is missing — but a French user still reads "Signal" in translated sentences. Re-translation is an owner decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ts/updater/**` beyond the two key getters                                                                                                                   | The updater never starts while `updatesEnabled` is false (`ts/updater/index.main.ts` `autoUpdateDisabled()`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Donations pages, badge parsing                                                                                                                               | Left in the tree with the entry points removed, to keep upstream merges small.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Anything in `libsignal`                                                                                                                                      | Project rule. Opus M-D forks it separately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

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

## 3g. Mirror under louisinthesubway after the Swarm-Official suspension

2026-09-28 17:1x UTC GitHub suspended the account that owned the Swarm-Official
organisation; every repository and release vanished. This repository is a
single-commit snapshot of swarm-main 725e5cbc2 (the 0.1.0 tree) under
`louisinthesubway/swarm-messenger`; the wallet addon is fetched from the mirrored
`louisinthesubway/swarm-wallet-core` release (`vendor/swarm-wallet-core-native.json`).
The full history stays in the workstation clone. When the repositories move into
the Swarm-Coin organisation, GitHub redirects these URLs.

## 3h. No Signal in menus, metadata or the About window (B2c)

2026-09-29, owner decision: no hint in the app that it comes from the upstream
project, except where the AGPL-3.0 requires it. The licence notices move out of
the visible text into one document.

| What                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                    | `desktopName` `swarm-messenger.desktop` (the entry the .deb installs; Electron hands it to xdg-settings), `repository` `https://github.com/louisinthesubway/swarm-messenger.git`, `homepage` `https://swarm.green`, `build.copyright` `Copyright © 2026 SWARM` (Windows version resource, macOS Info.plist), `build.protocols` `swarm` only.                                                                                     |
| Help menu (`app/menu.std.ts`, `app/main.main.ts`) | "Go to Release Notes" opens `https://swarm.green/ecosystem/messenger` when the main window is hidden (it opened a GitHub releases page). "Go to Forums" and "Join the Beta" are removed: SWARM has neither, and both only opened the support page.                                                                                                                                                                               |
| About window (`ts/components/About.dom.tsx`)      | Name, version, swarm.green, "Licences", Terms & Privacy Policy. The attribution line and the acknowledgments link (to GitHub) are gone.                                                                                                                                                                                                                                                                                          |
| Licences document                                 | `build/licences.html`, written by `scripts/swarm-generate-licences.mjs` (`build:licences`, part of `pnpm run generate`) from `ts/util/swarm/licencesDocument.std.ts`, `LICENSE` and `ACKNOWLEDGMENTS.md`, and packaged. The About window's "Licences" opens it in a window of its own (no script, no website): the licence paragraph with the source-code offer, the copyright line, the AGPL-3.0 text, the third-party notices. |
| Main window                                       | The footer line under the empty chat view (`icu:signalNonProfit`) is gone; in other languages it still said that the upstream project is a nonprofit.                                                                                                                                                                                                                                                                            |
| Strings                                           | `icu:About__Licences` added; `icu:SwarmAbout__attribution` and `icu:signalNonProfit` deleted from every locale; `icu:softwareAcknowledgments`, `icu:goToForums`, `icu:joinTheBeta` no longer used.                                                                                                                                                                                                                               |
| URL schemes                                       | The app registers `swarm` only. The SWARM server has no captcha page that could redirect to `signalcaptcha:` (its captcha is the no-op client), so that scheme is not registered either.                                                                                                                                                                                                                                         |
| Wording                                           | Default device name when the computer has none: "SWARM Messenger". Log lines: the scheme registration, and the 401 warning in `ts/textsecure/WebAPI.preload.ts`.                                                                                                                                                                                                                                                                 |
| Checks                                            | `scripts/swarm-brand-check.mjs` requires the Licences document; `ts/test-node/swarm/productMetadata_test.node.ts` is new; the package jobs print and check the Windows version resources, the Info.plist copyright and schemes, and the desktop entry's name and MimeType.                                                                                                                                                       |

Not changed: the User-Agent (`Signal-Desktop/<version> <OS> <release>`). The
server's `UserAgentUtil` recognises only `Signal-(Android|Desktop|iOS)/`; with
any other product name `RemoteConfigsManager` would withhold every `desktop.*`
remote configuration (`desktop.clientExpiration` among them) and
`RemoteDeprecationFilter` would apply no version gate. It changes together with
the server.

## 3i. Links and QR codes on swarm.green (B3)

2026-09-29, owner report: the username Sharing screen showed a QR code with
Signal's logo in it and the link `https://signal.me/#eu/…`. Every link the app
makes is now on swarm.green (or in the `swarm:` scheme), every QR code carries
the SWARM mark, and every Signal form shared before is still read. The call
link (MSG-P3) was the template.

| What                                        | Made now (web / app form)                                                                                             | Still read, never made                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Username link (Sharing screen, QR, PNG)     | `https://swarm.green/u/#eu/<code>` / `swarm://swarm.green/u/#eu/<code>`                                               | `https://signal.me/#eu/…`, `sgnl://signal.me/#eu/…`                        |
| Phone-number link                           | `https://swarm.green/u/#p/<number>` / `swarm://swarm.green/u/#p/…` (nothing in the app makes one)                     | `https://signal.me/#p/…`, `sgnl://signal.me/#p/…`                          |
| Group link                                  | `https://swarm.green/g/#<code>` / `swarm://swarm.green/g/#<code>`                                                     | `https://signal.group/#…`, `sgnl://signal.group/#…`, `sgnl://joingroup/#…` |
| Sticker pack link (app and sticker creator) | `https://swarm.green/stickers/#pack_id=…&pack_key=…` / `swarm://swarm.green/stickers/#…`                              | `https://signal.art/addstickers/#…`, `sgnl://addstickers/?…`               |
| Linking QR code (install screen)            | `swarm://linkdevice?uuid=…&pub_key=…&capabilities=…`                                                                  | `sgnl://linkdevice?…`                                                      |
| Windows notification clicks                 | `swarm://show-conversation?token=…`, `swarm://start-call-lobby?…`, `swarm://show-window`, `swarm://cancel-presenting` | the same with `sgnl://`                                                    |

- **Routes** (`ts/util/signalRoutes.std.ts`): the swarm.green / `swarm:`
  patterns come first, Signal's are kept after them for reading, and
  `toWebUrl` / `toAppUrl` make only the new forms, so a Signal link that is
  re-made (copied, forwarded, normalised) comes out on swarm.green. Paths are
  exact: `/u`, `/g`, `/stickers`, `/call` on `swarm.green` only, not
  `www.` or `chat.`. Secrets stay in the fragment, which a browser never sends.
- **In a message** such a link is the app's own, as the old ones were: link
  previews read it locally (`isGroupLink`, `isStickerPack`, `isCallLink` in
  `ts/types/LinkPreview.std.ts` use the routes), and a click opens it in the
  app (`handleUrl` in `app/main.main.ts` asks the router first). `green` is
  added to the top-level domains linkified without `https://`
  (`ts/components/conversation/Linkify.dom.tsx`), so `swarm.green/g/#…` typed
  bare is clickable too (it then goes through the web page, as a bare
  `signal.me/…` did upstream).
- **Notification clicks on Windows** were broken by B2c, which stopped
  registering `sgnl:`: a toast opened `sgnl://show-conversation…`, which did
  nothing, or opened Signal Desktop where that is installed. They now use
  `swarm:`.
- **Linking QR code**: a phone app reads it, not this app. SWARM has no phone
  app; one built later must read `swarm://linkdevice` (and may keep
  `sgnl://linkdevice`). The mock server used by `ts/test-mock` does not look at
  the scheme.
- **QR codes** (`ts/components/BrandedQRCode.dom.tsx`, used by the Sharing
  screen, its saved PNG and the install screen): Signal's speech bubble is
  replaced by the SWARM mark, the three paths of `images/swarm-mark.svg`
  unchanged in a nested `<svg viewBox="0 0 1000 467.95">`, full width of the
  36 × 36 logo square and centred in it, inside the same cutaway, so the QR
  code reads exactly as before. `ts/components/QrCode.dom.tsx` (safety number,
  wallet) draws no logo. Group link management shows no QR code.
- **Username card colour**: the default is SWARM orange (`#ff8a1f`, Hive
  Orange; QR dots `#d66400`, so they still scan on white) instead of Signal
  blue. The stored colour id is not touched: the account record keeps
  `UNKNOWN` until someone picks a colour; `UNKNOWN` and the existing `ORANGE`
  id are drawn in SWARM orange, `ORANGE` is first in the picker and marked
  when nothing was picked, and `BLUE` stays blue. No new colour id, so any
  other device still understands the stored value.
- **Saved image** is named `swarm-username-qr-code.png` (was
  `signal-username-qr-code.png`). It shows the card, the QR code (SWARM mark,
  swarm.green link inside) and the username; like upstream it does not print
  the link as text.
- **Strings**: English `icu:unknown-sgnl-link` no longer says `sgnl://`. The
  other languages still carry `sgnl://` in that string (this task leaves
  locales to B1); the toast only shows for a link the app understands but
  cannot act on, such as a linking link clicked in a chat.
- **Checks**: `ts/test-node/swarm/swarmLinks_test.preload.tsx` (new: made forms,
  old forms read as the same link, link previews, linkify, the QR mark path
  for path against `images/swarm-mark.svg`, the colour default and ids);
  `ts/test-node/swarm/noSignalEndpoints_test.node.ts` (no non-test source in
  `ts/`, `app/` or `sticker-creator/src` writes a link on signal.me /
  .group / .art / .link or a moved `sgnl:` link; `signalRoutes.std.ts` names
  those hosts only in the nine reading patterns listed in the test and in its
  hostname list; no English string shows them);
  `ts/test-node/util/signalRoutes_test.std.ts` (every new form, every old form).

Not changed: the captcha scheme `signalcaptcha:` (the SWARM server has no
captcha page, B2c); the donation routes (`sgnl://donation-validation-complete`,
`signaldonations.org`), whose entry points are removed (section 4); the IPC
channel names such as `show-conversation-via-signal.me`, which nobody sees.

**For the web team**: swarm.green needs three more pages like `/call/`:
`/u/`, `/g/` and `/stickers/`. Each reads nothing from the fragment
server-side (it never arrives), shows a short line ("Chat with … on SWARM
Messenger", "Join a group on SWARM Messenger", "Add a sticker pack to SWARM
Messenger"), a button **Open in SWARM Messenger** that sends the browser to the
same address with `https://` replaced by `swarm://` (fragment kept:
`swarm://swarm.green/u/#eu/…`, `swarm://swarm.green/g/#…`,
`swarm://swarm.green/stickers/#pack_id=…&pack_key=…`), and a link to
`https://swarm.green/download/`. A phone-number form `/u/#p/…` should get the
same page as `/u/#eu/…`.

## 3j. No phone number in the interface (B4)

2026-09-29, owner report: _"in my account i have some +888 number added but sign
up works only via Wallet. No phone number!"_ A SWARM account signs in with its
wallet (section 3a). It still carries the synthetic identifier `+888` + 11 digits
derived from its identity key, because the server, the storage service and
contact discovery key accounts by an E.164 string. That identifier is data, not
a phone number: it is no longer shown anywhere, and nothing in the interface
asks for or offers a phone number.

**One check, one formatter.** `ts/util/swarm/swarmIdentityE164.std.ts` (new, pure)
holds the shape rule (`+888`, 11 digits, no leading zero: exactly what
`accountIdentifierFor` derives) as `isSwarmIdentityE164`; `walletIdentity.node.ts`
now takes its prefix, digit count and `isSwarmAccountIdentifier` from there.
`renderNumber` in `ts/util/getTitle.preload.ts` returns nothing for such an
identifier. Every screen's `phoneNumber` (redux `ConversationType.phoneNumber`,
built by `getConversation`) and every title comes through it, so the screens
below needed no change of their own unless listed.

**The neutral name.** A person with no nickname, contact name, profile name or
username is shown as **"SWARM account 1a2b"**: the last four hex characters of
their ACI (`icu:SwarmAccount--fallback-title`, `getSwarmAccountLabel`). Order of
preference, as upstream: nickname, contact name, profile name, (phone number,
never for a SWARM identifier), username, then this label. It replaces the
identifier where upstream titled a chat with the number (so the chat still counts
as having a title and stays in search, compose and forward lists), and replaces
"Unknown contact" for any account with an ACI. Without an ACI it stays "Unknown
contact" / "Deleted account" as upstream.

| Screen                                                                                                     | Before                                                                               | Now                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Settings, profile chip (`Preferences.dom.tsx`)                                                             | name, `+888 108 664 42360`, username                                                 | name and username                                                                                                        |
| Settings > General                                                                                         | "Phone Number" row                                                                   | no row (new prop `isPhoneNumberHidden`, set by `state/smart/Preferences.preload.tsx`)                                    |
| Settings > Privacy                                                                                         | "Phone Number" row: who can see my number, who can find me by number                 | no row; the page stays in the tree, the stored `phoneNumberSharingMode` / `phoneNumberDiscoverability` keep their values |
| Contact "About" modal, conversation header, contact spoofing review, safety number change dialog, avatars  | the contact's number when shared                                                     | nothing (via `renderNumber`)                                                                                             |
| Conversation titles: chat list, header, hero, details, notifications, mentions, quotes, calls, group lists | the number when there was no name                                                    | username, else "SWARM account 1a2b"                                                                                      |
| New chat (`LeftPaneComposeHelper`)                                                                         | "Find by phone number" button; typed digits offered as a number to start a chat with | "New group" and "Find by username" only; digits are not offered                                                          |
| Group member choice (`LeftPaneChooseGroupMembersHelper`, `ChooseGroupMembersModal`)                        | typed digits offered as a number to add                                              | not offered                                                                                                              |
| Search box when choosing people (6 places)                                                                 | "Name, username, or number"                                                          | "Name or username" (`icu:SwarmContactSearchPlaceholder`)                                                                 |
| Chat list search (`filterAndSortConversations`)                                                            | digits matched contacts by their number                                              | a SWARM identifier is not matched                                                                                        |
| Chat context menu (internal features only)                                                                 | "Copy E164"                                                                          | hidden for a SWARM identifier                                                                                            |
| Sign-up, "Set up your profile" (`ProfileEntry.dom.tsx`)                                                    | "Who can find me by phone number" row and dialog                                     | removed (the value it chose was never sent: Continue always sent "Discoverable", and still does)                         |
| Profile editor, under Username, no username set                                                            | "…so you don't have to give out your phone number."                                  | "Set a username so people can find you and start a chat with you."                                                       |
| Username introduction dialog (`UsernameOnboardingModal`)                                                   | "Phone number privacy" row; username row about not giving out your number            | Usernames and QR-code rows only                                                                                          |
| Chat list prompt (`UsernameMegaphone`)                                                                     | "Introducing phone number privacy, optional usernames and links."                    | "Set a username so people can find you, and share it as a link or a QR code."                                            |
| Signed-out banner (`DialogRelink`)                                                                         | "…you registered your phone number with SWARM Messenger on a different device."      | "…your wallet signed in to SWARM Messenger on another computer."                                                         |
| Call-link lobby (`state/smart/CallManager.preload.tsx`)                                                    | "…will see your name, photo, and phone number." when sharing was "Everybody"         | "…will see your name and photo." for a SWARM account                                                                     |
| Chat notice "number belongs to" (`getStringForPhoneNumberDiscovery`, message selector)                     | "+888 108 664 42360 belongs to {name}"                                               | "This chat is with {name}." (with the shared group when there is one)                                                    |
| Merged-chat notice                                                                                         | "…and their number +888… has been merged."                                           | upstream's no-number wording                                                                                             |
| Legacy group "left" notice, a contact card for an unknown identifier (`findAndFormatContact`)              | the raw identifier                                                                   | "Unknown contact" / the placeholder contact                                                                              |

Strings added (English only): `icu:SwarmAccount--fallback-title`,
`icu:SwarmContactSearchPlaceholder`, `icu:SwarmProfileEditor--info--no-username`,
`icu:SwarmUsernameOnboardingModalBody__row__username__body`,
`icu:SwarmUsernameMegaphone__body`, `icu:SwarmUnregisteredWarning`,
`icu:SwarmPhoneNumberDiscovery--notification--withSharedGroup` and
`--noSharedGroup`. The upstream keys they replace are no longer used.

Deliberately unchanged:

- **The data and the protocol.** The identifier, its derivation, what the
  server, the storage service and contact discovery receive, the stored privacy
  settings. The checks that decide data (`canHaveUsername`, `hasNumberTitle`,
  `hasUsernameTitle`, which decide which usernames are kept locally and written
  to storage-service contact records, and when a title-transition notice is
  added) still see the number, through a private `hasNumber`, exactly as
  upstream. A consequence: a contact whose identifier is shared to you and who
  has no profile name keeps no username (upstream clears it once a number is
  known), so they show as "SWARM account 1a2b". Keeping the username for them
  would change what goes into storage-service records; that is a separate
  decision.
- **Upstream's phone-number code** stays in the tree behind
  `SWARM_FIND_BY_PHONE_NUMBER` (off), the Find-by-phone-number pane
  (`LeftPaneFindByPhoneNumberHelper`, now unreachable) and the Phone Number
  privacy page, to keep merges small.
- **The standalone phone-number registration** (`PhoneNumber`, `VerificationCode`,
  captcha stages). Not reachable: `startRegistration` starts at the wallet stage
  and nothing moves to `PHONE_NUMBER` (only the Storybook stories do). Left as is.
- **Screens that cannot occur for SWARM accounts:** "{name} changed their phone
  number" (the identifier comes from the identity key and never changes), the
  merged-chat explainer dialog ("you learned this number belongs to…"; it opens
  only when the old chat had a name). **Key transparency** texts ("for people
  you're connected to by phone number") appear only when the server's remote
  configuration enables `desktop.keyTransparency.*`.
- **Real phone numbers that are content:** numbers inside a shared contact card,
  `signal.me/#p/<number>` links.

Tests: `ts/test-node/swarm/swarmIdentityE164_test.std.ts` (the shape, the short
id, the switch), `ts/test-node/swarm/noPhoneNumberInUi_test.preload.ts` (the
formatter, titles and the label, the unchanged data checks, the discovery notice,
the composer rows), one case added to `walletIdentity_test.node.ts` (every
derived identifier is recognised); `LeftPaneComposeHelper_test` and
`LeftPaneChooseGroupMembersHelper_test` now expect no phone-number rows.

## 3k. Debug log stays on this computer (B5)

2026-09-29, from the B2c review: "Submit debug log" uploaded the log to
Signal's `https://debuglogs.org` and showed the link. Nothing may be sent
anywhere; the owner wants the log saved on the user's PC instead.

| What                                                                                                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload                                                                                                                              | `ts/logging/uploadDebugLog.node.ts` and its test are deleted, with the `DebugLogs.upload` IPC handler (`app/main.main.ts`), the window's `uploadLogs` (preload, `ts/window.d.ts`) and the `form-data` dependency only it used. `debuglogs.org` is gone from the link-preview exclusions (`ts/types/LinkPreview.std.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Debug log window (`ts/components/DebugLogWindow.dom.tsx`)                                                                           | Title "Debug log"; "This log stays on this computer. Nothing is sent anywhere. If support asks for it, save it to a file and attach the file yourself."; buttons Close, Copy (the log text, not a link), **Save to file** (primary). The Submit button and the success screen with the uploaded URL and "Contact Support" are gone. Toasts: saved, copied, error.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Saving (`'show-debug-log-save-dialog'`)                                                                                             | Now answers the window (saved / canceled / error), opens over the debug log window and suggests `swarm-messenger-debug-log-<yyyy-mm-dd>.txt` (`ts/util/swarm/debugLogFile.std.ts`), plain text as before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Menu (`app/menu.std.ts`)                                                                                                            | **View > Save debug log…** (was "Debug Log"; the item has always been in View, not Help).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Call-quality survey (`ts/state/ducks/calling.preload.ts`), key-verification error dialog (`KeyTransparencyErrorDialog.preload.tsx`) | Both uploaded the log and sent the link (to the survey, or to the support page). With the box ticked they now open the debug log window, in `save` mode so it stays open after the dialog closes; the survey carries `debugLogUrl: null`, the support page opens without a link. The window's modes are now `save` and `close` (`close`: belongs to a dialog and closes with it); both look the same.                                                                                                                                                                                                                                                                                                                                                                                              |
| Crash reports (`app/crashReports.main.ts`)                                                                                          | Already local (`uploadToServer: false`): "Add to debug log" writes the dumps into the log and opens the debug log window, where they can be saved. The module filter keeps `swarm` binaries too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Strings (English)                                                                                                                   | New `icu:SwarmDebugLog__menu`, `__explanation`, `__copy`, `__copied`, `__saved`, `__error`. Deleted from every locale: `icu:submitDebugLog`, `icu:debugLogExplanation`, `icu:debugLogExplanation--close`, `icu:debugLogSuccess`, `icu:debugLogSuccessNextSteps`, `icu:debugLogLinkCopied`, `icu:debugLogError`, `icu:debugLogCopy`, `icu:reportIssue`. Reworded in English only ("submit/share" became "save"): `icu:debugLog`, `icu:debugLogSave`, `icu:debugLogLogIsIncomplete`, `icu:Toast--error--action`, `icu:DebugLogErrorModal__SubmitDebugLog`, `icu:ErrorBoundaryNotification__text`, `icu:TransportError`, `icu:DonationsErrorBoundary__DonationUnexpectedError`, the two call-survey and two key-verification debug-log strings, `icu:CrashReportDialog__body`, `__submit`, `__erase`. |
| Storybook                                                                                                                           | The emoji search index and the large emoji font load from `static.swarm.green` (the app's own mirror), not `updates2.signal.org` / `updates.signal.org`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Checks                                                                                                                              | `noSignalEndpoints_test.node.ts` also rejects `debuglogs.org` and `textsecure-service`, checks that every Signal host a client reaches (updates, updates2, sfu.voip, cdn\*, storage, chat, support…) is caught, and now scans `stylesheets/`, `sticker-creator/`, `.storybook/`, `protos/` and the window pages; the protobuf `java_package` lines are allowed (a package name, not a host). New `debugLogStaysLocal_test.node.ts`: file name, no upload names left in `app/` or `ts/`, the window's IPC channels, the window's strings, the deleted keys.                                                                                                                                                                                                                                         |

Not changed: other languages still carry their old translations of the
reworded strings (for example "Send" on the crash dialog); they are replaced
with the other locales. Left for the owner: `ts/util/signalRoutes.std.ts`
still builds PayPal return URLs on `signaldonations.org` (donations have no
entry point). The sticker creator's share link
(`sticker-creator/src/selectors/art.ts`) is on swarm.green since B3 (section
3i). Outside the app: `.github/` issue templates and `FUNDING.yml`,
the reproducible-build workflows (they download Signal's apt key), upstream
package metadata under `packages/`, and `scripts/get-emoji-locales.mjs` /
`scripts/get-jumbomoji.mjs` (guarded at run time by `refuseSignalUrl`) still
name Signal hosts.

## 3l. Recovery phrase export (B6)

2026-09-29: a person who is signed out, or moves to another computer, gets
back into their account only with the 24 words. The words were shown once, at
sign-up. The Wallet tab can now show them again, and copy them or save them to
a file. This is the one place where the words go from the main process to a
window after sign-in; everything else keeps the rule of section 5 ("the
renderer never receives a seed").

| What                                                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet tab (`ts/components/SwarmWalletPane.dom.tsx`, `ts/state/smart/SwarmWalletTab.preload.tsx`)         | A "Recovery phrase" card while a wallet is open (ready, or offline with a balance): "Your 24 recovery words are this account and the money in this wallet: anyone who has them owns both." and **Show recovery phrase**. The button calls `swarm-wallet:reveal-recovery-phrase` (`ts/services/swarmWallet.preload.ts`), whose answer is only "opened" or a refusal, never the words.                                                                                                                                                                    |
| Local confirmation (`app/SwarmRecoveryPhraseExport.main.ts`)                                              | macOS: `systemPreferences.promptTouchID` when `canPromptTouchID()`; cancelled or failed means nothing opens. Windows: Windows Hello through the existing `@signalapp/windows-ucv` addon (`promptOSAuth`, the check upstream uses before it shows a backup key) when the addon is built and a verification device exists. Everywhere else, and on a Mac or PC without either: the person types `reveal` in the window, and the main process refuses the words until 3 seconds after the window opened (`ts/util/swarm/recoveryPhraseGate.node.ts`).      |
| Reveal window (`app/main.main.ts` `createSwarmRecoveryPhraseWindow`, `swarm_recovery_phrase.html`)        | 560 × 660, beside the About and Licences windows: modal to the main window, always on top, not resizable, no taskbar entry, no menu, `devTools: false`, sandboxed, context-isolated, no navigation (`handleCommonWindowEvents`), no webviews, a CSP with no network. `setContentProtection(true)` before it is drawn and again when shown, and kept on when the screen-security setting is switched off while it is open. Closes itself 2 minutes after it opened and again 2 minutes after the words are shown, with a countdown.                      |
| The words' path (`ts/types/SwarmRecoveryPhrase.std.ts`, `ts/windows/swarmRecoveryPhrase/`)                | Worker request `'seed-phrase'` (`ts/workers/swarmWalletProtocol.std.ts`, `swarmWalletHandler.node.ts`) reads `seedPhrase()` from swarm-wallet-core, checks it as a 24-word BIP-39 phrase, normalizes it and answers UTF-8 bytes in a transferred buffer. `SwarmWalletService.readRecoveryPhrase` refuses words that do not derive the signed-in account's key. The export sends them on `swarm-recovery-phrase:phrase` to the reveal window's webContents only, once, while armed, and zeroes its bytes as they are sent; it then keeps only a SHA-256. |
| Copy, Save to file, Close (`ts/components/SwarmRecoveryPhraseWindow.dom.tsx`)                             | Words numbered 1-24, three columns, monospace, lower case. **Copy**: `clipboard.writeText`, cleared 60 s later if it still holds the words (and at quit), and the window says so. **Save to file**: a confirmation that the file is plain text, then `dialog.showSaveDialog` (default `Documents/swarm-messenger-recovery-phrase.txt`, `.txt` filter), then a file with a `# …NOT encrypted…` warning line, a blank line and the words, mode 0600. Copy and save act only on the exact words the window was shown (compared by hash).                   |
| Sign-in (`ts/components/standaloneRegistration/stages/WalletSignIn.dom.tsx`, `recoveryPhraseText.std.ts`) | "Restore a wallet" and the Wallet tab's restore form accept the whole saved file: `#` lines are dropped, the rest joined, then `checkRecoveryPhrase` as before (`phraseToSignInWith`).                                                                                                                                                                                                                                                                                                                                                                  |
| Logs                                                                                                      | Outcomes only ("the words were shown", "save: written"), never the words or the file path. `redactForLog` (`ts/util/swarm/walletIpc.node.ts`) also replaces any run of six or more BIP-39 words.                                                                                                                                                                                                                                                                                                                                                        |
| Strings                                                                                                   | English only: `icu:SwarmWallet__recovery--*` (34 strings, each with a description).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tests                                                                                                     | `ts/test-node/swarm/recoveryPhraseExport_test.node.ts` (throwaway phrase → wallet restored offline → closed, reopened → `'seed-phrase'` answers the same normalized words and identity; the saved file signs in as the same account), `recoveryPhraseGate_test.node.ts` (one window, once, word and wait, zeroing, clipboard), `SwarmRecoveryPhraseWindow_test.preload.tsx` (the window's screens; the saved file through the sign-in stage's `phraseToSignInWith`), `SwarmWalletPane_test.preload.tsx` (the card).                                     |

**Threat model.** What this protects against:

- **A compromised main window** (for example script injected through a
  message): it can ask for the window to open, but the words go only to the
  reveal window's own webContents, whose page loads nothing from the network,
  and only after the person confirmed locally. It cannot ask twice.
- **Someone at an unlocked computer, in passing**: Touch ID or Windows Hello
  where the computer has them. The typed word and the 3-second wait elsewhere
  are a deliberate pause, **not authentication**: anyone at the keyboard can
  type `reveal`.
- **Screenshots, screen recording and screen sharing** on macOS and Windows
  (content protection; the window shows black). A phone camera pointed at the
  screen is not stopped by anything.
- **Words left behind**: the window closes itself after two minutes; the
  clipboard is cleared after a minute if it still holds them; the main process
  zeroes its bytes and keeps a hash; no log line carries them.

What it does not protect against, on purpose or because it cannot:

- **Malware running as the person.** It can read the wallet file key from the
  OS keychain, read process memory, log keystrokes or read the saved file.
  Nothing in an Electron app stops that.
- **Linux screen capture.** Electron's content protection does nothing on
  Linux.
- **Clipboard history and sync** (Windows' Win+V history and cloud clipboard,
  clipboard managers) may keep their own copy for longer than the minute.
- **The saved file is plain text.** Anyone who opens it owns the account and
  the money; the window says so before it writes, and the file's first line
  says so again.
- **JavaScript strings cannot be wiped.** The bytes the main process and the
  preload hold are zeroed; the strings the wallet library and the page make
  are dropped and left to the garbage collector.

Deliberately not done:

- **Windows Hello on builds without the `@signalapp/windows-ucv` addon.** A
  machine built without Visual Studio (the owner's PC, section 1) has no addon,
  and falls back to the typed word. Proper OS confirmation on every Windows
  build is a proposal: it needs that native module built for release (the CI
  installers) or another native module; no OS API is simulated.
- **Linux OS confirmation.** `promptOSAuth` can ask polkit (`pkcheck`), but only
  once a polkit action is installed by the package, which the AppImage cannot
  do. Left for a packaging change.
- **Hold-to-reveal.** The typed word was chosen; the 3-second wait applies to
  it.
- **An encrypted export, a QR code, printing, other languages, showing the words
  in the main window.** None of these was asked for; each is a separate owner
  decision.

## 3m. Version 0.1.2: the rebrand release

2026-09-29, owner decision ("in the messenger app you still have signal hints.
Need to be all changed."): `package.json` `version` becomes `0.1.2`. This
release carries sections 3h to 3l: no Signal in menus, metadata or the About
window (B2c); every language says SWARM Messenger (B1); username, group and
sticker links on swarm.green with the SWARM mark in every QR code (B3); no
phone number in the interface (B4); the debug log stays on this computer (B5);
and the recovery phrase export from the Wallet tab (B6). Installed 0.1.0 and
0.1.1 keep working against the same server; the update is a manual download,
as before (`docs/RELEASES.md`).

## 3n. Version 0.1.3: the recovery phrase while the wallet is busy

2026-09-30. In 0.1.2 the owner opened the Wallet tab, asked for the recovery
phrase twelve seconds after the wallet opened, confirmed with Windows Hello,
and was told "The words could not be read from your wallet". The log showed
`readRecoveryPhrase: not read (timeout: seed-phrase took too long)`, at the same
moment as the pane's own `server` and `snapshot` requests timing out
("offline"); the light server answered again 45 seconds later. It was not the
check that the words are the signed-in account's: the read never answered.

**Why the read waits.** The words are not kept anywhere; they are read from the
wallet addon each time (`SwarmWallet.seedPhrase()` → addon `get_seed`). That
read goes through two queues it cannot jump:

- the wallet worker answers one request at a time, in arrival order
  (`ts/workers/swarmWalletWorker.node.ts`), so it starts only after the pane's
  `server` and `snapshot` requests that are ahead of it have answered;
- inside the addon (swarm-wallet-core 0.2.0, `native/src/lib.rs`), `get_seed`
  takes the light client's shared lock and the wallet's read lock.
  `info_server` (the pane's `server` request) holds the light client's
  **exclusive** lock across its request to the light server, and a running
  sync (pepper-sync, `sync.rs`) holds the wallet's write lock across several of
  its requests to the light server.

So a slow light server, or a sync that is waiting for one, holds the read for
as long as the server takes, and every quick call - the phrase included - gets
fifteen seconds. Measured on 2026-09-30 with the 0.2.0 Windows addon, a
throwaway wallet and the mainnet light server: `seedPhrase()` alone answers in
0 ms; started together with `serverInfo()` it answers when that does, every
time (70-163 ms on a responsive server).

**Change.** No cryptography, no wallet-core change, no new request to the
worker, and the words are still not cached anywhere.

| What                                                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The wait (`ts/util/swarm/recoveryPhraseRead.std.ts`)                           | A wallet that is not busy still gets the old 15 s, and a read that has not answered by then is still "could not be read". A **busy** wallet - a sync known to be running, or requests still in the worker ahead of the read - is waited for up to **3 minutes** in all; after 1.5 s without an answer the window is told it is busy. Past 3 minutes the answer is `busy`. Words that arrive after the read gave up are zeroed.                                                   |
| Wallet service (`app/SwarmWalletService.main.ts`)                              | Knows whether a sync is running (set when one is started, then from every snapshot) and which worker requests are still unanswered, including those whose caller already gave up. `readRecoveryPhrase` answers the bytes or a refusal, `busy` or `unreadable`; the account-match check and the zeroing are unchanged. A byte answer that reaches the service after its call timed out is zeroed instead of being dropped.                                                   |
| Export and window (`app/SwarmRecoveryPhraseExport.main.ts`, the reveal window) | One new main → window message, `swarm-recovery-phrase:busy`, with no payload, sent only to the armed reveal window's own webContents. The window shows "Your wallet is busy syncing. The words appear as soon as it is free." with **Cancel**; the words appear by themselves. The window stays open for the wait (3 minutes plus its usual 2). A wallet that stays busy: "Your wallet is still busy syncing, so the words could not be read yet. Nothing was shown. Close this window and try again when the Wallet tab says “Up to date”." |
| Strings                                                                        | `icu:SwarmWallet__recovery--busy`, `icu:SwarmWallet__recovery--busy-too-long`, English only (other languages fall back to English).                                                                                                                                                                                                                                                                                                                                          |
| Tests                                                                          | `ts/test-node/swarm/recoveryPhraseBusy_test.node.ts` (the real handler and wrapper with a fake addon whose `get_seed` is slow, limits scaled down: read while syncing past the old limit; `busy` after the bound; a real failure at once; the old failure when not busy; late words zeroed; no logger in the wait or the worker, no interpolated words in the service's log lines), `SwarmRecoveryPhraseWindow_test.preload.tsx` (the waiting and busy screens).     |

**Not changed, noted.** The Wallet tab still reads a `server` request that
times out as "offline". With `info_server` holding the exclusive lock across its
own request to the light server, such a timeout is, in the first place, a light
server that did not answer in 15 seconds, so "offline" is not wrong; a
contended lock can add to it. Whether a timeout during a sync should read as
"syncing" rather than "offline" is left for a decision.

`package.json` `version` becomes `0.1.3`.
