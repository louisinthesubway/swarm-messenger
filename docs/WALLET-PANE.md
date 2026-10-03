# The Wallet pane (M3) and payments inside a chat (M3 wave 2)

**Status.** Wave 1, the pane: implemented and proven in the running app on SWARM mainnet,
2026-09-27 (Opus M3). Wave 2, payments inside a chat: implemented 2026-09-28 (Opus M3-W2); the
address exchange proven in two running instances on the SWARM **testnet**; the payment and its
notice tested by node tests only, the live testnet payment waiting for testnet coins (section 12).
Neither wave is reviewed yet. The one small real mainnet payment between the owner's two wallets
is the owner's to make (`OWNER-TEST-DESKTOP.md` section 10).

The pane opens from **Wallet** in the left navigation. It is the SWARM wallet, running in this
app's main process, opened from the same 24 words the account was created with.

---

## 1. What a person sees

| Part         | What it shows                                                                                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header       | "SWARM mainnet", the light server as host:port, and the chain height the light server reports, with "Up to date" / "Catching up: block X of Y" and "Chain checked" when the server stated the genesis this network is held to.                                                                               |
| Balance      | **Confirmed** (spendable now) and **Pending** (received, not yet spendable), in SWM with all eight decimals, from zatoshi as `bigint` (`ts/util/swarm/swmAmount.std.ts`). Never a float.                                                                                                                     |
| Receive      | The `swm1…` address in JetBrains Mono, a **Copy address** button and a QR code, with one sentence saying an address is not secret but links the payments made to it.                                                                                                                                         |
| Send         | To, amount in SWM, optional memo. **Review payment** asks the wallet for a quote and sends nothing. The confirmation screen names the address, amount, fee and total, warns that a payment cannot be undone, and only its **Send X SWM** button sends. The result shows the txid and a link to the explorer. |
| Transactions | Newest first: received / sent / unknown (an unknown kind is never shown as income), amount, block or "Not yet in a block", memo, and the txid linked to the explorer.                                                                                                                                        |

Explorer links: `https://mainnet.explore.swarm.green/transactions/<txid>` on mainnet,
`https://explore.swarm.green/transactions/<txid>` on testnet. Both checked by hand on 2026-09-27:
`/transactions/<txid>` answers 200 on both explorers and `/tx/<txid>` answers 404 on both.

States, each in plain words (`ts/components/SwarmWalletPane.dom.tsx`):

| State       | When                                                  | The pane says                                                                                                                                  |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| loading     | before the first answer                               | Opening your wallet…                                                                                                                           |
| opening     | the wallet is being opened or created                 | The first time can take a minute while it catches up.                                                                                          |
| no-wallet   | no wallet file for this account on this computer      | Type the 24 words you wrote down; words for another account are refused.                                                                       |
| offline     | the light server does not answer                      | Can't reach the SWARM network; your wallet is safe on this computer and chats keep working; tries again every 30 s. Last known balance if any. |
| unavailable | the build has no wallet addon                         | This build has no wallet component. Chats work as usual.                                                                                       |
| error       | wrong chain, an unreadable wallet file, anything else | One sentence per case, and **Try again**.                                                                                                      |
| ready       | open and answering                                    | Everything in the table above.                                                                                                                 |

**Developer settings** (never in a packaged release):

- The pane shows a Mainnet / Testnet switch when `app.isPackaged` is false. The choice is kept in
  `ephemeral.json` (`swarm-wallet-network`); `config` key `swarmWalletNetwork` sets the default.
  Switching reopens the same seed on the other network inside the worker.
- `config` key `swarmWalletServer` points the wallet at another light server, `https://host:port`
  only (anything else is ignored). This is how the offline state was proven:
  `NODE_CONFIG={"swarmWalletServer":"https://lwd-main.swarm.green:9"}`.

## 2. One recovery phrase for the account and the wallet

- **At sign-in** (`signInWithWallet` in `ts/state/ducks/standaloneInstaller.preload.ts`), right after the
  identity is derived and before the chat server is asked for anything, the phrase is handed to the
  wallet service once. The wallet does not need the chat server, so it does not wait for it. The
  service creates the wallet with `SwarmWallet.restoreFromSeed`: for a phrase generated moments ago
  the birthday is the light server's tip minus 100 blocks (nothing can have been paid to it earlier),
  for a restored phrase it is the network's activation height.
- **Which wallet is whose.** The wallet file is named from the account's ACI identity public key,
  which the phrase derives (`walletIdentity.node.ts`):
  `<userData>/swarm-wallet/<chain>/wallet-<first 32 hex of SHA-256("SWARM-Messenger-wallet-file-v1" ‖ key)>.dat.enc`.
  All accounts share one base directory and have a file each, because the addon's base directory is
  a OnceCell that can be set once per process and never changed.
- **After a restart** the pane sends the signed-in account's identity public key (public) and the
  service opens that file. If there is none - another computer, a deleted file - the pane asks for
  the 24 words, and the service refuses words that derive a different account (`wrong-phrase`).
- The same words restore the chat account (M-F) and the wallet, on any computer.

## 3. Architecture

```
renderer (main window, React)
  ts/state/smart/SwarmWalletTab.preload.tsx   polls every 3 s while shown
  ts/services/swarmWallet.preload.ts          ipcRenderer.invoke, answers parsed with zod
        │  'swarm-wallet:*'  (ts/types/SwarmWallet.std.ts)
        ▼
main process
  app/SwarmWalletService.main.ts              sender check, validation, quote, key, state
  ts/util/swarm/walletIpc.node.ts             the validators (pure, tested)
        │  postMessage  (ts/workers/swarmWalletProtocol.std.ts)
        ▼
worker thread of the main process
  ts/workers/swarmWalletWorker.node.ts        one request at a time
  ts/workers/swarmWalletHandler.node.ts       swarm-wallet-core 0.2.0 + the Rust addon
        │  gRPC over TLS
        ▼
  lwd-main.swarm.green:8443  (mainnet)   ·   lwd.swarm.green:443  (testnet)
```

**Why a worker thread, and not the main thread.** Several addon entry points are synchronous and
block the thread that calls them. The proof showed it: with the light server pointed at an
unreachable port, `init_from_b64` - opening an existing wallet file - dialled the server and blocked
for about 20 seconds before failing. On the main thread that is 20 seconds in which no window gets
an IPC answer, i.e. a frozen chat. In the worker, the main process answered an unrelated IPC call in
1 ms throughout. The worker is part of the main process: not a renderer, not web content. It is never
terminated and restarted: the addon's globals live for the process, and a second load would find
its base directory already set.

## 4. The IPC surface

All `ipcMain.handle` / `ipcRenderer.invoke`. Every handler first checks that the caller is the main
window's top frame (`event.sender` and `event.senderFrame`); every other window (About, debug log,
PDF, permissions, screen share) is refused. Every payload is parsed; nothing from the renderer is used
as a path, a server, a chain or a key.

| Channel                         | In                                      | Out                                                  | Checked in the main process                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swarm-wallet:get-state`        | `{ accountKey? }` (base64, 33 bytes)    | the state (section 1)                                | key shape (`^B[A-Za-z0-9+/]{43}$`); opens that account's file if it is not the open one                                                                                                                                                                              |
| `swarm-wallet:open-with-phrase` | `{ phrase, isNewPhrase, accountKey? }`  | `{ ok, state }` or `{ ok: false, problem }`          | BIP-39 checksum; with `accountKey`, the phrase must derive exactly that account                                                                                                                                                                                      |
| `swarm-wallet:refresh`          | -                                       | the state                                            | retries an open that failed, else refreshes and syncs                                                                                                                                                                                                                |
| `swarm-wallet:quote-send`       | `{ to, amount, memo? }`                 | `{ ok, quote }` or `{ ok: false, refusal }`          | address against this network (bech32m checksum, HRP, testnet spellings refused on mainnet and the reverse, Zcash refused); amount parsed exactly as SWM text; memo ≤ 512 bytes and never to a transparent address; amount ≤ spendable, then amount + fee ≤ spendable |
| `swarm-wallet:confirm-send`     | `{ quoteId }` (32 hex)                  | `{ ok, txids, saved }` or `{ ok: false, refusal }`   | the quote this process issued, unexpired (110 s), once                                                                                                                                                                                                               |
| `swarm-wallet:cancel-send`      | -                                       | `true`                                               | drops the quote                                                                                                                                                                                                                                                      |
| `swarm-wallet:set-network`      | `{ network: 'mainnet' \| 'testnet' }`   | the state                                            | refused in a packaged build                                                                                                                                                                                                                                          |
| `swarm-wallet:new-address`      | `{}` (nothing)                          | `{ ok, address, chain }` or `{ ok: false, refusal }` | Wave 2. Takes nothing, not even a receiver list: Orchard and Sapling, decided here. The address the wallet makes is checked against the network before it is answered.                                                                                               |
| `swarm-wallet:check-address`    | `{ address }` (at most 1024 characters) | `{ accepted, chain, detail }`                        | Wave 2. The same check as quote-send's, for the network the wallet is on; needs no open wallet.                                                                                                                                                                      |
| `swarm-wallet:find-transaction` | `{ txid, memoHash?, accountKey? }`      | `wallet-not-ready`, `not-found` or `found` (below)   | Wave 2. txid and memo hash exactly 64 lowercase hex digits, the key as in get-state. Counts as looking at the wallet: it keeps the wallet syncing and opens the signed-in account's wallet.                                                                          |

Since wave 2, `confirm-send`'s answer also carries `chain` (the network the payment was made on)
and `memoHash` (SHA-256 of the memo the main process quoted, as the wallet puts it on-chain, or
null): what a payment notice in a chat needs, from the process that sent the payment rather than
from the window. `find-transaction` answers `found` with `receivedZat` and `sentZat` (the wallet's
value transfers for that txid, summed: every pool received into, every recipient paid, change to
itself left out), `confirmed` (every part in a block), `failed`, `blockHeight`, a memo verdict
(`match`, `mismatch`, `unreadable`, `none`) and the memo as the wallet reads it.

Amounts cross as decimal zatoshi strings: a `bigint` cannot be put in the redux store and a `number`
cannot hold every balance exactly. Refusals are categories (`invalid-address`, `invalid-amount`,
`invalid-memo`, `insufficient-funds`, `not-ready`, `offline`, `quote-expired`, `rejected`); the
renderer turns them into sentences, except an address refusal, which carries the wallet's own
sentence naming the network the address belongs to.

## 5. Keys, seed and the wallet file

- The seed and the spending keys exist in two places only: inside the wallet file, and in the
  addon's memory in the worker thread. Neither is ever sent to a window.
- The wallet file is sealed at rest by swarm-wallet-core's `WalletStore` (AES-256-GCM, fresh nonce
  per save). Its 32-byte key is generated once and kept wrapped by the OS keychain through Electron's
  `safeStorage` - `config.json` key `swarmWalletEncryptedKey` - the same arrangement as the message
  database key. When the keychain is unavailable (or is Linux's `basic_text`) the file is left in the
  clear and the pane says so; a key written beside the file it protects would only look like
  encryption.
- While the wallet is open its plaintext exists on disk beside the sealed file; a graceful quit seals
  it and wipes the plaintext. Proven: after quitting, only `wallet-<id>.dat.enc` (header
  `SWMWALLET1`) was left.
- There is no channel that returns the phrase. Showing it again is wave 2 and needs OS
  re-authentication first.

## 6. Threat notes

| Concern                             | Wave 1 and 2                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keys in the renderer                | Never. The phrase crosses the renderer only where the person types or reads it (sign-in, restore form), as in wallet sign-in, and goes to the main process once. The restore field is cleared as it is sent.                                                                                                                                                                  |
| Addresses in logs                   | None. The service logs outcomes by category only; any error text passes `redactForLog`, which removes anything shaped like an address; the pane and its container log nothing about addresses or amounts. Checked in the proof: `swm1` / `swarm1` in the app's logs = 0.                                                                                                      |
| Amounts and txids in logs           | Not logged either: "transmitted 1 transaction(s)", not which.                                                                                                                                                                                                                                                                                                                 |
| A compromised renderer              | It is the interface, so it can ask for a quote and confirm it. What it cannot do: choose a path, a server or a chain, read the seed, confirm a quote it was not given, confirm after 110 s, or confirm twice. A confirmation drawn by the main process itself (a native dialog, or Windows Hello) is a wave-2 option.                                                         |
| Other windows                       | Refused by the sender check.                                                                                                                                                                                                                                                                                                                                                  |
| A light server that does not answer | Cannot block chat: the wallet is in a worker, every call has a timeout, the pane reads a cached state. Proven with an unreachable port.                                                                                                                                                                                                                                       |
| A light server on another chain     | swarm-wallet-core refuses a server whose chain label or genesis is not the network's before anything syncs; the pane says "different chain".                                                                                                                                                                                                                                  |
| The address on screen               | Linkable, and the pane says so. Wave 2 shares a fresh address per conversation by default (below).                                                                                                                                                                                                                                                                            |
| Explorer links                      | Opened in the system browser, which tells the explorer which txid was looked at. Expected; the link is only followed on a click.                                                                                                                                                                                                                                              |
| Chat backups                        | The wallet lives under `<userData>/swarm-wallet/`, outside the message database. That no backup path picks it up is still to be pinned by a test. Wave 2's SWARM payment messages are left out of the chat backup export (`ts/services/backups/export.preload.ts`).                                                                                                           |
| swm1 decoding                       | The addon cannot decode SWARM mainnet addresses (it knows Zcash's three chains only), so an `swm1…` address is checked by swarm-wallet-core's own HRP and bech32m checksum. The fix belongs in the SDK.                                                                                                                                                                       |
| A payment notice (wave 2)           | A claim, never money. The bubble says "X SWM sent to you — waiting for your wallet to see it" until this wallet has the txid; "Received" only when the wallet has it in a block with value to this wallet, and the amount shown is the wallet's. An overstated amount, a memo that is not the notice's, and a txid that paid this wallet nothing are each said on the bubble. |
| A notice for the other network      | Refused in `processPayment`: the message shows no payment. A testnet notice cannot be shown on a mainnet wallet or the reverse, and a wallet on another network binds nothing.                                                                                                                                                                                                |
| A notice or an address in a group   | Refused on receipt and never sent: wave 2 is for one-to-one chats, where "the conversation's address" has one owner.                                                                                                                                                                                                                                                          |
| A shared address                    | Kept only after the wallet has checked it for its own network (bech32m checksum, HRP, the other SWARM network and Zcash refused), with the message it came from; the send screen shows that message ("From Ada's message (date)"), so a swapped address is visible. The newest message's address wins; an older share delivered late does not replace it.                     |
| Where addresses are kept            | On the conversation (`swarmPayments`), in this device's database only: not a profile field, not in any record storage service syncs, and SWARM payment messages are left out of chat backups.                                                                                                                                                                                 |
| Addresses reused across people      | Sharing defaults to a fresh unified address made for that conversation and reused only there, so two people cannot link their payments through one address. The main address is shared only when the box is unticked.                                                                                                                                                         |
| The sender's address in a notice    | Only when "Include my address" is ticked; off by default (PROPOSED owner decision). It is that conversation's own address, not the main one.                                                                                                                                                                                                                                  |
| A request for an address            | An ask. Nothing is shared by receiving it or by pressing its Share button: that opens the share dialog, where the person decides.                                                                                                                                                                                                                                             |
| A lost notice                       | Loses the notice, never the money: the notice is sent only after confirm-send returned the txid, and the recipient's wallet finds the payment by its own sync with or without it. If the notice cannot be queued, the dialog says so and that the money is not affected.                                                                                                      |
| What the chat server sees           | Ciphertext: the notice and the address messages are fields of the app's own DataMessage inside the existing end-to-end encryption, like text. No address, amount or txid reaches the chat server.                                                                                                                                                                             |
| Logs (wave 2)                       | Categories only: "newAddress: made a new address for a conversation", "checkAddress: accepted for swarm-testnet", "sendSwarmPaymentNotice: queued". No address, amount or txid.                                                                                                                                                                                               |

## 7. Packaging

| Piece                                  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/swarm-wallet-core-0.3.0.tgz`   | The TypeScript wrapper (since 0.1.4): the `swarm-wallet-core-0.3.0.tgz` its CI packed onto the pre-release `louisinthesubway/swarm-wallet-core` `swarm-wallet-core-0.3.0` (`7cc59e1`, sha256 `d385aec2…6bf1`), with one change - `exports["."]` gains `"default"`, so CommonJS (the test runner) can load it - and nothing else (`diff -r` of the two unpacked trees). sha256 `ac56e24419f9d06d83bf64d8a6632f666902b22ceff605caa61eb5b2419a4d8c`. A devDependency: rolldown bundles it. 0.1.3 and earlier: `swarm-wallet-core-0.2.0.tgz`, the same way. |
| `vendor/swarm-wallet-core-native.json` | The Rust addon is about 80 MB per platform and not in git. This pins the release URL and SHA-256 of each binary (darwin-arm64, darwin-x64, linux-x64, win32-x64), as published by that release's CI.                                                                                                                                                                                                                                                                                                                                                    |
| `scripts/swarm-fetch-wallet-addon.mjs` | Downloads this machine's binary into `vendor/swarm-wallet-native/` (git-ignored) and keeps it only if size and SHA-256 match. `pnpm run swarm:fetch-wallet-addon`. CI runs it before building the installer.                                                                                                                                                                                                                                                                                                                                            |
| `package.json` `build.files`           | Adds `vendor/swarm-wallet-native/native-${platform}-${arch}.node`; `build.asarUnpack` already unpacks every `.node`, and the service loads it from `app.asar.unpacked`.                                                                                                                                                                                                                                                                                                                                                                                 |
| `rolldown.config.ts`                   | New worker bundle `bundles/workers/swarmWallet.js`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

A build without the addon starts and chats normally; the pane says the wallet component is missing.

## 8. Tests

`pnpm run test-node:swarm`:

- `swmAmount_test.std.ts` - eight decimals always, thin-space grouping, exact where a float is not
  (0.1 + 0.2, values above 2^53), strict parsing (no ninth decimal, no exponent, no separators).
- `walletIpc_test.node.ts` - every validator: mainnet address accepted; testnet `swarm1`, old `utest1`,
  testnet transparent and Zcash addresses refused with the sentence naming the network; damaged
  checksum refused; amounts; memo bytes and transparent destinations; insufficient funds; request
  shapes; the phrase derives the same account key as sign-in (the vectors the chat server's tests
  carry); wrong-account phrases refused; wallet file names; explorer URLs; server override; failure
  classification; no address survives `redactForLog`.
- `swarmWalletHandler_test.node.ts` - the worker's handler with a fake addon: never creates a wallet
  of its own; restores, seals at rest, reopens; snapshots as strings, newest first, malformed txids
  dropped; quotes confirmed once, only by their own id, never after expiry; the addon's own refusal
  passed through; the same seed reopened on testnet.
- `SwarmWalletPane_test.preload.tsx` - the pane rendered with the real English strings in its
  loading, offline (with and without a last balance), ready, catching-up, no-wallet, unavailable and
  testnet states, the explorer link scheme, and every refusal sentence.

Wave 2 (payments inside a chat):

- `swarmChatPayments_test.std.ts` - the wire: the notice is `Payment.Item` field 3 and the address
  message `DataMessage` field 30, pinned byte for byte, upstream's items where they were; a notice
  and an address survive encode → decode → process exactly; refused: the other network, a chain
  label this app does not know, a group, a txid that is not 32 bytes, no amount, zero, more than
  the supply, a memo hash that is not 32 bytes; a return address that is not shaped like one is
  dropped, not the notice; an event that could not have come from the wallet is never encoded.
- `processSwarmPayment_test.preload.ts` - the same through upstream's own seam, `processDataMessage`:
  a notice for this network becomes the message's payment event; for the other network, or in a
  group, the message carries none; requests and shares become events; upstream's MobileCoin items
  unchanged.
- `swarmPaymentSentences_test.node.ts` - "Ada sent you 1.23456789 SWM", "You sent … to Ada", eight
  decimals; notifications, previews and quotes say "SWARM payment" without the amount; the address
  itself is never in a sentence.
- `swarmPaymentStorage_test.node.ts` - a notice, a request and a share saved, the database file
  closed and opened again, read back unchanged (no column, no migration).
- `swarmConversation_test.std.ts` - the address exchange as the conversation remembers it: per
  network, the newest message's address wins, a late older one does not replace it, idempotent,
  the conversation's own address, notices and answered requests remembered once and bounded, all
  of it plain JSON.
- `swarmChatIpc_test.node.ts` - the three new channels read their payloads exactly and refuse
  anything else; addresses checked for the wallet's network; new-address asks the addon for
  Orchard and Sapling and saves; confirm-send answers chain and memo hash; the memo hash byte for
  byte as the addon writes the memo (UTF-8, or the bytes of `0x` + even-length hex, without the
  zero padding); value transfers summed, change to self not "sent", in a block only when every
  part is; a value transfer read as the SDK writes it (`status`, `memos`).
- `swarmNoticeBinding_test.node.ts` - a notice bound to the wallet end to end below the window: the
  worker's handler with a fake addon answering zingolib-shaped value transfers, the main process's
  summary, the bubble's view. Waiting until found; "seen" from the mempool, never "received";
  received with the wallet's amount summed over pools; an overstated amount and a foreign memo
  visible; nothing paid to this wallet is not "received"; another network's wallet binds nothing;
  the sender's own notice follows its payment into a block or says it failed.
- `SwarmChatUi_test.preload.tsx` - with the real English strings: the waiting line and no
  "Received" before the wallet has it; "Received 0.00900000 SWM" and "The message said 0.01000000
  SWM" when they differ; the explorer link; Share and Ignore on a request, silence once answered;
  a kept address offers Pay, a refused one says why; Pay shows the address with its message and no
  field to type one; "Include my address" unticked; sharing defaults to a per-chat address; the
  pane says "Received · from Ada".

## 9. Proof in the running app (2026-09-27, mainnet)

Desktop build of branch `codex/m3-wallet-pane`, a disposable profile, driven over Electron's DevTools
protocol:

1. First run → **Create account on this computer** → **Create a wallet** → 24 words (never captured)
   → written-down box → **Continue**. Log: `openWithPhrase: new phrase accepted`, `created the wallet file
key in the OS keychain`, `open: wallet open on mainnet` 1.5 s later. The staging chat server answered
   too (port 443 was open by then), so the account was created and the app reached the inbox.
2. **Wallet** in the left navigation → ready: "Block 1,598 · Up to date · Chain checked" while
   `https://lwd-main.swarm.green/status.json` said `node.height` 1598 (20:43:46 UTC); 0.00000000 SWM
   confirmed and pending; the `swm1…` address and its QR. `messenger-wallet-ready.png`.
3. Send 0.001 SWM with a memo → refused before any quote: "Not enough SWM. This payment needs
   0.00100000 SWM and 0.00000000 SWM is available." `messenger-wallet-send-refused.png`.
   A testnet `swarm1…` address → "That is a SWARM Testnet address … coins sent across them are lost."
   `messenger-wallet-send-testnet-address-refused.png`.
4. Quit → only the sealed file left. Relaunched with `swarmWalletServer` =
   `https://lwd-main.swarm.green:9` → "opening" for about 20 s, then "Can't reach the SWARM network …
   chats keep working", steady across retries; main-process IPC round trip 1 ms throughout.
   `messenger-wallet-offline.png`.
5. The disposable profile was deleted afterwards.

Screenshots are in `D:\swarm-work\smoke\` on the build workstation, not in the repository.

## 10. Not done yet

- Showing the recovery phrase again (needs OS re-authentication first); closing the wallet when
  the pane is idle; a main-process confirmation (native dialog or Windows Hello) before a send; a
  test that pins the wallet out of every backup path; Linux keychain backend changes (today: the
  wallet says it cannot open the file, and the 24 words restore it).
- swm1 decoding inside the addon (SDK work).
- Payments in groups; a request for a particular amount; a note typed with the payment (the
  protocol carries `note`, the send screen does not offer it yet); notices from another of the
  account's own devices binding to that device's wallet (a linked device has no wallet of its own).
- The desktop Wallet pane's own send form is not tied to a chat: a payment made there sends no
  notice.
- `swarm-wallet-core` reads a value transfer's `memo`, while the SDK writes `memos` (an array) and
  a `blockheight` that is only a target height until `status` is `confirmed`; the worker reads both
  (`readTransfer`), and the fix belongs in the wrapper too.

## 11. Wave 2: payments inside a chat

Following `docs/MESSENGER-INTEGRATION.md` sections 6 and 7 in swarm-wallet-core (tag
`swarm-wallet-core-0.2.0`). Implemented 2026-09-28 on branch `codex/m3-w2-payments`.

### 11.1 The protocol

Two additions to the app's own `DataMessage` (`protos/SignalService.proto`), inside the existing
end-to-end encryption. libsignal and the Signal protocol are unchanged; the chat server sees
ciphertext, as for a text message. Nothing upstream is renumbered.

```proto
message Payment {
  message SwarmNotification {
    optional bytes  txid          = 1;  // 32 bytes; its hex is the explorer's txid
    optional uint64 amountZat     = 2;  // 100 000 000 zatoshi = 1 SWM
    optional bytes  memoHash      = 3;  // SHA-256 of the memo as put in the output, no padding
    optional string senderAddress = 4;  // only when the sender chose to include it
    optional string chain         = 5;  // "swarm-mainnet" or "swarm-testnet"
    optional string note          = 6;
  }
  oneof Item { Notification notification = 1; Activation activation = 2;
               SwarmNotification swarmNotification = 3; }
}
message SwarmAddress {                   // DataMessage field 30
  enum Type { SHARE = 0; REQUEST = 1; }
  optional Type type = 1; optional string address = 2; optional string chain = 3;
}
```

On receipt (`processDataMessage` → `processPayment`, upstream's seam) a notice or an address for
the network this app's wallet is on becomes the message's payment event
(`PaymentEventKind.SwarmNotification` / `SwarmAddressRequest` / `SwarmAddressShare`, numbered
101-103, apart from upstream's kinds). One for the other network, for a chain this app does not
know, or sent to a group is refused: the message shows no payment. The window learns the wallet's
network from its config at start (`swarmWalletChain`) and from every wallet state afterwards; a
packaged build is always mainnet. The event is stored with the message as upstream stores its own
payment events, in the message's JSON: no column, no migration, and it survives a restart.
Pure code in `ts/util/swarm/swarmChatPayments.std.ts`.

### 11.2 Asking for and sharing an address

- The composer's **+** menu, in a one-to-one chat (not a group, not Note to Self), has **Pay with
  SWARM**, **Request SWARM address** and **Share SWARM address**, below Poll - the closest upstream
  pattern.
- A request shows "Ada wants your SWARM address" with **Share** and **Ignore**. Share opens the share
  dialog; nothing is shared by receiving the request or by that press alone. Once answered, the
  bubble says so and stops asking.
- The share dialog defaults to **an address just for this chat**: `swarm-wallet:new-address` makes
  a new unified address (Orchard and Sapling), kept on the conversation and reused only there.
  Unticked, it shares the wallet's main address.
- A received address - a share, or a notice's return address - is checked with
  `swarm-wallet:check-address` for the wallet's network before it is kept on the conversation
  (`ConversationAttributesType.swarmPayments`, per network; `ts/util/swarm/swarmConversation.std.ts`).
  The bubble says "Saved for paying Ada in this chat." with **Pay Ada**, or "Not saved:" and the
  wallet's own sentence, or that a newer address replaced it.

### 11.3 Paying from a chat

**Pay with SWARM** (or **Pay Ada** on a kept address) opens a dialog with the Wallet pane's own
send flow - moved unchanged into `ts/components/SwarmSendFlow.dom.tsx`, used by both - over the
same `quote-send` / `confirm-send` channels. There is no second send path. The address is not
typed: it is the conversation's, shown with "From Ada's message (date)". **Include my address so
Ada can pay me back** is off until ticked. After `confirm-send` has returned the txid, and only
then, the notice goes out as an ordinary message through the conversation's send queue, with
`memoHash` and `chain` from the main process's answer. If the notice cannot be queued, the dialog
says the payment was sent and the message could not be, and that the money is not affected.
When the conversation holds no address, the dialog offers **Ask for an address** instead.

### 11.4 Receiving

The bubble asks this app's wallet about the txid (`swarm-wallet:find-transaction`) every 10 s
until the answer cannot change, and says:

| The wallet                                    | The bubble                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| has not seen the txid (or is not open)        | "X SWM sent to you — waiting for your wallet to see it" (the claim)    |
| sees it, not yet in a block                   | "Your wallet sees X SWM — not yet in a block" (the wallet's amount)    |
| has it in a block, with value to this wallet  | "Received X SWM", "In block N" (the wallet's amount)                   |
| has it, and nothing in it came to this wallet | "Your wallet has this transaction, but nothing in it was paid to you." |

Beside "Received": "The message said Y SWM; the amount above is what your wallet shows." when they
differ, and "The memo in your wallet is not the one this message describes." when the memo hash
does not match the memo the wallet read. The sender's own bubble follows its payment into a block
or says the network did not take it. The Wallet pane labels a transaction "from Ada" or "to Ada"
when a notice in a chat named it.

### 11.5 Proposed owner decisions

- **The sender's address in a notice is off by default.** A notice carries it only when "Include
  my address" is ticked, and then it is that conversation's own address. (Design question 3 in
  MESSENGER-INTEGRATION.md section 10.)
- **Sharing defaults to a per-conversation address.**
- **SWARM payments are for one-to-one chats** in this wave; groups refuse them.

## 12. Proof on the testnet (2026-09-28)

Two instances of this branch on one PC, side by side against the staging chat server
`chat.swarm.green`, each with its own profile, a new account and a new wallet (24 words never
shown to anyone or captured), the wallet on the **testnet** (`NODE_CONFIG`
`{"storagePath": …, "swarmWalletNetwork": "testnet"}`; the app logged `ready: network testnet,
server https://lwd.swarm.green:443`), driven over Electron's DevTools protocol. Builds: commit
`660c57bf5` for steps 1-6; for steps 7-8 the branch merged with `swarm-main` `7b330cc7c`
(libsignal `0.101.2-swarm.2`) plus `30510b77e`. Screenshots in `D:\swarm-work\smoke\` on the
build workstation, not in the repository.

**Proven: the address exchange, both ways, and that it survives a restart** (2026-09-28,
00:26-00:52 UTC).

1. Two accounts: "W2 Alice" (A) and "W2 Bob" (B); B took the username `wtwobob.59`, A found it with
   **New chat**, they exchanged a message each way and B accepted A's request.
2. A: **+** → the menu lists Photos & videos, File, Poll, and below a line **Pay with SWARM**,
   **Request SWARM address**, **Share SWARM address** (`messenger-w2-01-plus-menu.png`). **Request
   SWARM address** → "Ask for a SWARM address" → **Ask** (`messenger-w2-02-request-dialog.png`). A's
   chat: "You asked W2 Bob for their SWARM address".
3. B: "W2 Alice wants your SWARM address" with **Share** and **Ignore**; nothing was shared
   (`messenger-w2-03-request-received.png`). **Share** → "Share your SWARM address" with "Use an
   address just for this chat (recommended)" ticked (`messenger-w2-04-share-dialog.png`) → **Share**.
   B's log: `newAddress: made a new address for a conversation` (a new Orchard + Sapling unified
   address, not the wallet's main one). B's request bubble: "You shared your address."
   (`messenger-w2-07-share-sent-b.png`).
4. A: "W2 Bob shared their SWARM address", the address, "Saved for paying W2 Bob in this chat." and
   **Pay W2 Bob**. A's log: `checkAddress: accepted for swarm-testnet`
   (`messenger-w2-05-address-kept.png`).
5. A: **Pay W2 Bob** opens "Pay with SWARM": the wallet's confirmed balance, **To** with B's
   address and under it "From W2 Bob's message (Today 12:29 AM)", amount, memo, "Include my address
   so W2 Bob can pay me back" unticked. 0.01 SWM with a memo → **Review payment** → the wallet's
   refusal before any quote: "Not enough SWM. This payment needs 0.01000000 SWM and 0.00000000 SWM
   is available." (A's wallet was new and empty; `messenger-w2-06-pay-dialog-unfunded.png`, log
   `quoteSend: refused before quoting (insufficient-funds)`).
6. Both apps quit through their own shutdown: `shutdown: wallet closed` on both, and only the
   sealed `wallet-<id>.dat.enc` left in each profile. Address-shaped strings in both apps' logs and
   consoles: 0.
7. Both started again on the merged build. Every SWARM bubble came back as it was: A's request, B's
   share with "Saved for paying W2 Bob in this chat." and **Pay W2 Bob**, B's "You shared your
   address." (`messenger-w2-08-after-restart-a.png`). One defect seen in step 3 and fixed in
   `30510b77e`: B's chat list had named B's own share "Unknown contact shared their SWARM address".
8. The other way round: B asked A (**+** → **Request SWARM address** → **Ask**; B's chat list now
   says "You asked W2 Alice for their SWARM address"), A pressed **Share** → **Share** with its own
   per-chat address (`newAddress: made a new address for a conversation`), and B's wallet checked
   and kept it (`checkAddress: accepted for swarm-testnet`, "Saved for paying W2 Alice in this
   chat." and **Pay W2 Alice**; `messenger-w2-09-reverse-exchange-b.png`). Both quit again, sealed,
   0 address-shaped strings in the logs.

**Not yet proven live: the payment and its notice.** No testnet coins were reachable that night:
the agents' funding wallet lives in WSL, which refused to start (`Wsl/Service/CreateInstance/
0xd0000022`), there is no faucet, and the owner's wallets are not the agents'. The request to fund
A's disposable testnet wallet is Open Questions item 11f. Until then the notice round trip is
tested by the node tests only (section 8: `swarmNoticeBinding_test.node.ts` drives the worker's
handler with a fake addon answering SDK-shaped value transfers; `SwarmChatUi_test.preload.tsx`
renders every state). Both profiles are kept (`D:\swarm-messenger\.profiles\w2-a` and `w2-b`),
each holding the other's address, so the proof continues from step 5 the moment A's wallet has
coins: A pays B 0.01 SWM with a memo, B's bubble goes from "waiting for your wallet to see it" to
"Received", the txid is checked on `https://explore.swarm.green/transactions/<txid>`, and B pays A
back with **Pay W2 Alice**.
