# MicroBit — Protocol & build gotchas

> **This file:** rules that were learned the hard way, each with its evidence.
> **Not here:** stable facts → [README.md](README.md) / [ARCHITECTURE.md](ARCHITECTURE.md);
> cross-component rules → [ISSUES_AND_PROGRESS.md](ISSUES_AND_PROGRESS.md) §5.

## Doc maintenance requirements

1. One bullet = **rule** then **evidence** (date, command, observed output, file:line).
2. If the rule generalises beyond this repo, move it to [ISSUES_AND_PROGRESS.md](ISSUES_AND_PROGRESS.md) §5.
3. Do not rewrite history: append a dated correction instead of deleting the old line.

## 1. Build budget

- **`README.md` ships inside the hex — its length is program size.**
  Evidence 2026-11-04: same commit (`482bb54`), same sources; 618-line README ⇒
  `built/binary.hex` **1,497,612 B**; 149-line README ⇒ **1,479,180 B**. A/B run with
  `git show HEAD:README.md > README.md` and back. Splitting the README into
  `README.md` + `ARCHITECTURE.md` bought **18,432 B** of headroom, which is how this build
  fits at all.
  ⇒ Rule: keep the shipped `README.md` short; long prose goes to `ARCHITECTURE.md`, which
  is not in `pxt.json` `files` and therefore not compiled.

⚠️ **2026-11-04: this demo has no bytes to spare.** `Custom3` costs a string, and the
handshake wait lost `basic.showIcon(IconNames.No)` + `basic.clearScreen()` (40 B) to get back
under the limit — the program had been **failing to build for days** (`too big by 36 bytes`)
while the board kept running the last hex that fit (**that was before the README split below**).
Any new block costs a build cycle to pay for; measure with `pxt build`, never guess. `r300_emotion.showFace()` is still exported
for students, but `demo_dance_video.ts` calls `r300.emoji()` directly so the wrapper is not
linked into the hex.

### 1.1 A clean clone cannot build until two gitignored pieces exist

- **`npm ci` gives you the target package but not `node_modules/pxtcli.json` — the file
  `pxt` reads to learn which target lives in `node_modules`.** Without it every pxt
  command dies with `Cannot find node_modules/pxtcli.json nor pxtarget.json`. It is not
  in `package-lock.json` (it is not a package, it is a 35-byte JSON file), so a laptop
  keeps it forever and CI never has it.
  Evidence 2026-11-05, first CI run `41982690677` (`microbit_R300`, ubuntu-latest):
  `npm ci` added 699 packages, then `pxt --version` exit 1 with that message.
- **`pxt build` also needs `pxt_modules/`; a clean clone has none and pxt refuses with
  `Package not installed: core, did you forget to run 'pxt install'?`**
  Evidence: same session, fresh `git clone --depth 1` into `/tmp` → `npm ci` → `pxt build`
  exit 1 with that line; `pxt install` (1.7 s) then `pxt build` (4.1 s) succeeded.
- **Rule: `scripts/custom_release.py` creates both when they are missing**, so CI and a
  laptop run the same entry point. A laptop is unaffected because both already exist there.
- **⚠️ `pxt` has no `--version` flag, and `pxt help` exits 1 before a target resolves** —
  neither works as a health check. The second CI run (`41982918388`) went red on exactly
  that. Check `command -v pxt` and read versions from
  `node_modules/pxt-*/package.json` instead.
- **The build is byte-identical across machines**: fresh clone + bootstrap ⇒
  `1,479,692 B`, sha256 `082fa810a3ef40db73f2a20f87bb7f508a66d6c033bc4c7d5d462467ac90335b`,
  the same digest the laptop produces. That is what makes a CI artifact safe to hand out.

## 2. Flash

- **`pxt deploy` is unreliable on this macOS setup — build by hand and drag the hex.**
  Evidence: repeated failed deploys, 2026-09/10; `pxt build` + Finder drag always works.
- **Do not `cp built/binary.hex /Volumes/MICROBIT/`.** The copy can hang in uninterruptible
  (`U`) state and cannot be killed, taking the shell with it. Drag the file in Finder instead.
- Success looks like the drive unmounting and remounting: DAPLink reboots the board when the
  last byte lands.

## 3. Link

- **The robot ignores the link for its first 10–15 seconds after power-on.** Not a fault.
- **Ground is mandatory.** Without it the link works only intermittently.
- **Holding A while resetting keeps the micro:bit on USB serial on purpose** (developer escape
  hatch); the link stays off, so a program that "does nothing" may simply be in this mode.
- **A sender of your own must raise both serial buffers to 254 bytes.** The default 20-byte
  buffer silently truncates `hello` and long `emo_set` lines.

## 4. Triage checklist

Nothing happens on the robot — check in this order:

1. Is the program even running? `basic.showIcon(IconNames.Yes)` at the top: a tick
   on reset means it is.
2. Did you reflash? `built/binary.hex` must be newer than your last edit (§2).
3. Is the robot online? On the Wi-Fi edition the link stays off until the robot has
   been set up on a network once.

Everything else is already a rule above: start-up silence (§3), ground (§3), the
A-on-reset escape hatch (§3), buffers (§3).
