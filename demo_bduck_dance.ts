// demo_bduck_dance.ts — the bduck dance on its own: R300's BDuck chassis beatmap + the hands.
//
// ⚠️ ONE DANCE PER BUILD. This is a separate file from demo_ActiveSummer_dance.ts because the
// two together do not fit: the ActiveSummer demo alone has only a few dozen bytes to spare
// (measured 2026-10-30 — a 6000-character string added to it reports "too big by 5988"). Only
// the file named in pxt.json `testFiles` is compiled, so switch between them before
// `pxt build`.
//
// WHERE THE NUMBERS COME FROM
//   CompanionRobots/main/characters/bduck/dance_beatmap_bduck.h → kBDuckBeatmap
//   BPM 129.20 · 31 s · 88 events, last at 30998 ms. Bars 10–17 ARE bars 2–9 again.
//
// 🔴 NO MUSIC FROM HERE. song_set only starts Dance::kSongList (ActiveSummer, CosmicFluff,
// Fever); the BDuck OGG ships with the BDuck character profile and is reachable only from the
// robot's own MCP tool self.chassis.BDuck_dance. So nothing here starts a song: the routine runs
// on its own clock from the moment a button is pressed, and there is nothing to line it up with.
//
// ⚠️ WHY A STRING, NOT A TABLE. A number literal costs ~14 bytes of flash in this program and a
// character ~1 (comments cost nothing), so the beats live in one string, two characters each:
//   move  0 FWD · 1 BACK · 2 TURN_LEFT · 3 TURN_RIGHT · 4 SPIN_CW · 5 SPIN_CCW
//   hand  0 both down · 1 right up · 2 left up · 3 both up · 4 both back
//         5 right back + left up · 6 left back + right up · 7 hold (nothing sent)
// A "hold" beat is the beatmap's NONE: it sends nothing, the chassis carries on.
//
// ⚠️ A beatmap event is a VELOCITY the chassis latches until the next event — it never says how
// long a move lasts. leg_set IS timed, so a move runs until the next beat: 348 ms, or 464 ms
// for the first two. No timestamps are stored either: the grid is even from bar 1 on —
// t = 1742 + 348.286·k, k = 0…84 (348.286 = (30998 − 1742) / 84) — and ±1 ms of rounding is
// far inside the link's own ±20 ms.
//
// x → rot, y → fwd, ×100: TURN_LEFT is x−0.7 and SPIN_CCW is x−0.8, i.e. ⚠️ NEGATIVE rot is
// LEFT (same as r300_movement.moveLeft()'s turn(−TURN_SPEED)). If the robot mirrors the dance
// on the bench, this sign is the one thing to check first — and it is checked in one place.
//
// The hands are what a beatmap cannot have — it only ever moves the chassis — so the hand
// digits above are this file's own choreography, written on the beatmap's beats.

// Beat digits, one line per bar. Read down a line in pairs: move, then hand.
const kBeats =
    "20212223"         +  // bar 1   INTRO: four TURN_LEFT, the hands count it in
    "0407515723"       +  // bar 2   FWD FWD, SPIN_CCW x2, TURN_LEFT
    "3527361710"       +  // bar 3   TURN_RIGHT/LEFT/RIGHT, BACK BACK
    "030754572730"     +  // bar 4   FWD FWD, SPIN_CCW x2, TURN_LEFT, TURN_RIGHT
    "2537261710"       +  // bar 5   TURN_LEFT/RIGHT/LEFT, BACK BACK
    "0107121703"       +  // bar 6   FWD, hold, BACK, hold, FWD
    "045757534740"     +  // bar 7   hold, SPIN_CCW x2, hold, SPIN_CW, hold
    "5157121704"       +  // bar 8   SPIN_CCW, hold, BACK, hold, FWD
    "0317404743"       +  // bar 9   hold, BACK, SPIN_CW x3 — end of the first half
    "0707575727"       +  // bars 10–17 are bars 2–9 again, +14628 ms:
    "3727371717"       +  // bar 11 = bar 3
    "070757572737"     +  // bar 12 = bar 4
    "2737271717"       +  // bar 13 = bar 5
    "0707171707"       +  // bar 14 = bar 6
    "075757574747"     +  // bar 15 = bar 7
    "5757171707"       +  // bar 16 = bar 8
    "0717474747"          // bar 17 = bar 9 (last)

// hand digit → the pair moveHands() takes: right, left. -1 = leave that hand alone.
const kArm = [90, 90, 0, -1, -1, 0, 0, 0, 180, 180, 180, 0, 0, 180]

let start = 0
let dancing = false

function run(): void {
    if (dancing) return
    dancing = true
    start = control.millis()
    r300_emotion.showFace(r300.Emoji.Cool)

    const beats = kBeats.length / 2
    for (let b = 0; b < beats; b++) {
        // Song time of this beat, waited out on ONE reading: a slow send is absorbed by the
        // next wait instead of pushing every later beat back.
        const wait = start + (b < 3 ? 465 + 464 * b : 1742 + Math.round(348.286 * (b - 3)))
            - control.millis()
        if (wait > 0) basic.pause(wait)

        const mv = kBeats.charCodeAt(b * 2) - 48
        const hs = kBeats.charCodeAt(b * 2 + 1) - 48
        // The wheels: the move digit as rot/fwd percent, running until the next beat.
        r300.motor(mv == 2 ? -70 : mv == 3 ? 70 : mv == 4 ? 80 : mv == 5 ? -80 : 0,
            mv == 0 ? 80 : mv == 1 ? -80 : mv < 4 ? 30 : 0,
            b < 2 ? 464 : 348)
        // ...and the hands on the same beat. 7 = hold, and then nothing is sent at all.
        if (hs < 7) r300.arm(kArm[hs * 2], kArm[hs * 2 + 1])
    }
    r300_emotion.showFace(r300.Emoji.Happy)
    dancing = false
}

// B — the whole dance. A does the same thing, so a board whose button is worn can still dance.
// The number on the radio is just "dance": a board already dancing ignores the repeat.
radio.onReceivedNumber(function (receivedNumber) {
    run()
})
input.onButtonPressed(Button.B, function () {
    radio.sendNumber(0)
    run()
})
input.onButtonPressed(Button.A, function () {
    radio.sendNumber(0)
    run()
})

// Wait for the handshake before the buttons do anything: R300 ignores the link for about ten
// seconds after power-up, and a request sent before that is answered as a failure.
while (!r300_status.isConnected()) {
    basic.showIcon(IconNames.No)
    basic.pause(200)
}
basic.clearScreen()
