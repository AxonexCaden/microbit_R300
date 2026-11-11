# R300 EDU · micro:bit extension

A MakeCode extension for the **BBC micro:bit V2** that drives the R300 EDU robot:
move it, pose its arms, change its face, set its volume — and record a routine
once so the robot repeats it on a voice command.

The extension opens the link by itself when the micro:bit powers up: there is no
connect block and nothing to switch on. You need a micro:bit V2 and an R300 EDU
robot.

**Updated:** 2026-11-09

## Docs map

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The v2 link protocol, message shapes, operations, repository layout |
| [PROTOCOL_PROGRESS.md](PROTOCOL_PROGRESS.md) | Build-budget and link gotchas, with the evidence for each rule |
| [ISSUES_AND_PROGRESS.md](ISSUES_AND_PROGRESS.md) | Phase and issue index (canonical issues live on GitHub) |
| [scripts/custom_release.py](scripts/custom_release.py) | The only build entry point (`pxt build` under the machine-wide build lock) |

## Quick start

1. In MakeCode, click **Extensions** and add `AxonexCaden/microbit_R300`.
2. Wire the micro:bit to the robot's **J1** socket:

   | micro:bit | Robot |
   |---|---|
   | `P0` | RX |
   | `P1` | TX |
   | `GND` | GND |

   The link is a plain UART at 115200 baud, 8N1. Note the crossover on the two
   signal wires, and connect ground — without it the link only works
   intermittently.

3. Your first program — change the face:

   ```ts
   input.onButtonPressed(Button.A, function () {
       r300_emotion.showFace(r300.Emoji.Happy)
   })
   ```

4. Click **Download**, then drag the `.hex` file onto the `MICROBIT` drive.

Two things that surprise people:

- **You never connect.** The extension connects at power-up.
- **The robot ignores the link for its first 10–15 seconds** after power-on.
  That is start-up, not a fault.

## What you can control

Eight groups in the toolbox:

| Group | What it does |
|---|---|
| **R300 Movement** | Forward or backward for 1–3 seconds, turn left/right on the spot, stop driving now — plus `drive rot fwd for ms` under **Custom Control**, the full manual control |
| **R300 Hands** | Either hand, or both, to `up` (0°), `down` (90°) or `back` (180°) — plus both angles by hand under **Custom Control** |
| **R300 Emotion** | One of 19 faces on the robot's eyes; the face stays until you change it |
| **R300 Speaker** | `set speaker volume to` / `turn speaker volume up or down by` / read `speaker volume` — the same set, change, read shape Music gives tempo |
| **R300 AI** | Talk to the robot's AI: `start` / `end an AI conversation` (what its own boot button does), and describe + record a routine so the robot replays it on a voice command. `moves recorded` and `routine was cut short?` report what the last take captured. Under **Talk Over**, allow or stop talking over the robot's reply — two absolute states, never a toggle |
| **R300 Status** | `R300 is connected` and `the last command was accepted` — the two values a program can put in a variable or test in an `if` |
| **R300 Music** | `play song` — one of the robot's three songs, by name. Music only: the robot does not drive itself while a song plays, and it stops hearing you until the song ends |
| **R300 Camera** | `take a photo and ask` — one photo goes to the robot's vision model with your question, and `wait for the photo answer` returns what the model wrote as text on the LED. `object detection for` (its label carries the object's **32-byte** limit) names the object once, and `object detection result is true` waits up to 20 seconds on that same object — the pair that answers yes/no directly. None of them needs an AI conversation — the vision endpoint is baked into the robot at boot |

Two groups in one program:

```ts
input.onButtonPressed(Button.A, function () {
    r300_movement.moveForward(1)
    r300_hands.bothHands(r300_hands.HandPose.Up)
})
```

### Also callable from TypeScript

These have no blocks — use the **JavaScript** tab:

| Function | Does |
|---|---|
| `r300.motor(rot, fwd, ms)` | Wheels directly: −100…100, −100…100, 0…3000 ms |
| `r300.stopNow()` | Stop now, cancelling any move in flight |
| `r300.arm(a1, a2)` | Both arm angles, 0–180; pass `-1` to leave one alone |
| `r300.aec(on)` | Talk-over on/off — absolute; needs a robot built with the feature |
| `r300.ai(on)` | Conversation with the AI on/off — absolute; the boot button's other half |
| `r300.volume(v)` | Volume, 0–100 |
| `r300.song(ix)` | Play one of the three songs, 0–2; needs a robot built with the feature |
| `r300.cam(q)` | Ask the robot's vision model about a photo; `q` optional. The answer comes back as `cam_done` chunks and lands in `lastPhotoAnswer` (`photoSeq` marks a finished one); no conversation needed |
| `r300.detect(tg)` | Ask whether one named object is visible, and get a yes or no back. `tg` is 1–32 ASCII bytes with no `"` or `\`; one look at a time; no conversation needed |
| `r300.describe(name, desc)` | Name (1–24 chars of `[a-z0-9_]`) and describe a recording before taking it |
| `r300.takeStart()` / `r300.takeFinish()` | Start / finish a recording |
| `r300.send(op, pJson)` | Send any operation directly |

Every call answers with the robot's reply: `"ok"`, `"badarg"`, `"noop"`,
`"badver"`, `"busy"`, `"timeout"`, `"long"` or `"stopped"`.
**`"ok"` means the robot accepted the message — not that a move has finished.**

## Build and flash

Two commands, both from the repository root — the folder holding `pxt.json`.

```zsh
cd path/to/microbit_R300                     # the repo root, holding pxt.json
pxt build                                    # → built/binary.hex
# then drag built/binary.hex onto the MICROBIT drive in Finder (do not cp — it can hang)
```

1. **Build.** `pxt build` compiles `files` **and** `testFiles` into one program,
   so a bench test left in `testFiles` ships inside the hex. Watch the exit code
   and the size: `error TS9283: program too big by N bytes` means it no longer
   fits. There is no local `tsc` — `pxt build` is the only thing that catches
   type errors, VS Code will not.
2. **Flash.** Plug in the micro:bit until Finder shows the `MICROBIT` drive,
   then copy the hex over. A successful copy unmounts and remounts the drive:
   DAPLink reboots the board the moment the last byte lands. If `cp` sits there
   without writing, stop it and drag `built/binary.hex` in Finder instead.

**Build from GitHub instead.** Actions → **Build micro:bit firmware** → Run workflow
(`products=mb-r300`, the valid ids being the ones listed in `ci/products.json`), or press the micro:bit tab on the Cloudflare build form
(`https://94338025.xyz/companion-build-form/`). The run uses the same
`scripts/custom_release.py` entry point, uploads the hex to the GitHub artifact **and**
to the **`CompanionRobots/microbit R300` subfolder** of the shared Feishu Drive folder
as `<stamp>_MB_r300_v<version>.hex`. Set that subfolder with the repo secret
**`FEISHU_FOLDER_MB`**; without the secret the upload falls back to the root folder
(`FEISHU_FOLDER_TOKEN`) and prints one `[warn]`. The same fallback covers a subfolder
the app cannot use — Feishu answers `1061043` when the app is not a collaborator — and
the hex still uploads to the root, so a folder-layout problem never turns the release
red. The Feishu app holds **only `drive:file:upload`**, not `drive:drive` or
`drive:drive:readonly`, so it cannot create or list the subfolder: open it by hand in
the Feishu UI, add the app as a collaborator, and copy the folder URL's tail into the
secret. It is manual-only on purpose: every run installs the toolchain and pulls yotta
dependencies.

⚠️ **The program has almost no bytes to spare.** Any new block costs a build cycle to pay for;
measure with `pxt build` and never guess — the evidence is in
[PROTOCOL_PROGRESS.md](PROTOCOL_PROGRESS.md) §1.

`pxt deploy` is unreliable on this macOS setup — build by hand and copy the hex.

To build and check the result without reading the log:

```zsh
pxt build > /tmp/pxt_build.log 2>&1; echo "exit=$?"
grep -inE "error|too big" /tmp/pxt_build.log
ls -l built/binary.hex
```

### Linux PC

Tested on Ubuntu, 2026-11-09 — Node.js v26.13.0, npm 11.20.0, Python 3.14,
pxt CLI 0.5.1. `pxt build` fetches its own target toolchain; no separate yotta
install is needed.

1. **Install once**, from the repo root (the folder holding `pxt.json`):

    npm ci
    npm install -g pxt

2. **Build** — exit 0 gives `releases/r300_v<version>.hex` (also `built/binary.hex`):

    python3 scripts/custom_release.py --name r300

3. **Flash** — the board mounts at `/run/media/<user>/MICROBIT`:

    cp releases/r300_v<version>.hex /run/media/<user>/MICROBIT/

`custom_release.py` is the same entry point CI uses: it writes the
`node_modules/pxtcli.json` local-target marker, runs `pxt install` for
`pxt_modules/`, takes the machine-wide build lock, and exits non-zero on
`error TS9283: program too big by N bytes` — check the exit code, not the log.
The macOS warning against `cp` does not apply on Linux; success unmounts then
remounts the drive.

### macOS environment

Verified on this machine, 2026-09-22:

| | Version |
|---|---|
| macOS | 15.7.7 (arm64) |
| Node.js | v25.2.1 |
| npm | 11.6.2 |
| pxt CLI | `~/.npm-global/bin/pxt` |
| pxt-microbit | v9.1.1 |
| pxt-core | v13.0.1 |

`pxt` accepts no `--version` flag, so read the toolchain versions from
`node_modules/pxt-microbit/package.json` and `node_modules/pxt-core/package.json`
instead. Developed against pxt-microbit v9.1.1 and pxt-core v13.0.1.
