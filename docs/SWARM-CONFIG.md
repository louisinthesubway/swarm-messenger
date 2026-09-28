# SWARM Messenger — configuration

Last updated 2026-09-27 (M2, Opus M-E).

This is the one place that says where SWARM Messenger points, what is still a
placeholder, and how to fill it in. If you change an endpoint, change it here too.

## The files

| File                                                   | When it is used                                                                 | What it holds                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `config/swarm-staging.json`                            | Source of truth. Not loaded directly.                                           | The canonical SWARM endpoint set.                                                              |
| `config/default.json`                                  | Always, as the base layer.                                                      | The same endpoints as `swarm-staging.json`, plus the non-endpoint defaults upstream kept here. |
| `config/production.json`                               | Every **packaged** build (a packaged app always reports `NODE_ENV=production`). | The same endpoints again.                                                                      |
| `config/staging.json`, `config/development.json`       | `NODE_ENV=staging` / `development`.                                             | Only `storageProfile` and `openDevTools`; endpoints come from `default.json`.                  |
| `config/local-development.json`, `config/local-*.json` | Local overrides. **Git-ignored.**                                               | Put a private root certificate or a loopback `serverUrl` here.                                 |

`node-config` picks a file by `NODE_ENV`, and `swarm-staging` is not a valid
`NODE_ENV` (`ts/environment.std.ts` allows `development`, `production`, `staging`,
`test`). That is why the endpoint values are repeated rather than imported.
`ts/test-node/swarm/endpointGuard_test.node.ts` fails if the three files drift
apart, so the duplication cannot rot silently.

Staging and production currently point at the **same** host, because SWARM has one
chat server. When a separate production server exists, change
`config/production.json` and relax the "must match" assertion in that test.

## The endpoints

| Key                        | Value                                                           | Used by                        |
| -------------------------- | --------------------------------------------------------------- | ------------------------------ |
| `serverUrl`                | `https://chat.swarm.green`                                      | chat API and websocket         |
| `storageUrl`               | `https://chat.swarm.green`                                      | storage service (see below)    |
| `cdn.0`, `cdn.2`, `cdn.3`  | `https://cdn.chat.swarm.green`                                  | attachments, stickers, backups |
| `sfuUrl`                   | `https://sfu.chat.swarm.green/`                                 | group calls                    |
| `challengeUrl`             | `https://chat.swarm.green/challenge/generate.html`              | rate-limit captcha             |
| `registrationChallengeUrl` | `https://chat.swarm.green/challenge/registration/generate.html` | registration captcha           |
| `contentProxyUrl`          | `https://contentproxy.chat.swarm.green`                         | link previews                  |
| `updatesUrl`               | `https://static.swarm.green/desktop`                            | see "updates" below            |
| `resourcesUrl`             | `https://static.swarm.green`                                    | optional resources             |

The hostnames are the owner's decision of 2026-09-26 and are final. They resolve:
`chat.swarm.green`, `cdn.chat.swarm.green`, `reg.chat.swarm.green` and
`sfu.chat.swarm.green` all point at the staging host `64.95.11.180`. DNS
resolving is not the same as the client being able to talk to it: as of
2026-09-27 the client can (see "The libsignal network environment" below), and
what is left is the host's own TLS edge and services.
`reg.chat.swarm.green` is **reserved but not published**: the server's
`endpoints.registration` is `null` on purpose, and the desktop does not have a
separate registration endpoint anyway (registration goes through `serverUrl`).

### Why `storageUrl` is the chat host

The staging server runs no separate storage service, so there is no
`storage.chat.swarm.green` to point at, and the owner chose the chat host. What
the desktop does when the storage service does not answer: storage requests are
ordinary HTTPS to `storageUrl` + `/v1/storage/…`
(`ts/textsecure/WebAPI.preload.ts`, the `storageService` host case). A 404 on the
manifest is read as "no manifest yet" and a new one is created
(`ts/services/storage.preload.ts`); anything else is logged as an error and the
sync is retried. **Messaging keeps working** — what breaks is the sync of
contacts, groups and settings between a user's own devices, with a repeating
error in the log. Change this the moment a storage service exists.

All three CDN numbers are the same host on purpose: Signal's cdn0/cdn2/cdn3 are
storage generations, and one staging host serves them all because the paths
already differ (`/attachments/…`, `/stickers/…`). If the SWARM server ever needs
to tell them apart, give each a path prefix (`/cdn0`, `/cdn2`, `/cdn3`) — the
client only concatenates, so a prefix works (`ts/textsecure/WebAPI.preload.ts`,
`cdnUrlObject`).

## The server-generated parameters

These four values are generated by the chat server and cannot be invented:

- `serverPublicParams`
- `genericServerPublicParams`
- `backupServerPublicParams`
- `serverTrustRoots` (an array)

**They are wired in as of 2026-09-27** (M2), from
`shared/staging-public-params.json` generated by the staging host at
`2026-09-27T00:25:05Z`, schema `swarm-messenger/staging-public-params/1`. No
`SWARM-PLACEHOLDER-` string is left in `config/`, so the startup guard no longer
refuses and `SWARM_ALLOW_PLACEHOLDER_CONFIG` is no longer needed. The zkgroup test
in `test-node` now decodes `serverPublicParams` from `default.json`,
`production.json` and `swarm-staging.json`, which is the proof that they are real
values and not merely non-placeholder strings.

Every one of these is a **public** parameter: a public zkgroup parameter set and a
public sealed-sender trust root. Nothing secret is in `config/`.

**If the server is rebuilt, its parameters change, and wiring them in again is one
command:**

```
node scripts/swarm-import-params.mjs
```

It reads `D:\swarm-messenger\shared\staging-public-params.json` — the file the
server fork writes, in the format documented in that repo's `docs/STAGING.md`
section 5a — validates it, and writes the values into all three of
`config/swarm-staging.json`, `config/default.json` and `config/production.json`,
keeping them identical. Then run `pnpm run test-node`: the assertions in
`ts/test-node/swarm/endpointGuard_test.node.ts` are what tell you the job is done,
and the zkgroup test starts verifying `serverPublicParams` again the moment it
stops being a placeholder.

Which server key set each field pairs with matters, because the desktop verifies
credentials against them:

| Desktop field               | Verifies                                                                                                                                                     | Server config                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `serverPublicParams`        | group auth, profile key and receipt credentials, group send endorsements                                                                                     | `groupsZkConfig`                      |
| `genericServerPublicParams` | **calling** credentials: the call-link auth credentials that arrive with the group auth credentials (`groupCredentialFetcher`), create-call-link credentials | `callingZkConfig` (libsignal ≥ 0.101) |
| `backupServerPublicParams`  | backup credentials                                                                                                                                           | `chatZkConfig`                        |

So the server file's `callingServerPublicParams` is the same value as its
`genericServerPublicParams`. Until 2026-09-27 the server's generator put the chat set
in `genericServerPublicParams`; the desktop then rejected every call-link
credential (`Verification failure in zkgroup`), and because those arrive in the same
response as the group auth credentials, `groupCredentialFetcher` retried forever and
no group could be created. Fixed on the server side in swarm-messenger-server
`23a524ce1` and re-imported here.

Two fields are dropped on purpose: `callingServerPublicParamsPreV101` (credentials
for clients older than libsignal 0.101) and `registrationCaCertificatePem` (the
stack's internal CA for the chat server's own gRPC hop to the registration stub;
public HTTPS uses Let's Encrypt, so a client never needs it).

`serverTrustRoots` is a **list**, and stays one: a rotation publishes the new root
beside the old one so clients accept both during the overlap. The placeholder
check walks the list and names the offending index.

**While a placeholder is present the app refuses to start.**
`app/swarmStartupGuard.main.ts` runs before any window opens and shows a
plain-language dialog naming each one. For local development on an unpackaged tree
you can set `SWARM_ALLOW_PLACEHOLDER_CONFIG=1` to continue past it with a loud
warning in the log; a **packaged** build ignores that variable, so no installer can
bypass the check. That guard is dormant now that the real values are in, and it
stays in place for the next rebuild.

### `certificateAuthority`

Deliberately **absent**, which means the system certificate store is used. Upstream
pinned Signal's own CA here. Set it only when you talk to a server with a private
root — put the PEM in `config/local-development.json`, which is git-ignored.

## The libsignal network environment

**Resolved in M2.** The desktop runs the SWARM build of libsignal,
`@signalapp/libsignal-client` **0.101.2-swarm.2** (since 2026-09-27; M2 wired in
`0.101.2-swarm.1`), from
[Swarm-Official/swarm-libsignal](https://github.com/Swarm-Official/swarm-libsignal)
release `swarm-libsignal-0.101.2-swarm.2`. It adds two network environments beside
Signal's own:

| `Net.Environment` | Value | Chat host                      |
| ----------------- | ----- | ------------------------------ |
| `Staging`         | 0     | Signal's staging (never us)    |
| `Production`      | 1     | Signal's production (never us) |
| `Swarm`           | 2     | `chat.swarm.green`             |
| `SwarmStaging`    | 3     | `staging.chat.swarm.green`     |

The protocol crates are byte-for-byte upstream v0.101.2, so no cryptography
changed. Consumption guide: `D:\swarm-messenger\shared\libsignal-swarm.md`.

### How it is installed

The npm tarball from the release is vendored, git-tracked, at
`vendor/signalapp-libsignal-client-0.101.2-swarm.2.tgz` (29,900,330 bytes,
sha256 `3711e83fe42b991380bbb769e5afa7970708a8e9db9fde97634a54ce62ef1565`, which is
the value in the release's `SHA256SUMS.txt`). `package.json` points the dependency
at it with a `file:` specifier, so the import specifier
`@signalapp/libsignal-client` is unchanged and not one import line in the app
moved. The release is on a **private** repository, so a fresh clone that does not
carry the tarball has to fetch it with `gh release download` before `pnpm install`
— which is why it is committed rather than git-ignored.

`pnpm-workspace.yaml` `allowBuilds` carries the `file:` specifier as its key (the
repository sets `strictDepBuilds: true`, so every dependency with a lifecycle
script must be listed or `pnpm install` exits 1). libsignal's only lifecycle script
is an `echo`; the native library is a prebuild under
`prebuilds/<platform>-<arch>/`, so nothing is compiled here.

The three prebuilt libraries in the tarball hash to the per-platform sums in the
same release (`win32-x64` `3b233bbe…`, `linux-x64` `e872d670…`,
`darwin-arm64` `caa8d729…`); `vendor/SHA256SUMS.txt` lists all four.

**`0.101.2-swarm.2` vs `swarm.1`:** `Environment.Swarm` reaches `chat.swarm.green`
over **HTTP/2**, as upstream reaches its own chat host: the websocket opens as an
RFC 8441 extended CONNECT, and gRPC shares that connection. libsignal 0.101 sends
username reserve/delete, username links, device name, the linked-devices list and
the discoverability switch only over that gRPC connection, so with `swarm.1`
(HTTP/1.1) they panicked with `requires an H2 connection`. The server edge carries
it since swarm-messenger-server `885ec3aa6` (`docs/STAGING.md` section 5b). A
server that offers only HTTP/1.1 cannot be reached with `swarm.2`.

### Where the environment is chosen

`ts/util/swarm/endpointGuard.std.ts` → `describeLibsignalNetTarget()` maps a
`serverUrl` hostname to one of `signal-production`, `signal-staging`,
`swarm-production`, `swarm-staging`, `local-test-server` or
`unsupported-custom-host`. `ts/textsecure/preconnect.preload.ts` →
`resolveLibsignalNet()` acts on it: the two Signal answers throw, the two SWARM
answers return `Environment.Swarm` / `Environment.SwarmStaging`, a loopback URL
with a `certificateAuthority` returns the `localTestServer` configuration, and
everything else throws with the list of hosts that do work.

Two things about that function are deliberate and must not be undone:

- **The libsignal hostnames are compiled in.** `serverUrl` must be exactly
  `https://chat.swarm.green` or `https://staging.chat.swarm.green`. A sibling name
  such as `cdn.chat.swarm.green` is `unsupported-custom-host` on purpose: libsignal
  takes the chat host from its own tables, so a mismatch would send the websocket
  to one host and the REST API to another. A test asserts this.
- **There is no longer any path from `resolveLibsignalNet()` to a Signal host.**
  Upstream selected `Environment.Staging` from `isStagingServer()` — which returns
  true whenever `NODE_ENV=staging`, and that environment is _Signal's_ staging
  network — and fell back to `Environment.Production` for anything unrecognised.
  Both are gone. A loopback `serverUrl` with no `certificateAuthority` now throws
  instead of quietly becoming Signal production.

### What must stay switched off

libsignal's SWARM environment deploys no contact discovery (CDSI), no secure value
recovery (SVR2/SVRB), no key transparency and no censorship-circumvention proxies;
those endpoints are unreachable placeholders. Anything that calls them should be
feature-flagged off rather than left to fail at connect time. Consequence for M2:
**contact discovery does not work**, so a contact is added by phone number by hand
rather than found in an address book.

## Updates

`updatesEnabled` is `false` everywhere, every `publish` target in `package.json` is
empty, and Signal's NSIS mirror and update-signing keys (`updatesPublicKey`,
`appImageUpdatesPublicKey`) are gone. SWARM Messenger never checks for updates.

`updatesUrl` and `resourcesUrl` are still present and point at
`static.swarm.green`, because they are **not** only update feeds: Signal reuses
that host as a static asset host, and `ts/services/profiles.preload.ts`
(`getProfile`) asserts `updatesUrl` is a string on **every profile fetch**
(badge image URLs are built from it). Removing the key would break profile
fetching, so it points at a SWARM name instead. `static.swarm.green` does not
have to exist for the app to work; only badge images would 404.

The same applies to the Electron spellchecker dictionary host
(`app/updateDefaultSession.main.ts`), now `static.swarm.green`: dictionaries will
not download until someone mirrors them there. Open item.

## Donations

`stripePublishableKey` is gone from every config file and is optional in the
schema. The Donations settings page has no entry point any more
(`ts/components/Preferences.dom.tsx`), and the two Stripe calls in
`ts/textsecure/WebAPI.preload.ts` throw a plain message if anything ever reaches
them.
