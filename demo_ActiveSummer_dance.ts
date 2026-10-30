// demo_ActiveSummer_dance.ts — ActiveSummer, with the HANDS doing most of the dancing.
//
// Press A on any one board and every board dances: the press broadcasts first, the other
// boards pick it up and run the same routine, so the whole room stays together. Same
// handshake, same re-entry guard as demo_synchronize_dance.ts, with these deliberate changes:
//
//   1) The HANDS carry the routine, and each one gets its own turn. Every bar is built
//      from right / left / both motifs instead of one hand waving while the other sits
//      still. arm_set addresses the hands separately, so -1 leaves one alone. The wheels
//      can never do this: leg_set sends one ro/fd pair, which R300 splits between the two
//      motors itself.
//   2) The legs move FOURTEEN times (they started at six), and harder: the steps are 500 ms
//      at full speed instead of 400, the two half-spins 600 ms instead of 500, and bar 3's
//      two steps CURVE. Movement cannot all be forward or the robot walks off the floor, so
//      four of the fourteen step back, two are spins that travel nowhere, and bar 3's two
//      curves are equal and opposite — see the bar table below.
//   3) A hand move and a leg move now happen AT THE SAME TIME. They are separate ops on
//      separate hardware, so nothing forces them to take turns — see leg() below for why
//      that needs a different call than r300_movement.drive().
//   4) ⚠️ ONE DANCE PER BUILD. The bduck dance is demo_bduck_dance.ts, a separate file: the two
//      together do not fit (this program has only a few dozen bytes of flash to spare). pxt.json
//      `testFiles` picks which one is compiled.
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
//
// ⚠️ That is ActiveSummer's table ONLY. bduck has its own and a different shape (129 BPM,
// velocity events, not one timed move per beat) — see demo_bduck_dance.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Everyone else: 0 means "dance too". The value is not checked — 0 is just what this demo
// sends — and a board that is already dancing ignores the repeat.
// ⚠️ Not held back by the handshake below: a 0 that lands during R300's ~10 s warm-up
// starts a routine whose commands come back as failures.
radio.onReceivedNumber(function (receivedNumber) {
    if (!(dancing)) {
        dancing = true
        stopped = false
        performActiveSummerDance()
        dancing = false
    }
})
// A — lead. Broadcast 0 first, then dance here: press A on any one board and the rest follow.
// The send sits OUTSIDE the guard, so pressing A again mid-dance re-broadcasts (a board that
// missed the first packet can still join) while this board does not restart — R300 never
// replaces a song that is playing, so a second take would share the first song.
input.onButtonPressed(Button.A, function () {
    radio.sendNumber(0)
    if (!(dancing)) {
        dancing = true
        stopped = false
        performActiveSummerDance()
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
// `ms` to the motor board and answers immediately. That is why nothing below uses
// r300_movement.drive(): it blocks for the whole move, so a hand command could not be
// issued until the wheels had already stopped. leg() sends and returns; each leg move
// still has to be sized to finish before the next timestamp, and where a gap is short the
// comment says so.
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
// ⚠️ That 100 ms is ActiveSummer's, read off ActiveSummer's song. bduck needs its own
// reading by the same method — the skew can differ per song, and 100 ms of it is visible.
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

// Put a leg move on the wire and come straight back. ⚠️ NOT r300_movement.drive(): that
// one blocks for the whole move, which is right for a student's list of steps and wrong
// here — it would freeze this routine for 400 ms and make "a hand move while the wheels
// turn" impossible. r300.motor() returns as soon as R300 acks it (~20 ms) and the motor
// board runs for `ms` on its own.
// ⚠️ No clamp here, unlike drive(): every call below passes literal values already inside
// -100..100 and 1..3000, and three clamp calls cost flash the program does not have (the
// whole demo has only a few dozen bytes to spare). Anything computed must be clamped by the
// caller.
function leg(rot: number, fwd: number, ms: number): void {
    r300.motor(rot, fwd, ms)
}

// The ActiveSummer routine: run by the A button (leader) and by the radio handler (followers).
//
// Six bars, each built from the right / left / both hand motifs. "same beat" below means
// the leg command and the hand command are issued at the same timestamp — the wheels are
// already turning while the hand request goes out on top of them.
//
// The legs move 14 times, each one numbered below. ⚠️ No leg move may run past the next
// timestamp: where the gap is short the comment says so, and the shortest gap in the table
// is 528 ms. A step that overruns is not a late step, it is a step that fights the next one.
//
//   Bar 1  0.0 – 2.9 s  greeting        BOTH down -> R -> L -> BOTH up + hop
//   Bar 2  2.9 – 5.8 s  step + spin     FWD | R-back, BOTH down, SPIN-L | L-up, BOTH up + back
//   Bar 3  5.8 – 8.9 s  L, R, BOTH      L-back | curve-R, R-back | curve-L, BACK | BOTH-back,
//                                       BOTH up, asym + hop
//   Bar 4  8.9 – 11.2 s the mirror      BOTH down, FWD | asym, asym mirrored + back-hop, SPIN-R
//   Bar 5 11.9 – 14.0 s wave, bigger    R -> L -> BOTH up + FWD, BOTH back + BACK
//   Bar 6 14.9 – 16.3 s close           FWD | BOTH down, BOTH up + Happy
function performActiveSummerDance(): void {
    // Song first, clock second. The reading has to follow the ack, because that is the
    // nearest thing "the song is running" this side can observe.
    r300_music.playSong(r300_music.Song.ActiveSummer)
    danceStart = control.millis() + kSongStartOffsetMs

    // ── Bar 1 (0 – 2.9 s) — greeting: right, then left, then both ────────────────
    if (at(128)) {
        r300_emotion.showFace(r300.Emoji.Cool)
        r300_hands.moveHands(90, 90)               // BOTH down: the starting pose
    }
    if (at(832)) r300_hands.moveHands(0, -1)       // RIGHT only, up
    if (at(1536)) r300_hands.moveHands(-1, 0)      // LEFT only, up — now both are up
    if (at(2240)) {
        r300_hands.moveHands(0, 0)                 // BOTH up: the resolve...
        leg(0, 70, 250)                            // ...with a small hop under it, 1 of 14
    }

    // ── Bar 2 (2.9 – 5.8 s) — step forward WHILE the right hand waves ────────────
    // Speed is full, deliberately: below full these motors do not turn the robot on the
    // floor at all, so a lower number is a stationary robot, not a gentler step. So "more
    // force" here means MORE MS — 100 is already the ceiling on the number itself.
    if (at(2944)) {
        leg(0, 100, 500)                           // wheels start, 2 of 14...
        r300_hands.moveHands(180, -1)              // ...right hand goes back, same beat
    }
    if (at(3824)) r300_hands.moveHands(90, 90)     // BOTH down
    if (at(4352)) {
        leg(100, 0, 600)                           // TURN_LEFT: half a spin, 3 of 14...
        r300_hands.moveHands(-1, 0)                // ...left hand up through the turn
    }
    if (at(5056)) {
        r300_hands.moveHands(0, 0)                 // BOTH up
        leg(0, -100, 350)                          // settle back out of the spin, 4 of 14
    }

    // ── Bar 3 (5.8 – 8.9 s) — left, right, both: the motif stated outright ───────
    if (at(5760)) {
        r300_hands.moveHands(-1, 180)              // LEFT only, back...
        leg(85, 85, 350)                           // ...body curves right-forward, 5 of 14
    }
    if (at(6464)) {
        r300_hands.moveHands(180, -1)              // RIGHT only, back...
        leg(-85, 85, 350)                          // ...body curves left-forward, 6 of 14
    }
    if (at(7168)) {
        leg(0, -100, 500)                          // a backward step, 7 of 14...
        r300_hands.moveHands(180, 180)             // ...BOTH hands back: the widest pose
    }
    if (at(7872)) r300_hands.moveHands(0, 0)       // BOTH up
    if (at(8400)) {
        r300_hands.moveHands(0, 180)               // asymmetric: right up, left back...
        leg(0, 90, 250)                            // ...hop under it, 8 of 14
    }

    // ── Bar 4 (8.9 – 11.2 s) — the mirror image, and the turn comes back ─────────
    if (at(8928)) r300_hands.moveHands(90, 90)     // BOTH down
    if (at(9808)) {
        leg(0, 100, 450)                           // step forward, 9 of 14...
        r300_hands.moveHands(180, 0)               // ...right back, left up, same beat
    }
    // 450 ms, not 500: the hand move at 10336 is only 528 ms later.
    if (at(10336)) {
        r300_hands.moveHands(0, 180)               // the pose above, mirrored...
        leg(0, -70, 250)                           // ...with a small step back, 10 of 14
    }
    if (at(11216)) {
        leg(-100, 0, 600)                          // TURN_RIGHT: half a spin back, 11 of 14...
        r300_hands.moveHands(90, 90)               // ...hands settling while it turns
    }

    // ── Bar 5 (11.9 – 14.0 s) — the wave again, bigger ──────────────────────────
    if (at(11920)) r300_hands.moveHands(0, -1)     // RIGHT only
    if (at(12624)) r300_hands.moveHands(-1, 0)     // LEFT only
    if (at(13504)) {
        r300_hands.moveHands(0, 0)                 // BOTH up...
        leg(0, 100, 450)                           // ...and a step out toward the room, 12 of 14
    }
    if (at(14032)) {
        r300_hands.moveHands(180, 180)             // BOTH back...
        leg(0, -100, 400)                          // ...weight coming back, 13 of 14
    }

    // ── Bar 6 (14.9 – 16.3 s) — last step, then the closing pose ────────────────
    if (at(14912)) {
        leg(0, 100, 450)                           // the last step, 14 of 14...
        r300_hands.moveHands(90, 90)               // ...hands down while it runs
    }
    // The two half-spins are leg moves 3 and 11, one each way, and bar 3's two curves are
    // equal and opposite, so the routine ends facing the way it started.
    if (at(15616)) {
        r300_hands.moveHands(0, 0)                 // BOTH up: the punch
        r300_emotion.showFace(r300.Emoji.Happy)
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// The bduck dance is demo_bduck_dance.ts — a separate file, on purpose. Two dances do not fit
// in one micro:bit program (this one alone has only a few dozen bytes to spare), so pxt.json
// `testFiles` picks which of the two gets compiled.
// ═════════════════════════════════════════════════════════════════════════════

// dancing — the re-entry guard both handlers above read.
// stopped — read all through the routine but never set true in this demo: the A+B stop that
// sets it lives in r300_demo.ts.
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
