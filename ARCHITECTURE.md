# MicroBit — Architecture

> **This file:** how the micro:bit talks to the R300 — wire format, message shapes,
> operations, timing — plus the repository layout.
> **Not here:** build budget and link gotchas → [PROTOCOL_PROGRESS.md](PROTOCOL_PROGRESS.md);
> product and quick start → [README.md](README.md).

## Table of contents

| Section |
|---|
| [1. Doc maintenance requirements](#1-doc-maintenance-requirements) |
| [2. The link protocol](#2-the-link-protocol) |
| [3. Repository layout](#3-repository-layout) |
| [4. Build flow](#4-build-flow) |

## 1. Doc maintenance requirements

1. This file holds **stable facts**: wire format, ops, timing, file layout. No incidents, no dates.
2. A new gotcha goes to [PROTOCOL_PROGRESS.md](PROTOCOL_PROGRESS.md) as a rule plus its evidence.
3. Change the protocol only after the host side (`CompanionRobots/main/boards/R300/microbit/**`)
   has the matching op — the robot ignores unknown ops.
4. Every operation documented here must exist in `protocol.ts` / `r300.ts`; a doc-only op is a bug.

## 2. The link protocol

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
answer. The longest message any operation produces is a `cam_done` chunk at
about 233 bytes (9.11).

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
- A request the **robot** raises (`vol_done` 9.6, `mcp_done` 9.7, `cam_done`
  9.11, `detect_done` 9.12) allows only **300 ms** for its ack. `detect_done` is
  resent with the same id until acked (up to a 16 s budget); the others are sent
  once — a `cam_done` chunk lost in transit leaves a gap in the answer text
  rather than a retry.
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

**9.11 `cam_ask` / `cam_done`** — `{"q":"…"}`, or `{}`. Take a photo and put it
to the robot's vision model with a question, and get the answer back as text.
`q` is optional: leave it out and the robot asks its own, which is why an empty
question goes out as `{}` rather than `{"q":""}` — a literal empty `q` is refused.

```
{"s":"mb","id":70,"t":"r","op":"cam_ask","p":{},"ck":92}
{"s":"mb","id":71,"t":"r","op":"cam_ask","p":{"q":"What do you see?"},"ck":48}
{"s":"mb","id":72,"t":"r","op":"cam_ask","p":{"q":""},"ck":145}
{"s":"mb","id":73,"t":"r","op":"cam_ask","p":{"q":7},"ck":133}
{"s":"mb","id":74,"t":"r","op":"cam_ask","p":{"q":"hi"},"ck":100}
```

A whole exchange — the ack is **accepted**, not done, and the answer arrives
seconds later on R300's own request (the same two-stage shape as 9.6, 9.7 and
9.12):

```
{"s":"mb","id":70,"t":"r","op":"cam_ask","p":{"q":"What do you see?"},"ck":47}
{"s":"r300","id":70,"t":"a","op":"cam_ask","p":{"st":"ok"},"ck":4}
{"s":"r300","id":5,"t":"r","op":"cam_done","p":{"c":70,"i":0,"n":1,"t":"A bottle on the table."},"ck":156}
{"s":"mb","id":5,"t":"a","op":"cam_done","p":{"st":"ok"},"ck":3}
{"s":"r300","id":5,"t":"f","op":"cam_done","p":{"rt":4021},"ck":230}
```

The answer arrives as **chunks**: `{"c":<ask id>,"i":k,"n":N,"t":"…"}` for
k = 0…N-1, in order, each answered like any request. `c` is the id of the
`cam_ask`; `i`/`n` say which chunk this is — join them in order to get the text.
A call that fails after the ack sends **one frame instead of any chunk**:
`{"c":<ask id>,"e":"capture"｜"timeout"｜"vlm"}`. Chunks are 150 bytes at most and
there are at most 8 of them (~1.2 KB); a longer answer is cut there, with no
marker of its own.

⚠️ **No AI conversation is needed.** The vision endpoint's address is baked into
R300 at boot — a server-supplied one only overrides the same address — so this
works on a robot that has never been talked to.

⚠️ **The work takes a few seconds** — about 3–6 typically, 20 in the worst case
(the robot's vision call times out there). The wheels and hands keep working the
whole time; nothing about the robot's own state changes.

⚠️ Keep the question to **ASCII**, like every other payload (2). The block
escapes `"`, `\` and control characters for you, but a question in Chinese, or
with an accent in it, is not covered by the vectors below and has not been on the
bench. The answer text rides the same checksum back — a model reply in another
script cannot survive it, and that chunk is lost in transit.

`badarg` covers a malformed payload, a `q` that is present but not a usable
string, a unit with no camera, limited-charging mode, **and a vision call already
in flight** — a program cannot tell those apart. A refusal is cached against
`(id, op)` (7 #4), so a retry needs a **new id** — which is what the extension's
sender gives every request anyway.

`noop` means that robot's firmware predates this op — the same lesson as
`ai_set`.

Test vectors, each checked against the rule in (7 #4):

| Request | Answer |
|---|---|
| `{"s":"mb","id":70,"t":"r","op":"cam_ask","p":{},"ck":92}` | `ok` — the robot's own question, then a `cam_done` with the answer |
| `{"s":"mb","id":71,"t":"r","op":"cam_ask","p":{"q":"What do you see?"},"ck":48}` | `ok` |
| `{"s":"mb","id":72,"t":"r","op":"cam_ask","p":{"q":""},"ck":145}` | `badarg` — `q` present but empty |
| `{"s":"mb","id":73,"t":"r","op":"cam_ask","p":{"q":7},"ck":133}` | `badarg` — `q` is a number |
| `{"s":"mb","id":74,"t":"r","op":"cam_ask","p":{"q":"hi"},"ck":100}` | `ok` — a new id, so not the cached refusal |

The ids here are consecutive but the questions are not, so the `ck` column has no
pattern to read the way 9.9's and 9.10's do. 70 → 71 is +212 because the id rises
by 1 and the question's 22 characters add 1747, and 1748 wraps to 212. Check a
vector against its own line — the sum of every byte up to `,"ck":` — rather than
against its neighbour.

**9.12 `detect_set` / `detect_done`** — `{"tg":"apple"}` asks whether a named object
is in front of the robot. The answer comes back as a **request of its own**, the
same two-stage shape as `vol_set` / `vol_done` (9.6) and `mcp_take` / `mcp_done`
(9.7) — except that this second stage carries something to branch on, not just a
confirmation:

```
{"s":"mb","id":70,"t":"r","op":"detect_set","p":{"tg":"apple"},"ck":96}
{"s":"r300","id":70,"t":"a","op":"detect_set","p":{"st":"ok"},"ck":89}
{"s":"r300","id":3,"t":"r","op":"detect_done","p":{"tg":"apple","rs":"y"},"ck":8}
{"s":"mb","id":3,"t":"a","op":"detect_done","p":{"st":"ok"},"ck":73}
{"s":"r300","id":3,"t":"f","op":"detect_done","p":{"rt":812},"ck":0}
```

The ack on the second line means **accepted**, not "the robot looked" — at that
moment nothing has been seen. The verdict arrives on the third line as R300's own
request, carrying the object back with it; the micro:bit answers that request, and
never sends the `f` (6 — the side that sends the `r` is the side that closes it).

| Field | Meaning |
|---|---|
| `tg` | the object to look for: 1–**32 bytes**, the link's own cap — printable, no `"` and no `\` |
| `rs` | the verdict, exactly `"y"` or `"n"` — there is no third value |

⚠️ **Silence is a real outcome.** R300 sends **nothing at all** — no error code, no
`detect_done` — in two cases:

- the model answers in words instead of looking, and the request lapses on R300's
  own timer (~30 s, not measured); or
- the vision reply contains neither the word "yes" nor the word "no". R300 will not
  guess, because a wrong `"n"` is a wrong branch in a child's program.

So whatever waits for a verdict has to time out on its own, and cannot tell "no"
from "never answered" — the extension's waiting block reports false for both.

⚠️ **That lapse is not the whole deadline.** The ~30 s covers only the model
reaching the tool; the vision call then rides on top of it and may take another 20
(~9 is typical). A wait of 20 or 30 seconds can therefore expire on a verdict that
is still coming — and there is no way to tell that from a look that never happened,
so a program gets the same false either way.

⚠️ **One look at a time.** A second `detect_set` while the first is still unanswered
is `badarg`: replacing it would leave the first program waiting for ever. A request
the robot never gets round to is abandoned, and that lapse is what makes room for
the next one.

⚠️ **No AI conversation is needed** — the same as `cam_ask` (9.11): R300 carries
the vision endpoint's address from boot, so a unit straight from power-up answers
the same as any other.

⚠️ **The target has a byte cap, and it is the wire's own 32.** R300 does not look
at the object itself: it builds a short question — `Is there a <target> in this
image? Answer with only one word: yes or no.` — and sends it with the photo
straight to the vision model (9.11's door). There is no server text limit on that
path and no wake-word channel any more, so the only cap left is the link's own
line; past it R300 refuses the request with `badarg` at accept time and sends
nothing.

Bytes are not characters — an accented letter costs 2, a Chinese character 3 — so
six Chinese characters is 18 bytes. (A non-ASCII target is refused here whatever its
length, for the checksum reason in the next warning; the byte count is what will
matter if that is ever lifted.)

The extension keeps its one copy in `MAX_TARGET_BYTES` (protocol.ts) and reports
the same `badarg` R300 would, so a program's answer does not depend on which side
noticed first.

⚠️ **A non-ASCII target is refused here, not by R300.** R300 measures the target in
bytes like the cap above, but a target outside ASCII cannot survive the trip whatever
its length — the checksum in (4) is a byte sum, and the extension's is still computed
over UTF-16 code units (see 9.11). The block reports `badarg` without sending, rather
than leaving a program to wait out its own timeout for an answer that cannot come.

`badarg` covers a malformed payload, a target that is missing, empty, over 32 bytes
or unsafe, a unit with no camera, limited-charging mode, and a vision call already
in flight — a program cannot tell those apart. A refusal is cached against
`(id, op)` (7 #4), so a retry needs a **new id**.

`noop` means that robot's firmware predates this pair — the same lesson as `ai_set`.

Test vectors, each checked against the rule in (7 #4):

| Request | Answer |
|---|---|
| `{"s":"mb","id":70,"t":"r","op":"detect_set","p":{"tg":"apple"},"ck":96}` | `ok`, then a `detect_done` about `apple` |
| `{"s":"mb","id":71,"t":"r","op":"detect_set","p":{"tg":"red apple"},"ck":188}` | `ok` — a space is fine, and it is one target |
| `{"s":"mb","id":72,"t":"r","op":"detect_set","p":{},"ck":179}` | `badarg` — `tg` missing |
| `{"s":"mb","id":73,"t":"r","op":"detect_set","p":{"tg":""},"ck":81}` | `badarg` — `tg` empty |
| `{"s":"mb","id":74,"t":"r","op":"detect_set","p":{"tg":7},"ck":69}` | `badarg` — `tg` is a number |
| `{"s":"mb","id":75,"t":"r","op":"detect_set","p":{"tg":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"ck":115}` | `ok` — 32 bytes, the last target that gets asked |
| `{"s":"mb","id":76,"t":"r","op":"detect_set","p":{"tg":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"ck":213}` | `badarg` — 33 bytes, one past the wire's cap |

70 → 71 is +92 because the id rises by 1 and `red ` adds 347, and 348 wraps to 92.
Everything from 72 on needs a hand-built line: the extension refuses a target that
is empty, over 32 bytes, unsafe or non-ASCII before it puts anything on the wire, in
the same way that 9.11's `{"q":""}` cannot be reached from its block. The last two
rows mark the boundary — 32 bytes is answered, 33 is not.

### 10. Timing summary

| | Period | Ack timeout | Gives up |
|---|---|---|---|
| `hello` | 500 ms | 300 ms | never |
| `live` | 500 ms | 300 ms | after 2 consecutive misses → handshake again |
| requests | one at a time | 500 ms | after 2 retries with the same id |
| `detect_done` | one per look | 300 ms | resent (same id) until acked, up to 16 s |
| `cam_done` chunks | in order, one per photo | 300 ms | never — a lost chunk leaves a gap |

### 11. Errors and limits

`badck` (resend, same id) · `badver` (version mismatch) · `noop` (unknown op) ·
`badarg` (bad payload) · `busy` (temporarily refusing).

253 bytes per line maximum; both serial buffers are 254 bytes.

A detection target is **32 bytes**, the wire's own cap: past it R300 refuses the
request at accept time with `badarg` (9.12). Bytes, not characters — an Arabic
letter costs 2 and a CJK character 3, so a target that looks short can be over. The
extension refuses the same targets locally and reports the same `badarg`, so the
block's answer does not depend on which side noticed.

Not every failure has a code. A two-stage operation is acked long before it is
finished, and the second stage can be missing entirely: a detection whose reply
carries neither "yes" nor "no" sends nothing at all (9.12) — no error, no verdict —
while a failed photo call answers with an error frame instead of text (9.11).
Nothing is retried and nothing is refused — the program sees only the end of its
own wait, which is why a looking block has a timeout to fall back on.

## 3. Repository layout

This repository is itself a MakeCode extension.

This repository is itself a MakeCode extension.

| Path | What |
|---|---|
| `pxt.json` | Extension manifest |
| `protocol.ts` | Protocol layer: checksum, envelope, replies |
| `r300.ts` | The block groups and the `r300` API; connects at power-up |
| `test.ts` | Local test — compiled only when this repo is the top-level project |
| `vision_only.ts` | VLM-only bench: the camera blocks with no AI conversation, built via `testFiles` |
| `test_2.ts` · `test_emotion.ts` · `test_mcp_high_five.ts` | Bench demos, copied into MakeCode by hand |
| `legacy/` | Retired MicroPython version, kept for reference |
| `built/` | Build output — flash `built/binary.hex` |

## 4. Build flow

`pxt build` compiles `files` **and** `testFiles` into one hex; `scripts/custom_release.py` runs it
under the machine-wide build lock and copies the result to `releases/`. Steps and the flash
procedure are in [README.md](README.md) §Build and flash.
