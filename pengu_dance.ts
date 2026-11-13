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
// The levels this file uses, raised past the firmware's because the chassis now has smaller
// motors (the firmware value is in brackets):
//     forward   rot 0    fwd 100  (80)      turn left   rot -100  fwd 60  (-70 / 30)
//     backward  rot 0    fwd -100 (-80)     turn right  rot  100  fwd 60  (70 / 30)
//     spin CW   rot 100  fwd 0    (80)      spin CCW    rot -100  fwd 0   (-80)
//
// ⚠️ SPEED_SCALE multiplies every value again, for tuning on the floor; 1.0 leaves the numbers
// above exactly as written.
//
// Hands. Every beat also sets both servos, from a 16-beat cycle that repeats four and a half
// times across the dance. The order is chosen for continuity: no arm moves more than 90 degrees
// between beats except the deliberate 20/160 -> 160/20 swap, which needs ~140 on each. It
// contains the three sequences asked for:
//     both 0 -> both 90 -> both 180
//     right 90 / left 180 -> right 180 / left 90
//     right 20 / left 160 -> right 160 / left 20
//
// The nine poses (right / left):
//     A 20/160   B 160/20   C 0/0     D 180/180   E 90/90
//     F 90/180   G 180/90   H 90/0    I 0/90
// The cycle (beat 1..16):  C E D F G E C I A B H C I E H C
//
// ⚠️ Timing drift. Every drive block costs a UART round trip before its wait starts, so the
// routine stretches by a small percentage over the 31 s. That does not matter silently; if you
// add music later, re-time against one clock instead of the blocks' own pauses.
//
//   A          — dance (waits for the R300 link first)
//   radio 42   — the same start, sent by pengu_dance_remote.ts on a second micro:bit
//   radio 43   — stop, sent by the remote's B button
//   A+B        — stop the wheels now; the rest of the beats are skipped
//
// Not part of the extension: add it to pxt.json's testFiles (one program at a time) when you
// flash it.

const SPEED_SCALE = 1.0

// The per-beat hand poses, as (right, left) servo angles. beat() walks this array with a counter,
// so the cycle runs in order however many beats the dance has. See the cycle in the header.
const HAND_RIGHT = [0, 90, 180, 90, 180, 90, 0, 0, 20, 160, 90, 0, 0, 90, 90, 0]
const HAND_LEFT = [0, 90, 180, 180, 90, 90, 0, 90, 160, 20, 0, 0, 90, 90, 0, 0]
let beatIndex = 0

// Radio trigger. The remote board (pengu_dance_remote.ts) sends these on the same group; keep
// all three numbers identical in the two programs.
const RADIO_GROUP = 1
const DANCE_TRIGGER = 42
const STOP_TRIGGER = 43
radio.setGroup(RADIO_GROUP)

let dancing = false
let stopped = false

// ⚠️ startDance() blocks for the whole routine, so it must NEVER run inside the radio handler:
// that handler would not return to receive the stop packet until the dance ended. inBackground
// moves it to its own fiber; the `dancing` guard makes any extra fibers harmless. The A button
// uses the same shape so a local dance cannot starve the button events either.
input.onButtonPressed(Button.A, function () {
    control.inBackground(startDance)
})

// The remote board's buttons: A starts (ignored while a dance is already running), B stops.
radio.onReceivedNumber(function (receivedNumber: number) {
    if (receivedNumber == DANCE_TRIGGER) control.inBackground(startDance)
    else if (receivedNumber == STOP_TRIGGER) stopDance()
})

function startDance() {
    if (dancing) return
    dancing = true
    stopped = false
    if (!awaitLink()) {
        dancing = false
        return
    }
    dance()
    dancing = false
}

// A move is waited out by drive(), which blocks this stack; the stop below runs in its own
// fiber and interrupts the wheels, and `stopped` keeps the remaining beats from starting.
input.onButtonPressed(Button.AB, function () {
    stopDance()
})

// Shared by A+B and the remote's B. The drive() already in flight still runs out its own pause,
// so the stack unwinds after it, but stopNow cuts the wheels immediately and `stopped` turns
// every remaining beat into a no-op.
function stopDance() {
    stopped = true
    r300_movement.stop()
}

function dance() {
    r300_movement.stop()
    beatIndex = 0
    basic.pause(565)                 // first beat at 465 ms + the engine's 100 ms audio offset

    // ── Bar 1 (intro) ──────────────────────────────────────────────
    beat(-100, 60, 464)               // 465  turn left
    beat(-100, 60, 464)               // 929  turn left
    beat(-100, 60, 349)               // 1393 turn left
    beat(-100, 60, 348)               // 1742 turn left
    // ── Bar 2 ──────────────────────────────────────────────────────
    beat(0, 100, 348)                 // 2090 forward
    beat(0, 100, 349)                 // 2438 forward
    beat(-100, 0, 348)                // 2787 spin CCW
    beat(-100, 0, 348)                // 3135 spin CCW
    beat(-100, 60, 348)               // 3483 turn left
    // ── Bar 3 ──────────────────────────────────────────────────────
    beat(100, 60, 349)                // 3831 turn right
    beat(-100, 60, 348)               // 4180 turn left
    beat(100, 60, 348)                // 4528 turn right
    beat(0, -100, 349)                // 4876 backward
    beat(0, -100, 348)                // 5225 backward
    // ── Bar 4 ──────────────────────────────────────────────────────
    beat(0, 100, 348)                 // 5573 forward
    beat(0, 100, 349)                 // 5921 forward
    beat(-100, 0, 348)                // 6270 spin CCW
    beat(-100, 0, 348)                // 6618 spin CCW
    beat(-100, 60, 348)               // 6966 turn left
    beat(100, 60, 349)                // 7314 turn right
    // ── Bar 5 ──────────────────────────────────────────────────────
    beat(-100, 60, 348)               // 7663 turn left
    beat(100, 60, 348)                // 8011 turn right
    beat(-100, 60, 349)               // 8359 turn left
    beat(0, -100, 348)                // 8708 backward
    beat(0, -100, 348)                // 9056 backward
    // ── Bar 6 — each move now runs through a NONE beat ─────────────
    beat(0, 100, 697)                 // 9404 forward  (through 9752)
    beat(0, -100, 696)                // 10101 backward (through 10449)
    beat(0, 100, 697)                 // 10797 forward (through 11146)
    // ── Bar 7 ──────────────────────────────────────────────────────
    beat(-100, 0, 348)                // 11494 spin CCW
    beat(-100, 0, 697)                // 11842 spin CCW (through 12191)
    beat(100, 0, 696)                 // 12539 spin CW  (through 12887)
    // ── Bar 8 ──────────────────────────────────────────────────────
    beat(-100, 0, 697)                // 13235 spin CCW (through 13584)
    beat(0, -100, 697)                // 13932 backward (through 14280)
    beat(0, 100, 696)                 // 14629 forward  (through 14977)
    // ── Bar 9 ──────────────────────────────────────────────────────
    beat(0, -100, 349)                // 15325 backward
    beat(100, 0, 348)                 // 15674 spin CW
    beat(100, 0, 348)                 // 16022 spin CW
    beat(100, 0, 348)                 // 16370 spin CW
    // ── Bar 10 ─────────────────────────────────────────────────────
    beat(0, 100, 348)                 // 16718 forward
    beat(0, 100, 349)                 // 17066 forward
    beat(-100, 0, 348)                // 17415 spin CCW
    beat(-100, 0, 348)                // 17763 spin CCW
    beat(-100, 60, 348)               // 18111 turn left
    // ── Bar 11 ─────────────────────────────────────────────────────
    beat(100, 60, 349)                // 18459 turn right
    beat(-100, 60, 348)               // 18808 turn left
    beat(100, 60, 348)                // 19156 turn right
    beat(0, -100, 349)                // 19504 backward
    beat(0, -100, 348)                // 19853 backward
    // ── Bar 12 ─────────────────────────────────────────────────────
    beat(0, 100, 348)                 // 20201 forward
    beat(0, 100, 349)                 // 20549 forward
    beat(-100, 0, 348)                // 20898 spin CCW
    beat(-100, 0, 348)                // 21246 spin CCW
    beat(-100, 60, 348)               // 21594 turn left
    beat(100, 60, 349)                // 21942 turn right
    // ── Bar 13 ─────────────────────────────────────────────────────
    beat(-100, 60, 348)               // 22291 turn left
    beat(100, 60, 348)                // 22639 turn right
    beat(-100, 60, 349)               // 22987 turn left
    beat(0, -100, 348)                // 23336 backward
    beat(0, -100, 348)                // 23684 backward
    // ── Bar 14 — through a NONE beat again ─────────────────────────
    beat(0, 100, 697)                 // 24032 forward  (through 24380)
    beat(0, -100, 696)                // 24729 backward (through 25077)
    beat(0, 100, 697)                 // 25425 forward  (through 25774)
    // ── Bar 15 ─────────────────────────────────────────────────────
    beat(-100, 0, 348)                // 26122 spin CCW
    beat(-100, 0, 697)                // 26470 spin CCW (through 26819)
    beat(100, 0, 696)                 // 27167 spin CW  (through 27515)
    // ── Bar 16 ─────────────────────────────────────────────────────
    beat(-100, 0, 697)                // 27863 spin CCW (through 28212)
    beat(0, -100, 697)                // 28560 backward (through 28908)
    beat(0, 100, 696)                 // 29257 forward  (through 29605)
    // ── Bar 17 ─────────────────────────────────────────────────────
    beat(0, -100, 349)                // 29953 backward
    beat(100, 0, 348)                 // 30302 spin CW
    beat(100, 0, 348)                 // 30650 spin CW
    beat(100, 0, 50)                  // 30998 spin CW — the last tick before the engine's stop

    r300_movement.stop()             // the firmware's kStopCmd at the natural end
}

// One beat: the next hand pose, then the wheel move. arm_set returns as soon as R300 accepts it,
// so the servos start turning while drive() blocks on the wheels; each hand has the whole beat to
// reach its pose before the next one is sent.
// drive() rounds and clamps; with SPEED_SCALE at 1.0 the wheel numbers arrive exactly as written.
function beat(rot: number, fwd: number, ms: number) {
    if (stopped) return
    const i = beatIndex % 16
    r300_hands.moveHands(HAND_RIGHT[i], HAND_LEFT[i])
    beatIndex++
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
