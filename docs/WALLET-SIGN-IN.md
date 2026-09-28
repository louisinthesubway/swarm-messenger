# Wallet sign-in: no phone number, no SMS (desktop side)

**Status: implemented, wave 1.** Written 2026-09-27 by Opus M-F. The server half of the same protocol
is documented in `Swarm-Official/swarm-messenger-server`, `docs/WALLET-SIGN-IN.md`; read that one for
the server's reasoning, the `+888` choice and the threat notes. This one is about the app.

The owner's decision, 2026-09-27: _"instead of a phone number make the users sign in with our
wallet."_

---

## 1. What a person now sees

"Create account on this computer" no longer asks for a phone number, a captcha or a code. It asks one
question: **create a new wallet, or restore one from its recovery phrase?**

- **Create a wallet** → 24 words appear, numbered, once. A checkbox confirms they have been written
  down. Continue, and the account exists.
- **Restore a wallet** → type the 24 words. The same words give the same account, on this machine or
  any other.

Then the existing profile screen (name, avatar), and that is the end of registration. **There is no
PIN step**: a SWARM account's recovery is its recovery phrase, and there is no SVR to put a PIN in.

Nothing ever shows the synthetic `+888…` identifier the account is keyed by. People are found by
username; finding by wallet address is wave 2.

---

## 2. What happens underneath

```
recovery phrase (24 BIP-39 words)
   │  PBKDF2-HMAC-SHA512(NFKD(phrase), "mnemonic", 2048)  → 64-byte BIP-39 seed
   ├── HKDF-SHA256(seed, "SWARM-Messenger-ACI-identity-v1") → clamp → ACI identity key pair
   ├── HKDF-SHA256(seed, "SWARM-Messenger-PNI-identity-v1") → clamp → PNI identity key pair
   └── the SWARM wallet's own spending keys (the wallet's code, not this app's)

POST /v1/swarm/registration/challenge  { identityKey }           → { challenge, ttlSeconds }
POST /v1/swarm/registration/verify     { identityKey, signature } → { number, registrationPassword }
POST /v1/registration                  (Signal's own endpoint, unchanged)
```

The signature is over `"SWARM-Messenger-wallet-registration-v1" || identityKey || challenge`, made
with libsignal's own `PrivateKey.sign`. The account identifier is
`+888` then `10^10 + (high 8 bytes of SHA-256("SWARM-Messenger-e164-v1" || identityKey) mod 9·10^10)`,
which the server derives independently and refuses to disagree about.

**One recovery phrase for the money and the identity.** The phrase is a standard BIP-39 phrase, so the
same words open the SWARM wallet - that is what makes "restore" restore everything.

### No new cryptography

| Step            | Whose code                                                      |
| --------------- | --------------------------------------------------------------- |
| BIP-39 checksum | Node's `crypto.createHash('sha256')`                            |
| BIP-39 seed     | Node's `crypto.pbkdf2Sync(..., 'sha512')` - BIP-39 as specified |
| key stretching  | `hkdf` from `@signalapp/libsignal-client`                       |
| key types       | libsignal's `PrivateKey` / `IdentityKeyPair`                    |
| the signature   | libsignal's XEdDSA (`PrivateKey.sign`)                          |

libsignal itself is untouched, as are the protocol, the session establishment and the message
encryption. The wallet's Rust addon is untouched.

---

## 3. The code

New:

| File                                                                                      | What                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ts/util/swarm/bip39.node.ts`                                                             | generate, check and normalize a 24-word phrase; the BIP-39 seed                                  |
| `ts/util/swarm/bip39Wordlist.std.ts`                                                      | the 2048-word English list, verbatim from the BIP-39 specification, its digest checked by a test |
| `ts/util/swarm/walletIdentity.node.ts`                                                    | the ACI/PNI derivation, the account identifier, the challenge message and signature              |
| `ts/components/standaloneRegistration/stages/WalletSignIn.dom.tsx`                        | the one new screen (choose / write down / restore)                                               |
| `ts/test-node/swarm/bip39_test.node.ts`, `ts/test-node/swarm/walletIdentity_test.node.ts` | the tests                                                                                        |

Changed:

| File                                                                                                                                  | Change                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts/types/StandaloneRegistration.std.ts`                                                                                              | the `WALLET_SIGN_IN` stage, its statuses, its place in the stage graph; `PROFILE_ENTRY` may now complete registration                                                                                       |
| `ts/state/ducks/standaloneInstaller.preload.ts`                                                                                       | `startRegistration` starts at the wallet stage; four new actions (`createWalletForSignIn`, `enterRecoveryPhrase`, `backToWalletChoice`, `signInWithWallet`); the PIN stages are skipped for a SWARM account |
| `ts/textsecure/WebAPI.preload.ts`                                                                                                     | the two new endpoints; `createAccount` takes a session **or** a registration password and, without a session, calls libsignal's `RegistrationService.reregisterAccount`                                     |
| `ts/textsecure/AccountManager.preload.ts`                                                                                             | `registerAsPrimaryDevice` accepts the derived identity key pairs instead of generating random ones, and takes the new `verification`                                                                        |
| `ts/components/standaloneRegistration/StandaloneRegistration.dom.tsx`, `ts/state/smart/StandaloneRegistration.preload.tsx`, the story | render and wire the new screen                                                                                                                                                                              |
| `_locales/en/messages.json`                                                                                                           | 19 new strings, all `icu:StandaloneRegistration--WalletSignIn--…`                                                                                                                                           |

The phone number, captcha and verification-code stages are **left in place and unreached**. They are
the upstream flow; deleting them would make every future merge from upstream harder for no gain, and
an ordinary phone number still registers through them if a deployment wants that.

### The one place we reach into a dependency

libsignal's session-less registration is a static, `RegistrationService.reregisterAccount(options,
inputs)`, and `options` is the `{ tokioAsyncContext, connectionManager }` pair that `Net` builds for
its own registration calls but does not expose. `WebAPI.preload.ts` reads that pair off the `Net` we
already have rather than constructing a second `Net` (which would mean two connection managers, two
tokio runtimes, and two sets of proxy and censorship settings that could drift apart). It checks both
fields are present and throws a named error if they are not, so a libsignal upgrade that renames
either one fails loudly at sign-in instead of somewhere unrecognizable. If that ever happens, the
alternative is to post `/v1/registration` directly from `WebAPI`.

---

## 4. What the phrase is allowed to touch

- It is read from the screen, turned into keys, and dropped by this code. It is **not** put in the log
  and **not** sent over the network.
- Since M3 wave 1 it is also handed, once, to the SWARM wallet in this app's main process
  (`adoptWalletPhrase`), which creates the wallet from it. From then on the seed lives where every
  wallet keeps it: inside the wallet file, sealed with a key from the OS keychain. See
  `docs/WALLET-PANE.md`.
- It sits in the registration workflow's redux state only while the "write these down" screen is
  showing it, because nothing else can put it in front of a person. Nothing in this app writes redux
  state to a log.
- The derived seed is zeroed after use; the private keys go where Signal's own identity keys go, into
  the protocol store.
- What crosses the network is an identity **public** key and a signature.

---

## 5. Tests

```
pnpm run test-node:swarm     # 52 tests, including the pre-existing endpoint guards
```

- `bip39_test.node.ts` — the vendored wordlist's SHA-256 matches BIP-39's published `english.txt`; all
  four of BIP-39's own 24-word test vectors; 32 generated phrases are valid and distinct; wrong word
  count, unknown word, bad checksum and empty phrase all refused with the right reason; capitals,
  padding and tabs forgiven; the seed is 64 bytes and independent of how the phrase was typed.
- `walletIdentity_test.node.ts` — three derivation vectors that the **server's own test carries
  byte-for-byte**; the same answer however the phrase was typed; ACI and PNI keys differ; distinct
  phrases give distinct accounts; the clamped private key round-trips through libsignal unchanged; the
  identifier's shape, and eight things that are not identifiers; the identifier recomputed by hand;
  the signed message byte-for-byte; a signature does not answer a different challenge, and a
  signature made with another key does not verify.
- `tsc --noEmit` is clean apart from one pre-existing, unrelated error (`fs-xattr`, a macOS-only
  optional dependency).

### Proven in the running app

The flow was driven end to end in the real desktop app on 2026-09-27 (instance A,
`D:\swarm-messenger\.tools\Start SWARM Messenger A.cmd`), through Electron's own DevTools protocol.
The app's log, `D:\swarm-messenger\.profiles\a\logs\app.log`:

```
[ducks/standaloneInstaller] createWalletForSignIn: generating a recovery phrase
[ducks/standaloneInstaller] signInWithWallet: derived an identity; asking for a challenge
[WebAPI] POST (WS) https://chat.swarm.green/v1/swarm/registration/challenge (unauth)
[WebAPI] POST (WS) https://chat.swarm.green/v1/swarm/registration/challenge (unauth) 0 Error
[ducks/standaloneInstaller] signInWithWallet: network HTTPError -1
```

So, in the packaged renderer and not only in a test: the wallet screen replaces the phone number
screen, a real BIP-39 phrase is generated and shown as 24 numbered words, ticking the box and
continuing derives the identity key pair and sends the challenge request to the SWARM server, and
when the server cannot be reached the person is told so and can try again. Screenshots in
`D:\swarm-messenger\evidence\m-f\`: the wallet choice, the failure, and the restore screen.

**The screen showing the 24 words was deliberately not kept**, here or anywhere: it is a real
recovery phrase, and a recovery phrase does not belong in evidence, a log or a commit.

**What is still not proven** is everything past that request, because `chat.swarm.green:443` was
closed while this was written - the TLS edge waits on the owner's Let's Encrypt contact address.

### What remains to prove, in order, the moment 443 answers

1. Instance A → "Create a wallet" → write the words down → account created, profile screen, inbox.
2. Instance B → "Create a wallet" again (a different wallet) → second account.
3. A message from A to B and back.
4. Then: "Restore a wallet" with A's phrase in a third profile directory, and confirm it lands on the
   same account rather than a new one.

---

## 6. Wave 2

- Find by SWARM wallet address (server maps an address hash to an ACI, as it already does for username
  hashes) and a username suggested from the wallet.
- ~~Mount `swarm-wallet-core` in the main process with the phrase from sign-in~~ - done in M3 wave 1
  (`docs/WALLET-PANE.md`): the Wallet pane opens the wallet the account was derived from.
- ~~Confirm that a phrase generated here is accepted by the addon's `init_from_seed`~~ - done on
  2026-09-27: a phrase generated by this screen opened a mainnet wallet through the real addon.
