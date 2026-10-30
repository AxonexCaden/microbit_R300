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
//   2) The legs move TWENTY times (they started at six), and harder: the steps are 500 ms at
//      full speed instead of 400, the two half-spins 600 ms instead of 500, and four of them
//      CURVE (ro and fd at once). Forward and backward are paired — bar 1 and bar 5 rock one
//      way and back, bar 3 curves out and bar 4 curves in — because movement that only ever
//      goes forward walks the robot off the floor. See the bar table below.
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

// One dance at a time — the re-entry guard, shared by the A button (leader) and the radio
// handler (followers). R300 never replaces a song that is already playing, so a second take
// would only share the first song's music.
function dance(): void {
    if (dancing) return
    dancing = true
    performActiveSummerDance()
    dancing = false
}

// Everyone else: 0 means "dance too". The value is not checked — 0 is just what this demo
// sends — and a board that is already dancing ignores the repeat.
// ⚠️ Not held back by the handshake below: a 0 that lands during R300's ~10 s warm-up
// starts a routine whose commands come back as failures.
radio.onReceivedNumber(dance)
// A — lead. Broadcast 0 first, then dance here: press A on any one board and the rest follow.
// The send sits OUTSIDE the guard, so pressing A again mid-dance re-broadcasts (a board that
// missed the first packet can still join) while this board does not restart.
input.onButtonPressed(Button.A, function () {
    radio.sendNumber(0)
    dance()
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
// The number is written straight into performActiveSummerDance() below: a const of its own
// cost flash the program does not have, and it is used exactly once.

let danceStart = 0

// Wait until `timeMs` into the song, on ONE reading shared by every action below — so a slow
// send is absorbed by the next wait instead of pushing the rest of the routine back.
// 🔴 It returns NOTHING, so it must be called as a STATEMENT. `if (at(128)) …` compiles
// (undefined is falsy) and silently skips everything after it — that bug shipped once and the
// robot just stood there, face unchanged, for the whole song.
// ⚠️ No `stopped` check either: nothing here ends a routine early (the A+B stop lives in
// r300_demo.ts), and that hook plus its flag cost flash the program does not have.
function at(timeMs: number): void {
    const wait = danceStart + timeMs - control.millis()
    if (wait > 0) basic.pause(wait)
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
// The legs move 20 times. ⚠️ No leg move may run past the next timestamp: where the gap is
// short the comment says so, and the shortest gap in the table is 528 ms. A step that
// overruns is not a late step, it is a step that fights the next one.
//
//   Bar 1  0.0 – 2.9 s  greeting        BOTH down, rock BACK, rock FWD, BOTH up + hop
//   Bar 2  2.9 – 5.8 s  step + spin     FWD | R-back, BOTH down + BACK, SPIN-L | L-up,
//                                       BOTH up + back
//   Bar 3  5.8 – 8.9 s  L, R, BOTH      L-back | curve-R, R-back | curve-L, BACK | BOTH-back,
//                                       BOTH up + curve-BACK-R, asym + hop
//   Bar 4  8.9 – 11.2 s the mirror      BOTH down + curve-BACK-L, FWD | asym,
//                                       asym mirrored + back-hop, SPIN-R | BOTH
//   Bar 5 11.9 – 14.0 s wave, bigger    R + FWD, L + BACK, BOTH up + FWD, BOTH back + BACK
//   Bar 6 14.9 – 16.3 s close           FWD | BOTH down, BOTH up + Happy
function performActiveSummerDance(): void {
    // Song first, clock second. The reading has to follow the ack, because that is the
    // nearest thing "the song is running" this side can observe.
    r300_music.playSong(r300_music.Song.ActiveSummer)
    danceStart = control.millis() + 100

    // ── Bar 1 (0 – 2.9 s) — greeting: the hands rise, the wheels rock under them ─
    at(128)
    r300_emotion.showFace(r300.Emoji.Cool)
    r300_hands.moveHands(90, 90)                   // BOTH down: the starting pose
    at(832)
    r300_hands.moveHands(0, -1)                    // RIGHT only, up...
    leg(0, -70, 300)                               // ...rocking BACK
    at(1536)
    r300_hands.moveHands(-1, 0)                    // LEFT only, up...
    leg(0, 70, 550)                                // ...rocking FORWARD, and on through 2240
    at(2240)
    r300_hands.moveHands(0, 0)                     // BOTH up: the resolve

    // ── Bar 2 (2.9 – 5.8 s) — step forward WHILE the right hand waves ────────────
    // Speed is full, deliberately: below full these motors do not turn the robot on the
    // floor at all, so a lower number is a stationary robot, not a gentler step. So "more
    // force" here means MORE MS — 100 is already the ceiling on the number itself.
    at(2944)
    leg(0, 100, 500)                               // wheels start...
    r300_hands.moveHands(180, -1)                  // ...right hand goes back, same beat
    at(3824)
    r300_hands.moveHands(90, 90)                   // BOTH down...
    leg(0, -60, 300)                               // ...weight back before the spin
    at(4352)
    leg(100, 0, 600)                               // TURN_LEFT: half a spin...
    r300_hands.moveHands(-1, 0)                    // ...left hand up through the turn
    at(5056)
    r300_hands.moveHands(0, 0)                     // BOTH up
    leg(0, -100, 350)                              // settle back out of the spin

    // ── Bar 3 (5.8 – 8.9 s) — left, right, both: the motif stated outright ───────
    at(5760)
    r300_hands.moveHands(-1, 180)                  // LEFT only, back...
    leg(85, 85, 350)                               // ...body curves right-forward
    at(6464)
    r300_hands.moveHands(180, -1)                  // RIGHT only, back...
    leg(-85, 85, 350)                              // ...body curves left-forward
    at(7168)
    leg(0, -100, 500)                              // a backward step...
    r300_hands.moveHands(180, 180)                 // ...BOTH hands back: the widest pose
    at(7872)
    r300_hands.moveHands(0, 0)                     // BOTH up...
    leg(70, -70, 300)                              // ...curving right AND back
    at(8400)
    r300_hands.moveHands(0, 180)                   // asymmetric: right up, left back...
    leg(0, 90, 250)                                // ...hop under it

    // ── Bar 4 (8.9 – 11.2 s) — the mirror image, and the turn comes back ─────────
    at(8928)
    r300_hands.moveHands(90, 90)                   // BOTH down...
    leg(-70, -70, 300)                             // ...curving left AND back
    at(9808)
    leg(0, 100, 450)                               // step forward...
    r300_hands.moveHands(180, 0)                   // ...right back, left up, same beat
    // 450 ms, not 500: the hand move at 10336 is only 528 ms later.
    at(10336)
    r300_hands.moveHands(0, 180)                   // the pose above, mirrored...
    leg(0, -70, 250)                               // ...with a small step back
    at(11216)
    leg(-100, 0, 600)                              // TURN_RIGHT: half a spin back...
    r300_hands.moveHands(90, 90)                   // ...hands settling while it turns

    // ── Bar 5 (11.9 – 14.0 s) — the wave again, bigger, and the wheels rock too ──
    at(11920)
    r300_hands.moveHands(0, -1)                    // RIGHT only...
    leg(0, 90, 300)                                // ...a step FORWARD under it
    at(12624)
    r300_hands.moveHands(-1, 0)                    // LEFT only...
    leg(0, -90, 300)                               // ...and straight BACK
    at(13504)
    r300_hands.moveHands(0, 0)                     // BOTH up...
    leg(0, 100, 450)                               // ...and a step out toward the room
    at(14032)
    r300_hands.moveHands(180, 180)                 // BOTH back...
    leg(0, -100, 400)                              // ...weight coming back

    // ── Bar 6 (14.9 – 16.3 s) — last step, then the closing pose ────────────────
    at(14912)
    leg(0, 100, 450)                               // the last step...
    r300_hands.moveHands(90, 90)                   // ...hands down while it runs
    // The two half-spins go one each way, and the curves in bar 3 pair with the ones in
    // bar 4, so the routine ends where it started, facing the way it started.
    at(15616)
    r300_hands.moveHands(0, 0)                     // BOTH up: the punch
    r300_emotion.showFace(r300.Emoji.Happy)
}

// ═════════════════════════════════════════════════════════════════════════════
// The bduck dance is demo_bduck_dance.ts — a separate file, on purpose. Two dances do not fit
// in one micro:bit program (this one alone has only a few dozen bytes to spare), so pxt.json
// `testFiles` picks which of the two gets compiled.
// ═════════════════════════════════════════════════════════════════════════════

// dancing — the re-entry guard both handlers above read. There is no stop flag any more: the
// A+B stop that would set one lives in r300_demo.ts, and the flag cost flash nothing in this
// demo ever used.
let dancing = false
// Wait for the handshake before the button does anything (the radio handler above does NOT
// wait — see its note): R300 ignores the link for about ten seconds after power-up, and a
// request sent before that is answered as a failure.
while (!(r300_status.isConnected())) {
    basic.showIcon(IconNames.No)
    basic.pause(200)
}
basic.clearScreen()
