# Test SWARM Messenger on one PC: two desktops, one conversation

Written 2026-09-27 by Opus M-G, after doing exactly this on the owner's PC against the staging
server `chat.swarm.green`. Every step below was carried out and every screen below was seen on
that day, at `swarm-main` commit `a6af1d166` or later, unless a step says otherwise. Sending
photos was added to the server at 19:26 UTC the same day and was tested at 19:52 UTC.

You will run the desktop app twice on the same PC, as two separate people, **A** and **B**. Each
one creates its own wallet, becomes its own account, and then A and B message each other.

---

## 1. What works today, and what does not

| Works (tested 2026-09-27)                                                                 | Does not work yet                                                                        |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Creating an account from a new wallet: no phone number, no SMS                            | Finding someone by the account number shown in Settings ("Failed to fetch phone number") |
| Setting a username, and finding the other person by that username                         | Stickers and GIF search (no sticker packs or GIF service on this server)                 |
| Text messages both ways, end-to-end encrypted, delivered in < 1 s                         | Voice and video calls (no calling server yet)                                            |
| Message request, Accept, read and delivery ticks                                          | Call links (their credentials fail to verify)                                            |
| Groups: create one, the other person sees it, messages both ways (2026-09-28, section 11) | Linking a second device, and the Linked devices screen                                   |
| Group photos: one member sets a photo, the others see it (2026-09-29, section 11)         | "Restore a wallet" landing on the same account (built, not yet tested live)              |
| Closing both apps and opening them again: same accounts, same chat                        |                                                                                          |
| Photos, both ways (sent, stored on `cdn.chat.swarm.green`, shown)                         |                                                                                          |

This is the **staging** server. Everything on it is test data and may be wiped at any time. Treat
both wallets as throwaway: never send SWARM to them.

---

## 2. Before the first test: update and build (about one minute)

The app is already set up on this PC in `D:\swarm-messenger\Signal-Desktop`. Open **PowerShell**
(not as administrator) and paste these lines:

```powershell
. D:\swarm-messenger\.tools\swarm-env.ps1
$env:SWARM_ALLOW_MISSING_NATIVE = '1'
cd D:\swarm-messenger\Signal-Desktop
git pull --ff-only swarm swarm-main
pnpm install --frozen-lockfile
pnpm run generate
git log -1 --oneline
```

What you should see:

- `git pull` ends with a list of changed files, or `Already up to date.`
- `pnpm install` prints many red `gyp ERR! find VS` lines and a note
  `SWARM: electron-builder install-app-deps FAILED`, both about optional Windows Hello support
  that needs Visual Studio. **That is expected on this PC** and the install continues; it ends
  with `Done in …s`.
- `pnpm run generate` ends without the word `ERR` (it takes 10-30 seconds).
- The last line is the commit you are testing. Note it for your report.

The remote is called `swarm` in this folder (`origin` is the upstream project and is read-only).

---

## 3. Start the two instances

Double-click these two files, one after the other:

- `D:\swarm-messenger\.tools\Start SWARM Messenger A.cmd`
- `D:\swarm-messenger\.tools\Start SWARM Messenger B.cmd`

Each opens a black console window (leave it open, it is the app's engine), then the app window.
Because this is a development build, the app window also shows a **DevTools** panel down its right
side, which squeezes the app into a narrow strip. Close that panel with the **×** at its top right
(or drag the window wider). Do not close the console windows.

A keeps everything in `D:\swarm-messenger\.profiles\a`, B in `D:\swarm-messenger\.profiles\b`.
They never share anything, exactly as two different computers would.

**To start again from nothing:** quit both apps (**File → Quit SWARM Messenger**; the window's **×**
only hides the app next to the clock), delete the folders
`D:\swarm-messenger\.profiles\a` and `D:\swarm-messenger\.profiles\b` (they hold only test data),
and double-click the two files again.

---

## 4. Create an account on each (A first, then B)

Do this in window A, then the same in window B.

1. **First screen.** Since 2026-09-28 the app opens straight on **"Your SWARM wallet"** (no
   phone-linking code: SWARM Messenger rolls out on the desktop first). If you see "Something went
   wrong! Failed to connect to server", the server is down: stop and report it. (File > Set up as
   new device still shows the phone-linking code, for later.)
2. **"Your SWARM wallet".** Two buttons: **Create a wallet** and **Restore a wallet**. Click
   **Create a wallet**.
3. **"Write these 24 words down".** 24 numbered words. For this test the wallet is throwaway, so
   you do not need to keep them, and **do not photograph or screenshot this screen**. Tick
   "I have written down my 24 words and stored them safely", then **Continue**. The words go away
   and the **Create a wallet** button spins for a few seconds while the account is created.
4. **"Set up your profile".** Type a first name (for example `Test A` in window A and `Test B` in
   window B) and click **Continue**. Skip the photo for this test: profile photos have not been
   tried in the app yet.
5. **The chat list.** "Chats", "No chats", and on the right "Welcome to SWARM Messenger".

If step 3 ends with "Could not reach the SWARM server", wait a minute and click **Create a wallet**
again (it will show new words; that is fine for a throwaway wallet).

---

## 5. Let A find B

People are found by **username**. The number under your name in Settings (for example
`123 456 78901`, really `+88812345678901`) is an internal account number, not a phone number:
typing it under New chat fails with "Failed to fetch phone number", because there is no number
directory on this server.

In window **B**:

1. Click the **gear** at the bottom of the left edge (Settings). The Profile panel opens on the
   right.
2. Click **Username**. Under "Choose your username", type a name of at least three letters, for
   example `beetest`. The app adds two digits of its own, for example `.42`.
3. Click **Save**. The panel now shows the full username, for example `beetest.42`, under your
   name. Write down the **whole** username, digits included.

In window **A**:

4. Click the **pencil** icon next to "Chats" (New chat).
5. In the box "Name, username, or number", type B's full username, for example `beetest.42`.
6. A line **Find by username** appears with the name under it. Click it. The conversation with
   B opens.

---

## 6. Send, accept, reply

1. **A:** type a message in the box at the bottom and press **Enter**. The bubble gets one tick,
   then two ticks once B's app has it.
2. **B:** the chat list shows **Test A** with "Message Request". Click it. At the bottom:
   "Let Test A message you and share your name and photo with them?" with **Block**,
   **Report…** and **Accept**. Click **Accept**, and **Accept** again in the "Accept request?" box.
3. **B:** type a reply and press **Enter**.
4. **A:** the reply appears within about a second, and the header of the chat now shows B's
   profile name (before B accepted it may show only the username).

Then the restart test:

5. Quit both apps: in each app window choose **File → Quit SWARM Messenger**. (The window's **×**
   only hides the app in the system tray next to the clock.) The console windows close by
   themselves.
6. Double-click both `.cmd` files again, open the chat on each side and send one more message each
   way. No new sign-in should be needed, and the old messages should still be there.
7. Optional, a photo: click **+** at the right of the message box, choose **Photos & videos**, pick
   a picture that is not private, and press **Enter**. The other window shows it within a few
   seconds.

---

## 7. Known limits

- **Photos and files** go through `cdn.chat.swarm.green`. Files other than photos, voice notes
  and profile photos should work the same way but were not part of this test. If an attachment
  ever stays on its spinning circle, it holds up every later message in that chat, because the
  app sends a chat's messages strictly in order. Hover over it, click **⋯**, **Delete**, then
  **Delete for me**; the messages behind it go out within a few minutes.
- No calls, no call links, no stickers, no second devices (see section 1). Groups work since
  2026-09-28, group photos since 2026-09-29 (section 11).
- Settings and contacts sync to the server since 2026-09-28 (Signal's storage service, end-to-end
  encrypted as in Signal). A brand-new account's first read of it answers `404` once in the log;
  that is expected, the app writes it right after.
- The app window may say "Name not verified" next to the other person's name. That is normal for
  someone who is not in your contacts.
- This is Windows, from source, on the owner's PC. There is no installer for this test.

---

## 8. What to report back

For anything that does not match this page:

1. Which window (A or B), which step (for example "5.3"), and the time.
2. The exact words on the screen, or a screenshot, **but never a screenshot of the 24 words**.
3. The commit from section 2 (`git log -1 --oneline`).
4. The app's own log for that window, which never contains the 24 words:
   `D:\swarm-messenger\.profiles\a\logs\app.log` (A) or `D:\swarm-messenger\.profiles\b\logs\app.log`
   (B).

And, if everything worked: say so, with the commit, so the result can be recorded.

---

## 9. Usernames on the HTTP/2 build: set one, find the other account

Added 2026-09-27 by Opus M-H. These are the exact steps and screens from a run at 20:59-21:32 UTC
against `chat.swarm.green`, with the build from pull request `codex/mh-usernames` (libsignal
`0.101.2-swarm.2`, which talks to the server over HTTP/2) plus `codex/mh-zk-params`. Until those
are merged, `swarm-main` takes a username through a stop-gap (section 5 was tested on that); the
steps on screen are the same.

**Set a username (window A):**

1. Click the **gear** at the bottom of the left edge. The **Profile** panel opens on the right, with
   a row **@ Username** under your name.
2. Click **Username**. A panel titled **Username** opens with one text box (grey word
   `Username` inside it) and **Cancel** / **Save** at the bottom.
3. Type a name of at least three letters, for example `mhalice`. Within a second two digits appear
   at the right end of the box, for example `35`, and the full name above the box, for example
   `mhalice.35`. The digits are chosen by the app and cannot be picked.
4. Click **Save**. The panel closes; the Profile panel and the top of Settings now show
   `mhalice.35`, with a **QR code or link** row under it.
5. Tell the other person the **whole** username, digits included: `mhalice.35`, not `mhalice`.

**Find that account (window B):**

6. Click the **speech bubble** at the top of the left edge (Chats), then the **pencil** next to
   "Chats" (**New chat**).
7. In the box **Name, username, or number**, type the whole username: `mhalice.35`.
8. A heading **Find by username** appears with `mhalice.35` under it. Click that line. The
   conversation opens on the right with `mhalice.35` in the header.
9. Type a message at the bottom and press **Enter**. A sees it as a **Message Request** from B's
   profile name; after **Accept** (twice) A can reply, and B's header then shows A's profile name
   instead of the username.

**If it does not work:**

- **"Your username couldn't be saved. Check your connection and try again."**, or Save does
  nothing: check the app's log. In it
  (`D:\swarm-messenger\.profiles\<a or b>\logs\app.log`) the line
  `requires an H2 connection` means the libsignal in use is still `0.101.2-swarm.1`: pull, run
  `pnpm install --frozen-lockfile` and `pnpm run generate` again (section 2), then restart.
- **"This username is not available"**: type a different name. **"Too many attempts made,
  please try again later"**: wait a few minutes.
- **"… is not a SWARM Messenger user. Make sure you've entered the complete username."**: the
  username was typed without its digits, or with a typo. Ask for it again, digits included.
- **Typing the account number from Settings** (for example `188 745 44084`) still fails with
  "Failed to fetch phone number". That is expected: there is no number directory on SWARM, and
  usernames are the way to find people.

**What this build adds, and what it still does not:**

- The app now uses the server's HTTP/2 connection, which also carries the linked-devices list, the
  device name and the "Who can find me by phone number" switch (not tested by hand yet).
- Call-link credentials now verify: the app's log no longer repeats
  `Verification failure in zkgroup`, and it logs `saving 7 new call link auth credentials`.
- _(Superseded 2026-09-28: groups work now, see section 11.)_ **Groups still do not work.**
  Clicking **New group** turns the window blank (the server does not
  yet send the group size limits the app reads; quit and restart the app to recover), and even with
  those the server has no groups service to store a group in. Do not try groups in this test.

---

## 10. Paying inside a chat (mainnet: real SWM)

Added 2026-09-28 by Opus M3-W2, with the build from pull request `codex/m3-w2-payments`. Steps 1
to 7 below were carried out on the SWARM **testnet** by two instances on this PC, both ways round,
and every screen named in them was seen then (with 0 SWM in the paying wallet, so Review payment
was refused for lack of funds). The payment itself and its notice (steps 8 to 13) have been tested
only by the app's automatic tests so far: no testnet coins were reachable that night. Where a step
describes a screen not yet seen live, it says so. This section is your mainnet test, the M3
milestone: one small real payment from A to B, with its transaction id on the mainnet explorer.

**The amount is real.** On mainnet, SWM has value. A payment cannot be undone, and SWM sent to a
wrong address is gone. Use the smallest amount that makes the point: **0.001 SWM** is enough. The
network fee is shown before anything is sent (about 0.0001 SWM).

### Before you start

1. Both windows run the build that contains this section (section 2), and A and B already chat
   with each other (sections 4 to 6).
2. In each window click **Wallet** (the card icon in the left edge). The top of the pane must say
   **SWARM mainnet** and, under the light server, **Up to date**. If it says **SWARM testnet**,
   click **Mainnet** under **Developer: network** at the bottom of the pane.
3. If the Wallet pane asks for 24 words instead, that account's wallet was never created on this
   PC. Start again from nothing (section 3) and this time **write down the 24 words of both A and
   B on paper**: these wallets are about to hold real SWM, and the words are the only way back to
   it.
4. Put a little SWM into A: in A's Wallet pane, under **Receive**, click **Copy address**. From your
   own SWARM wallet send **0.002 SWM** to that address. Wait until A's pane shows it under
   **Confirmed** (the wallet waits for three blocks, a few minutes).

### Ask for B's address, and share it

1. **A:** in the chat with B, click the **+** at the right of the message box. Under Photos &
   videos, File and Poll there are three more lines: **Pay with SWARM**, **Request SWARM address**
   and **Share SWARM address**. Click **Request SWARM address**.
2. A box **Ask for a SWARM address** says B will see the request and that nothing is shared
   automatically. Click **Ask**. A's chat shows "You asked Test B for their SWARM address".
3. **B:** the chat shows "Test A wants your SWARM address" with two buttons, **Share** and
   **Ignore**. Click **Share**.
4. A box **Share your SWARM address** opens, with **Use an address just for this chat
   (recommended)** ticked. Leave it ticked: B's wallet makes an address used only in this chat, so
   A's payments cannot be linked to anyone else's. Click **Share**. B's request bubble now says
   "You shared your address."
5. **A:** the chat shows "Test B shared their SWARM address", the address, **Saved for paying Test B
   in this chat.** and an orange button **Pay Test B**. A's wallet checked the address before saving
   it: an address for the wrong network is refused here with a sentence saying which network it
   belongs to.

### Pay

6. **A:** click **Pay Test B** (or **+** → **Pay with SWARM**). The box **Pay with SWARM** shows
   A's confirmed balance, **To** with B's address, and under it "From Test B's message (…)" with
   the time of B's share. Check that time: it tells you which message the address came from.
7. **Amount in SWM:** `0.001`. **Memo** (optional, only B can read it): for example
   `first chat payment`. Leave **Include my address so Test B can pay me back** unticked unless
   you want B to be able to pay you back without asking; it gives B an address of yours (this
   chat's own).
8. Click **Review payment**. Nothing moves yet. The screen **Confirm payment** shows **To**,
   **Amount**, **Network fee**, **Total**, the memo, and "A payment cannot be undone. Check the
   address: coins sent to the wrong one are gone." _(This screen is the Wallet pane's own
   confirmation, seen on mainnet in wave 1; seen from a chat only in the automatic tests.)_
9. _(Not yet seen live.)_ Click **Send … SWM** (the total). "Sending. Building the private
   transaction can take a minute." Then **Sent**, "Transaction" followed by the transaction id,
   **View on the explorer**, and "Test B is told in this chat." Write down the transaction id.
   Click **Done**. Only now, after the wallet has sent the payment, does the app send B the message
   about it; if that message cannot be sent, the box says so, and the payment is not affected.
10. **A's chat** _(not yet seen live)_: a bubble **SWARM payment**, "You sent 0.00100000 SWM to
    Test B", then "Your wallet does not list this payment yet." or "Not yet in a block", later
    "In block …".

### Receive

11. **B's chat** _(not yet seen live)_: a bubble **SWARM payment** that says "0.00100000 SWM sent
    to you — waiting for your wallet to see it". That line is the message's claim, not money: the
    app never shows a payment as received on a message's word. Within a few minutes B's wallet
    finds the payment by itself: first "Your wallet sees 0.00100000 SWM — not yet in a block",
    then **Received 0.00100000 SWM** and "In block …". The amount on that line is what B's wallet
    sees. If it differs from what the message said, the bubble says so in red; so does a memo that
    is not the one the message describes. B does not need to open the Wallet pane for this.
12. _(Not yet seen live.)_ Open
    `https://mainnet.explore.swarm.green/transactions/<transaction id>`, or click the id on either
    bubble. The explorer shows the transaction. It is a shielded payment: expect no address and no
    amount on that page.
13. **B** _(not yet seen live)_: **Wallet** → **Transactions**: the newest line says
    **Received · from Test A**, with the amount and the block.

### What to report

The transaction id, the time of step 9, the time B's bubble said **Received**, and screenshots of
both chats after step 11 (never of the 24 words). If a step does not match: which window, which
step, the exact words on the screen, and the commit (`git log -1 --oneline`). The app's logs name
what happened without any address, amount or transaction id in them.

To take the SWM back, use A's and B's Wallet panes: **Send** to your own address (the same two
steps, review and send).

---

## 11. Groups

Added 2026-09-28 by Opus M6b, when the server got Signal's storage service, the part of Signal that
keeps groups (and settings sync). Every step below was carried out that day between 21:56 and
22:07 UTC by two desktop instances (swarm-main `e01c737c0`, fresh wallet accounts) against
`chat.swarm.green`, and every screen named here was seen then. The group screens are Signal's own
code, which SWARM did not change; the run has not yet been repeated with the installed 0.1.0 app.

**Before you start:** A and B have each other in their chat lists and have exchanged one message
each way (sections 5 and 6). That is how A's app learns what it needs to add B directly; without
it, B gets an invitation to accept instead.

**In window A:**

1. Click the **pencil** next to "Chats" (**New chat**), then **New group**, the first line.
2. **"Choose members".** Click **Test B** under Contacts. The name moves up to the top; click
   **Next**.
3. **"Name this group".** Type a name, for example `Test group`. Leave the photo empty here and
   set it afterwards as in "Group photos" below, which is the way that was tested. Click **Create**.
4. The group opens: its name, "Test B and you", and "You created the group."

**In window B:**

5. The chat list shows the group with "Test A added you to the group." Click it.

**Both:**

6. Send one message in the group from A, then one from B. Each appears in the other window within
   a second or two, with the sender's name above it.
7. Restart: quit both apps (**File → Quit SWARM Messenger**) and start them again. The group is in
   both chat lists with its messages, and new messages still go both ways.

**If it does not work:**

- **"This group couldn't be created. Check your connection and try again."**: the app's log
  (`app.log`, section 8) has a line `PUT (REST) https://chat.swarm.green/v2/groups` with the
  server's answer. `404` means the server's groups route is missing, `502` that the groups service
  is down, `401` that its keys do not match. Report it with the time; the server's runbook is
  section 5c of `docs/STAGING.md` in `swarm-messenger-server`.
- **New group turns the window blank**: that was an old server setting (section 9). Quit and
  restart the app.

**Group photos (since 2026-09-29):** in the group, click its name at the top, then the group's
name in the panel that opens (**Edit group**), the round picture, **Photo**, choose a picture,
**Save**, and **Save** again; the other members see the photo within seconds, and still after a
restart (tested 2026-09-29 by Opus M6d with two test instances, not yet with the installed app).

**Not yet:**

- **Group calls**: there is no calling server.
- Like everything on this server, groups are test data. They are kept on disk and in the server's
  nightly snapshot, but the staging server may still be wiped.

**Settings sync, same day:** the app now also keeps your settings and contact list on the server,
end-to-end encrypted as in Signal. There is nothing to do; after a change (for example a new
username) the app's log shows `PUT (REST) https://chat.swarm.green/v1/storage/ 200 Success`.

---

## Appendix: the same test from a fresh clone

For anyone not on the owner's PC. Needs Windows, Git, Node `24.19.0` and pnpm 11. This was checked
on the owner's PC from a fresh worktree (`pnpm install` 31 s with a warm package store, generate
11 s); a clean machine downloads the dependencies first.

```powershell
git clone https://github.com/Swarm-Official/swarm-messenger.git
cd swarm-messenger
git checkout swarm-main
$env:SWARM_ALLOW_MISSING_NATIVE = '1'   # only on a PC without Visual Studio
pnpm install --frozen-lockfile
pnpm run generate
```

Then, in two separate PowerShell windows, one per person, each with its own profile folder:

```powershell
# window A
$env:SWARM_ALLOW_MISSING_NATIVE = '1'
$env:NODE_ENV = 'development'
$env:NODE_CONFIG = '{"storagePath":"C:\\swarm-test\\a"}'
pnpm exec electron .
```

```powershell
# window B
$env:SWARM_ALLOW_MISSING_NATIVE = '1'
$env:NODE_ENV = 'development'
$env:NODE_CONFIG = '{"storagePath":"C:\\swarm-test\\b"}'
pnpm exec electron .
```

`storagePath` is the whole trick: the app keeps its database, keys and logs there, so two folders
are two separate people. `NODE_ENV=development` is what lets `NODE_CONFIG` choose the folder; a
packaged build ignores it. Then follow sections 4 to 6.
