// demo_dance_hands.ts — ActiveSummer, with the HANDS doing most of the dancing.
//
// A copy of demo_synchronize_dance.ts — same radio sync (press A on any board, every
// board dances the same routine), same handshake, same re-entry guard — with two
// deliberate changes:
//
//   1) The HANDS carry the routine. arm_set addresses the two hands separately, so the
//      poses below are asymmetric where the music is. The wheels can never be: leg_set
//      sends one ro/fd pair, which R300 splits between the two motors itself.
//   2) The legs move FIVE times instead of twenty-three. The old routine bounced
//      forward/back on literally every event in the beatmap; this one steps on the bar,
//      and only one of the five steps goes backwards.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE TIMESTAMPS COME FROM
//
// Not from counting in my head — from R300's own table:
//   CompanionRobots/main/assets/dance/dance_beatmap.h → kActiveSummerBeatmap
//   BPM 85.23  →  one beat = 704 ms  →  6 bars, 23 events, last at 15616 ms.
//
// The 704 ms grid, the off-grid events at 528 ms (0.75 beat) and 880 ms (1.25 beat),
// and the odd 880 ms gap before 3824 / 9808 / 11216 / 13504 / 14912 are all from that
// table, unchanged. The .ogg itself is Opus / mono / 16 kHz: there is nothing in it the
// micro:bit could read, and no way for it to hear the song, so this table IS the shared
// clock. If the beatmap is ever re-cut, these numbers have to be re-copied with it.
// ─────────────────────────────────────────────────────────────────────────────

// Everyone else: 0 means "dance too". The value is not checked — 0 is just what this demo
// sends — and a board that is already dancing ignores the repeat.
// ⚠️ Not held back by the handshake below: a 0 that lands during R300's ~10 s warm-up
// starts a routine whose commands come back as failures.
radio.onReceivedNumber(function (receivedNumber) {
    if (!(dancing)) {
        dancing = true
        stopped = false
        performDance()
        dancing = false
    }
})
// A — lead. Broadcast 0 first, then dance here: press A on any one board and the rest
// follow. The send sits OUTSIDE the guard, so pressing A again mid-dance re-broadcasts
// (a board that missed the first packet can still join) while this board does not restart —
// R300 never replaces a song that is playing, so a second take would share the first song.
input.onButtonPressed(Button.A, function () {
    radio.sendNumber(0)
    if (!(dancing)) {
        dancing = true
        stopped = false
        performDance()
        dancing = false
    }
})

// ─────────────────────────────────────────────────────────────────────────────
// The clock.
//
// ⚠️ Absolute scheduling, NOT a chain of relative pauses. Every action waits until its own
// timestamp on ONE reading, so a slow send() (an ack round trip, or a retry after a lost
// one) is absorbed by the next wait instead of pushing every later move back. A chain of
// "pause 700" drifts by the sum of every error — over 16 s that is exactly the "technically
// dancing, visibly off the beat" a routine cannot hide. The old demo did not drift much
// only because 600 + 100 happened to land on 700 ≈ one beat, which is luck, not a clock.
//
// ⚠️ The hands and the face can be sent while the wheels are still turning — leg_set hands
// `ms` to the motor board and answers immediately. drive() blocks on purpose so a student's
// code stays put, so every drive() below is sized to finish before the next timestamp;
// where the gap is short the comment says so.
// ─────────────────────────────────────────────────────────────────────────────

// Song time 0 is "R300 accepted song_set". R300 starts its own beat task on that request
// (with_motors=false — it moves nothing, that task is only its clock), so the two sides
// ought to start together. Measured on the bench, they do not: the whole routine ran
// ~100 ms AHEAD of R300's beat clock.
//
// ⚠️ The SIGN is the trap. A bigger number moves danceStart LATER, so the routine fires
// LATER. Late on the floor → subtract; early → add. (Measured early, hence +100.)
//
// How that was measured (Log.txt, 2026-10-28): fitting R300's own receive timestamps for
// seven routine commands against their beatmap times leaves ±7 ms of residual and puts
// this side's t=0 at R300 time 605904. R300 logged "DanceTask: finished" at 621610, and
// that IS beat 15616, so R300's t=0 was 605994. 605994 − 605904 = 90 ms, plus the ~10 ms
// the line takes to cross = ~100. One observation, so call it ±20 ms.
//
// 🔴 This cannot fix the music itself: the same log shows R300 dropping most of the OGG
// packets ("AudioService: decode queue full") while the routine runs. That is R300's
// audio pipeline, not this file — nothing sent from here causes it and nothing sent from
// here can cure it.
const kSongStartOffsetMs = 100

let danceStart = 0

// Wait until `timeMs` into the song. Returns false once `stopped` is set, so every caller
// can be a plain `if (at(...)) action()` and the waits keep running even while the moves
// are skipped — the routine then ends on time instead of being cut off mid-bar.
function at(timeMs: number): boolean {
    const remaining = danceStart + timeMs - control.millis()
    if (remaining > 0) basic.pause(remaining)
    return !stopped
}

// The routine itself: run by the A button (leader) and by the radio handler (followers).
function performDance(): void {
    // Song first, clock second. The reading has to follow the ack, because that is the
    // nearest thing "the song is running" this side can observe.
    r300_music.playSong(r300_music.Song.ActiveSummer)
    danceStart = control.millis() + kSongStartOffsetMs

    // ── Bar 1 (0 – 3.5 s) — greeting: the hands come up one at a time ─────────────
    if (at(128)) {
        r300_emotion.showFace(r300.Emoji.Cool)
        r300_hands.moveHands(90, 90)               // both down: the starting pose
    }
    if (at(832)) r300_hands.moveHands(0, 90)       // right hand up
    if (at(1536)) r300_hands.moveHands(90, 0)      // left hand up — the wave

    // ── Bar 2 (2.9 – 5.8 s) — one forward step, then the beatmap's own turn ──────
    // Speed is full, deliberately: below full these motors do not turn the robot on the
    // floor at all, so a lower number is a stationary robot, not a gentler step.
    // The step is short (400 ms) so it has finished 380 ms before the hands move again.
    if (at(2944)) r300_movement.drive(0, 100, 400)         // step 1 of 5
    if (at(3824)) r300_hands.moveHands(0, 0)               // both up on the resolve
    if (at(4352)) r300_movement.drive(100, 0, 500)         // TURN_LEFT: half a spin
    if (at(5056)) r300_hands.moveHands(90, 90)

    // ── Bar 3 (5.8 – 8.9 s) — the only backward step, hands straight back ────────
    if (at(5760)) r300_hands.moveHands(180, 180)           // both back: the widest pose
    if (at(6464)) r300_hands.moveHands(0, 0)
    if (at(7168)) r300_movement.drive(0, -100, 400)        // step 2 of 5 — the one backward
    if (at(8400)) r300_hands.moveHands(0, 180)             // asymmetric: right up, left back

    // ── Bar 4 (8.9 – 11.2 s) — hands down, one step, turn the other way ──────────
    if (at(8928)) r300_hands.moveHands(90, 90)
    // 400 ms, not 500: the hand move at 10336 is only 528 ms later.
    if (at(9808)) r300_movement.drive(0, 100, 400)         // step 3 of 5
    if (at(10336)) r300_hands.moveHands(180, 0)            // mirror of 8400
    if (at(11216)) r300_movement.drive(-100, 0, 500)       // TURN_RIGHT: half a spin back

    // ── Bar 5 (11.9 – 14.0 s) — the wave again, bigger ──────────────────────────
    if (at(11920)) r300_hands.moveHands(0, 90)
    if (at(12624)) r300_hands.moveHands(90, 0)
    if (at(13504)) r300_hands.moveHands(180, 180)
    if (at(14032)) r300_hands.moveHands(0, 0)

    // ── Bar 6 (14.9 – 16.3 s) — last step, then the closing pose ────────────────
    if (at(14912)) r300_movement.drive(0, 100, 400)        // step 4 of 5
    // 5 of 5 was the two half-spins: one left at 4352, one right at 11216.
    if (at(15616)) {
        r300_hands.moveHands(0, 0)                         // both hands up
        r300_emotion.showFace(r300.Emoji.Happy)
    }
}

// dancing — the re-entry guard both handlers above read.
// stopped — read all through performDance but never set true in this demo: the A+B stop
// that sets it lives in r300_demo.ts.
let stopped = false
let dancing = false
// Wait for the handshake before the button does anything (the radio handler above does NOT
// wait — see its note): R300 ignores the link for about ten seconds after power-up, and a
// request sent before that is answered as a failure.
while (!(r300_status.isConnected())) {
    basic.showIcon(IconNames.No)
    basic.pause(200)
}
basic.clearScreen()
