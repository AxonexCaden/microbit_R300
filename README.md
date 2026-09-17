# R300 EDU · micro:bit extension

A MakeCode extension for the **BBC micro:bit V2** that drives the R300 EDU robot:
move it, pose its arms, change its face, set its volume — and record a routine
once so the robot repeats it on a voice command.

The extension opens the link by itself when the micro:bit powers up: there is no
connect block and nothing to switch on. You need a micro:bit V2 and an R300 EDU
robot.

**Updated:** 2026-09-17

---

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

---

## What you can control

Eight groups in the toolbox:

| Group | What it does |
|---|---|
| **R300 Movement** | Forward or backward for 1–3 seconds, turn left/right on the spot, stop driving now — plus `drive rot fwd for ms` under **More**, the full manual control |
| **R300 Hands** | Either hand, or both, to `up` (180°), `down` (90°) or `back` (0°) — plus both angles by hand under **More** |
| **R300 Emotion** | One of 19 faces on the robot's eyes; the face stays until you change it |
| **R300 Speaker** | `set speaker volume to` / `change speaker volume by` / read `speaker volume` — the same set, change, read shape Music gives tempo |
| **R300 AI** | Talk to the robot's AI: `start` / `end an AI conversation` (what its own boot button does), and describe + record a routine so the robot replays it on a voice command. `moves recorded` and `routine was cut short?` report what the last take captured |
| **R300 Talk Over** | Allow, or stop, talking over the robot's reply — two absolute states, never a toggle |
| **R300 Status** | `R300 is connected` and `the last command was accepted` — the two values a program can put in a variable or test in an `if` |
| **R300 Music** | `play song` — one of the robot's three songs, by name. Music only: the robot does not drive itself while a song plays, and it stops hearing you until the song ends |

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
| `r300.describe(name, desc)` | Name (1–24 chars of `[a-z0-9_]`) and describe a recording before taking it |
| `r300.takeStart()` / `r300.takeFinish()` | Start / finish a recording |
| `r300.send(op, pJson)` | Send any operation directly |

Every call answers with the robot's reply: `"ok"`, `"badarg"`, `"noop"`,
`"badver"`, `"busy"`, `"timeout"`, `"long"` or `"stopped"`.
**`"ok"` means the robot accepted the message — not that a move has finished.**

---

## The link protocol

One JSON object per line, robot and micro:bit taking turns; the robot leads the
conversation. This is enough to follow the traffic or write a sender of your own.

### 1. Physical layer

| | |
|---|---|
| Interface | UART, 115200 baud, 8N1 |
| Wires | micro:bit `P0` → robot RX; micro:bit `P1` ← robot TX; ground shared |
| Connector | Robot `J1` |
| Buffers | 254 bytes both sides. MakeCode's default of 20 bytes is shorter than the shortest message (69) and truncates everything, silently |

### 2. Framing

One JSON object + one `\n` (a receiver also accepts `\r`), ASCII only, no
whitespace, **253 bytes maximum** — a longer line is dropped with no log and no
answer. The longest message any operation produces is about 127 bytes.

### 3. Envelope

```
{"v":2,"s":"r300","id":3,"t":"r","op":"hello","p":{"fw":"1.0.0"},"ck":129}
```

| Field | Meaning |
|---|---|
| `v` | Protocol version — only handshake lines carry it; when present it must equal the receiver's |
| `s` | Sender: `"r300"` or `"mb"`. A line carrying your own tag is your own transmission echoed back by a floating wire — drop it (7 #0) |
| `id` | Ties a request to its reply (5) |
| `t` | `"r"` request · `"a"` ack · `"f"` fin (6) |
| `op` | Operation name: up to 16 characters of `[a-z0-9_]` |
| `p` | Payload; `{}` when there is nothing to say |
| `ck` | Checksum, always the last field (4) |

A sender emits fields in the order `v?, s, id, t, op, p, ck`; a receiver may
only rely on `ck` being last.

### 4. Checksum

Sum every byte of the object, modulo 256, and place it as `,"ck":N` before the
closing `}`. The receiver finds the **last** `,"ck":`, restores the closing `}`,
recomputes and compares.

### 5. Ids

Both sides number requests 0–99 and wrap around; a retry reuses the id it is
retrying. Receivers accept any 0–255.

### 6. The three parts: r → a → f

```
initiator ── r ──> peer
initiator <── a ── peer        the peer answers
initiator ── f ──> peer        the initiator closes, carrying {"rt":ms}
```

The side that sends the `r` sends the `f`. **Never answer an `a` or an `f`** —
that loops forever.

### 7. Receiver checks, in order

| # | Check | On failure |
|---|---|---|
| 0 | the line is not the receiver's own tag (own tag = its transmission, echoed back) | drop |
| 1 | valid JSON object | drop |
| 2 | checksum valid | answer `badck` if the line looked like a request; drop otherwise |
| 3 | `v`, **if present**, equals the receiver's | answer `badver`; one exception — a `badver` ack for the request you are waiting on is accepted, or a mismatched pair could never tell each other |
| 4 | `(id, op)` not the last request already served | replay the previous answer without running it again |

Beyond the table: a request refused **before execution** (`badck` / `badver` /
`noop` / `badarg`) is **not recorded** — a correct resend of the same id must
still run — and the record is **cleared when a new session opens**: the robot
clears its own the moment `hello`'s ack arrives, so a micro:bit that restarted
at id 0 cannot be mistaken for a replay. The micro:bit keeps no record at all.

### 8. Sender rules

- Ack timeout **500 ms** (`hello`: 300 ms). On timeout or `badck`, resend with
  the **same id**, up to two retries.
- One request in flight per direction. An incoming request is answered
  immediately, never queued.
- The robot probes `hello` every **500 ms** until answered, with no attempt
  limit — and if the answer says the versions disagree, it keeps probing (once
  a second) instead of giving up.

### 9. Operations

**9.1 `live`** (robot → micro:bit) — `{}` → `{"st":"ok","id":N}`. Liveness
after the handshake; two consecutive misses send the link back to the
handshake. The payload `id` is a per-boot session number (1–99) — when it
changes, the robot knows the micro:bit restarted.

**9.2 `hello`** (robot → micro:bit) — `{"fw":"1.0.0"}` →
`{"st":"ok","ex":"0.1.0"}`. The handshake, and where the two sides exchange
firmware and extension versions.

**9.3 `emo_set`** — `{"em":"happy"}`. Face. The robot checks the name's format
only; the extension offers the 19 names.

**9.4 `leg_set`** — `{"ro":0,"fd":100,"ms":1000}`. Wheels: two percents of full
speed and a duration. All three keys are required.

**9.5 `arm_set`** — `{"a1":100,"a2":50}`. Arm angles, 0–180 (0 = forward,
90 = down, 180 = back); omit a key to leave that arm alone.

**9.6 `vol_set` / `vol_done`** — `{"vl":70}`. The ack means "accepted"; the
robot follows with its own `vol_done` request once the level has really landed.

**9.7 `mcp_desc` / `mcp_take` / `mcp_done`** — recording. Describe a routine
with `{"name":…,"desc":…}` — the name is 1–24 characters of `[a-z0-9_]`, a
description longer than 34 characters is sent in pieces, and the same name
appends. Start and finish with `{"state":"start"｜"finish"}`. A take captures
arm and leg moves, any song the program started, and the faces it showed — the
robot replays all of them by itself when the tool runs; the micro:bit takes no
part in a replay. The robot reports the finished tool with
`{"name":…,"steps":N,"drop":M}` — `drop` counts steps lost past the 64-step
ceiling.

**9.8 `aec_set`** — `{"on":0｜1}`. Talk-over: `1` lets the user interrupt the
robot mid-reply; `0` leaves only the wake word. Absolute, never a toggle.
Accepted only while the robot is idle — otherwise `badarg`, worth retrying once
the reply finishes (every send takes a new id). `noop` means that robot's
firmware was built without the feature. Not stored: a reboot returns to the
default.

**9.9 `ai_set`** — `{"on":0｜1}`. Start or end a conversation with the AI: the
same thing one press of the robot's boot button does. Absolute, never a toggle —
`1` says "be in a conversation", `0` says "be out of it".

```
{"s":"mb","id":93,"t":"r","op":"ai_set","p":{"on":1},"ck":147}
{"s":"r300","id":93,"t":"a","op":"ai_set","p":{"st":"ok","on":1},"ck":<N>}
{"s":"r300","id":93,"t":"a","op":"ai_set","p":{"st":"err","e":"badarg"},"ck":<N>}
```

No `v` on this line, and no second reply after the ack. The ack means
**accepted**, not applied: an `ok` does not promise the conversation has opened
or closed yet.

`{"on":1}` from idle opens the connection; `{"on":0}` while listening closes it.
`{"on":1}` while already connecting, listening or speaking, and `{"on":0}` from
idle, are both `ok` and change nothing.

`badarg` covers a malformed payload **and** a refusal by state, and a program
cannot tell the two apart:

- `{"on":0}` **while the robot is speaking** — it will not cut off its own reply.
  Wait for it to finish, or send it again shortly. This is the one that surprises
  students: the block is not a stop button.
- `{"on":0}` while connecting — a connection in progress cannot be cancelled.
- either direction during start-up, activation, WiFi setup or the audio test.
- while the robot is in limited-charging mode.
- `on` is anything other than exactly `0` or `1` — a string, `2`, or missing. It
  is refused, never clamped.

A refusal is cached against `(id, op)` (7 #4), so a retry needs a **new id** —
which is what the extension's sender gives every request anyway.

Test vectors, each checked against the rule in (7 #4):

| Request | Answer |
|---|---|
| `{"s":"mb","id":93,"t":"r","op":"ai_set","p":{"on":1},"ck":147}` | `ok`, `on:1` |
| `{"s":"mb","id":94,"t":"r","op":"ai_set","p":{"on":0},"ck":147}` | `ok`, `on:0` |
| `{"s":"mb","id":95,"t":"r","op":"ai_set","p":{},"ck":9}` | `badarg` — `on` missing |
| `{"s":"mb","id":96,"t":"r","op":"ai_set","p":{"on":"1"},"ck":218}` | `badarg` — `on` is a string |
| `{"s":"mb","id":97,"t":"r","op":"ai_set","p":{"on":2},"ck":152}` | `badarg` — not `0`/`1` |

93 and 94 sharing `ck:147` is correct, not a typo: the id rises by 1 while `on`
falls by 1, and the two cancel.

**9.10 `song_set`** — `{"ix":0｜1｜2}`. Play one of the robot's three songs by
number: `0` = ActiveSummer, `1` = CosmicFluff, `2` = Fever. The ack means
**accepted**, not audible.

```
{"s":"mb","id":60,"t":"r","op":"song_set","p":{"ix":0},"ck":125}
{"s":"r300","id":60,"t":"a","op":"song_set","p":{"st":"ok","ix":0},"ck":<N>}
{"s":"r300","id":60,"t":"a","op":"song_set","p":{"st":"err","e":"badarg"},"ck":<N>}
```

The ack carries the index back. There is no second reply after it, and nothing
later reports that the song ended.

⚠️ **MUSIC ONLY** — the robot does not move on its own while a song plays. Your
program keeps full control of the wheels and hands, so drive them yourself with
the movement blocks. That is the whole point of the block.

⚠️ There is **no "the song finished" reply, and no way to ask**. A song plays to
the end unless something interrupts it, so a program that wants to chain two
songs has to time the gap itself. A song cut short (the boot button, the robot's
own `stop_dance`, or the model starting a dance) is silent.

⚠️ While the music plays the robot **cannot hear anyone** — it mutes its own mic
so the song does not loop back, which means it cannot hear its wake word (9.9)
until the song ends.

`badarg` covers a malformed payload, an index outside 0–2, **and a song already
playing** — a program cannot tell those apart. It never replaces what is playing.
The index is the robot's own numbering, refused rather than clamped, so a wrong
one cannot quietly play song 0 instead. A refusal is cached against `(id, op)`
(7 #4), so a retry needs a **new id** — which is what the extension's sender gives
every request anyway.

`noop` means that robot's firmware predates this op — the same lesson as `ai_set`.

The index space is the robot's song list order and nothing more. If that order
ever changes, every saved student program points at a different song.

Test vectors, each checked against the rule in (7 #4):

| Request | Answer |
|---|---|
| `{"s":"mb","id":60,"t":"r","op":"song_set","p":{"ix":0},"ck":125}` | `ok`, `ix:0` |
| `{"s":"mb","id":61,"t":"r","op":"song_set","p":{"ix":1},"ck":127}` | `ok`, `ix:1` |
| `{"s":"mb","id":62,"t":"r","op":"song_set","p":{"ix":3},"ck":130}` | `badarg` — only 3 songs |
| `{"s":"mb","id":63,"t":"r","op":"song_set","p":{},"ck":241}` | `badarg` — `ix` missing |
| `{"s":"mb","id":64,"t":"r","op":"song_set","p":{"ix":"1"},"ck":198}` | `badarg` — `ix` is a string |

60 and 61 differ by exactly 2 — the id rises by 1 and the index rises by 1, so
the two stack — and 62 is 3 beyond 61 for the same reason. 64 is the odd one at
+73: `"1"` is three bytes where the bare `0` was one, and the two quote
characters are what the gap is made of.

### 10. Timing summary

| | Period | Ack timeout | Gives up |
|---|---|---|---|
| `hello` | 500 ms | 300 ms | never |
| `live` | 500 ms | 300 ms | after 2 consecutive misses → handshake again |
| requests | one at a time | 500 ms | after 2 retries with the same id |

### 11. Errors and limits

`badck` (resend, same id) · `badver` (version mismatch) · `noop` (unknown op) ·
`badarg` (bad payload) · `busy` (temporarily refusing).

253 bytes per line maximum; both serial buffers are 254 bytes.

---

## Troubleshooting

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

---

## Repository & development

This repository is itself a MakeCode extension.

| Path | What |
|---|---|
| `pxt.json` | Extension manifest |
| `protocol.ts` | Protocol layer: checksum, envelope, replies |
| `r300.ts` | The block groups and the `r300` API; connects at power-up |
| `test.ts` | Local test — compiled only when this repo is the top-level project |
| `test_2.ts` · `test_emotion.ts` · `test_mcp_high_five.ts` | Bench demos, copied into MakeCode by hand |
| `legacy/` | Retired MicroPython version, kept for reference |
| `built/` | Build output — flash `built/binary.hex` |

Build with `pxt build`, then drag `built/binary.hex` onto the `MICROBIT` drive.
On this macOS setup, `pxt deploy` is unreliable and copying with `cp` hangs
without writing — drag in Finder instead.

Developed against pxt-microbit v9.1.1 and pxt-core v13.0.1.
