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

Nothing happens on the robot:

1. Has it finished starting up? The link is ignored for the first 10–15 seconds.
2. Is your program running? Put `basic.showIcon(IconNames.Yes)` at the top — a
   tick on reset means it is.
3. Did you reflash? `pxt build` must have rewritten `built/binary.hex` after
   your last edit; check the timestamp.
4. Is the robot online? On the Wi-Fi edition the link stays off until the robot
   has been set up on a network once.
5. Holding **A** while resetting keeps the micro:bit on USB serial on purpose
   (a developer escape hatch) — the link stays off.

Writing your own sender: raise both serial buffers to 254 bytes, cross the
wires (`P0` → robot RX, `P1` ← robot TX) and share ground.
