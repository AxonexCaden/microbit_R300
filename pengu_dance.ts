// pengu_dance.ts — the Pengu chassis dance, ported from the R300 firmware beatmap
// (main/characters/pengu/dance_beatmap_pengu.h: 88 events, BPM 129.2, ~31 s, silent).
//
// What the firmware does: every event sends the chassis a bare `x/y` command (no duration),
// which replaces the previous one and runs until the next event — about 348 ms later. `NONE`
// events send nothing, so the move before them simply carries on. The engine also delays every
// event by 100 ms (`kAudioLatencyOffsetMs`) to line the move up with the audio, so the first
// beat (465 ms in the table) actually moves at 565 ms.
//
// This port keeps the same moves and the same intervals. Because a beat is shorter than any of
// the named blocks (1 s minimum) and the turns are curves rather than spins, every beat is the
// Custom Control block "drive rot … fwd … for … ms" — the exact counterpart of the firmware's
// `x/y` command, with the ms set to the gap until the next real move. The NONE events are
// omitted and the move before each one is lengthened to reach the next real move, which is
// what the firmware does by sending nothing.
//
// The firmware levels, which this file reproduces:
//     forward   rot 0    fwd 80        turn left   rot -70  fwd 30
//     backward  rot 0    fwd -80       turn right  rot  70  fwd 30
//     spin CW   rot 80   fwd 0         spin CCW    rot -80  fwd 0
//
// ⚠️ SPEED_SCALE. The firmware drives at 70-80%. On a floor where those motors need full power,
// raise this to 1.25: 80 becomes 100 and 70/30 becomes about 88/38. 1.0 is the firmware exactly.
//
// ⚠️ Timing drift. Every drive block costs a UART round trip before its wait starts, so the
// routine stretches by a small percentage over the 31 s. That does not matter silently; if you
// add music later, re-time against one clock instead of the blocks' own pauses.
//
//   A    — dance (waits for the R300 link first)
//   A+B  — stop the wheels now; the rest of the beats are skipped
//
// Not part of the extension: add it to pxt.json's testFiles (one program at a time) when you
// flash it.

const SPEED_SCALE = 1.0

let dancing = false
let stopped = false

input.onButtonPressed(Button.A, function () {
    if (dancing) return
    if (!awaitLink()) return
    dancing = true
    stopped = false
    dance()
    dancing = false
})

// A move is waited out by drive(), which blocks this stack; the stop below runs in its own
// fiber and interrupts the wheels, and `stopped` keeps the remaining beats from starting.
input.onButtonPressed(Button.AB, function () {
    stopped = true
    r300_movement.stop()
})

function dance() {
    r300_movement.stop()
    basic.pause(565)                 // first beat at 465 ms + the engine's 100 ms audio offset

    // ── Bar 1 (intro) ──────────────────────────────────────────────
    beat(-70, 30, 464)               // 465  turn left
    beat(-70, 30, 464)               // 929  turn left
    beat(-70, 30, 349)               // 1393 turn left
    beat(-70, 30, 348)               // 1742 turn left
    // ── Bar 2 ──────────────────────────────────────────────────────
    beat(0, 80, 348)                 // 2090 forward
    beat(0, 80, 349)                 // 2438 forward
    beat(-80, 0, 348)                // 2787 spin CCW
    beat(-80, 0, 348)                // 3135 spin CCW
    beat(-70, 30, 348)               // 3483 turn left
    // ── Bar 3 ──────────────────────────────────────────────────────
    beat(70, 30, 349)                // 3831 turn right
    beat(-70, 30, 348)               // 4180 turn left
    beat(70, 30, 348)                // 4528 turn right
    beat(0, -80, 349)                // 4876 backward
    beat(0, -80, 348)                // 5225 backward
    // ── Bar 4 ──────────────────────────────────────────────────────
    beat(0, 80, 348)                 // 5573 forward
    beat(0, 80, 349)                 // 5921 forward
    beat(-80, 0, 348)                // 6270 spin CCW
    beat(-80, 0, 348)                // 6618 spin CCW
    beat(-70, 30, 348)               // 6966 turn left
    beat(70, 30, 349)                // 7314 turn right
    // ── Bar 5 ──────────────────────────────────────────────────────
    beat(-70, 30, 348)               // 7663 turn left
    beat(70, 30, 348)                // 8011 turn right
    beat(-70, 30, 349)               // 8359 turn left
    beat(0, -80, 348)                // 8708 backward
    beat(0, -80, 348)                // 9056 backward
    // ── Bar 6 — each move now runs through a NONE beat ─────────────
    beat(0, 80, 697)                 // 9404 forward  (through 9752)
    beat(0, -80, 696)                // 10101 backward (through 10449)
    beat(0, 80, 697)                 // 10797 forward (through 11146)
    // ── Bar 7 ──────────────────────────────────────────────────────
    beat(-80, 0, 348)                // 11494 spin CCW
    beat(-80, 0, 697)                // 11842 spin CCW (through 12191)
    beat(80, 0, 696)                 // 12539 spin CW  (through 12887)
    // ── Bar 8 ──────────────────────────────────────────────────────
    beat(-80, 0, 697)                // 13235 spin CCW (through 13584)
    beat(0, -80, 697)                // 13932 backward (through 14280)
    beat(0, 80, 696)                 // 14629 forward  (through 14977)
    // ── Bar 9 ──────────────────────────────────────────────────────
    beat(0, -80, 349)                // 15325 backward
    beat(80, 0, 348)                 // 15674 spin CW
    beat(80, 0, 348)                 // 16022 spin CW
    beat(80, 0, 348)                 // 16370 spin CW
    // ── Bar 10 ─────────────────────────────────────────────────────
    beat(0, 80, 348)                 // 16718 forward
    beat(0, 80, 349)                 // 17066 forward
    beat(-80, 0, 348)                // 17415 spin CCW
    beat(-80, 0, 348)                // 17763 spin CCW
    beat(-70, 30, 348)               // 18111 turn left
    // ── Bar 11 ─────────────────────────────────────────────────────
    beat(70, 30, 349)                // 18459 turn right
    beat(-70, 30, 348)               // 18808 turn left
    beat(70, 30, 348)                // 19156 turn right
    beat(0, -80, 349)                // 19504 backward
    beat(0, -80, 348)                // 19853 backward
    // ── Bar 12 ─────────────────────────────────────────────────────
    beat(0, 80, 348)                 // 20201 forward
    beat(0, 80, 349)                 // 20549 forward
    beat(-80, 0, 348)                // 20898 spin CCW
    beat(-80, 0, 348)                // 21246 spin CCW
    beat(-70, 30, 348)               // 21594 turn left
    beat(70, 30, 349)                // 21942 turn right
    // ── Bar 13 ─────────────────────────────────────────────────────
    beat(-70, 30, 348)               // 22291 turn left
    beat(70, 30, 348)                // 22639 turn right
    beat(-70, 30, 349)               // 22987 turn left
    beat(0, -80, 348)                // 23336 backward
    beat(0, -80, 348)                // 23684 backward
    // ── Bar 14 — through a NONE beat again ─────────────────────────
    beat(0, 80, 697)                 // 24032 forward  (through 24380)
    beat(0, -80, 696)                // 24729 backward (through 25077)
    beat(0, 80, 697)                 // 25425 forward  (through 25774)
    // ── Bar 15 ─────────────────────────────────────────────────────
    beat(-80, 0, 348)                // 26122 spin CCW
    beat(-80, 0, 697)                // 26470 spin CCW (through 26819)
    beat(80, 0, 696)                 // 27167 spin CW  (through 27515)
    // ── Bar 16 ─────────────────────────────────────────────────────
    beat(-80, 0, 697)                // 27863 spin CCW (through 28212)
    beat(0, -80, 697)                // 28560 backward (through 28908)
    beat(0, 80, 696)                 // 29257 forward  (through 29605)
    // ── Bar 17 ─────────────────────────────────────────────────────
    beat(0, -80, 349)                // 29953 backward
    beat(80, 0, 348)                 // 30302 spin CW
    beat(80, 0, 348)                 // 30650 spin CW
    beat(80, 0, 50)                  // 30998 spin CW — the last tick before the engine's stop

    r300_movement.stop()             // the firmware's kStopCmd at the natural end
}

// One beat. The firmware's x/y percentages, scaled once, then handed to the Custom Control
// block. drive() rounds and clamps, so a scale of 1.25 turns 80 into 100 and 70/30 into ~88/38.
function beat(rot: number, fwd: number, ms: number) {
    if (stopped) return
    r300_movement.drive(rot * SPEED_SCALE, fwd * SPEED_SCALE, ms)
}

// Bounded wait for the R300 link: the handshake takes a few seconds after R300 powers up.
function awaitLink(): boolean {
    let waited = 0
    while (!r300_status.isConnected() && waited < 20000) {
        basic.pause(100)
        waited += 100
    }
    return r300_status.isConnected()
}
