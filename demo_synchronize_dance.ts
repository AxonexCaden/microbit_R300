// demo_synchronize_dance.ts — one leads, all follow. Press A on ANY board: that board runs
// the ActiveSummer routine and sends radio 0; every other board that hears 0 runs the same
// routine, so the set dances together. Each board needs its own R300 and its own handshake.
//
// Trimmed from r300_demo.ts — same routine, new trigger. Gone are the B / AI-tool recording
// and the A+B safety stop, the only thing that ever set stopped; performDance still reads the
// flag, so a stop button can come back without touching it.
//
// Sync is fire-and-forget: a follower starts the moment the packet lands and then times the
// routine on its own clock, so boards stay in step to within a packet — they do not share one.
//
// No setGroup() here: every board runs on the default radio group. A class with more than
// one set should give each set its own group, or the sets will answer each other.
//
// 🔴 Still no micro:bit tone anywhere in this project (bench, 2026-09-17): a beep shares
// the hardware the R300 link runs on and killed it once.
//
// Not part of the extension: add it to testFiles (one demo at a time) when you flash it.

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
// The routine itself: run by the A button (leader) and by the radio handler (followers).
function performDance () {
    r300_music.playSong(r300_music.Song.ActiveSummer)
    r300_emotion.showFace(r300.Emoji.Cool)
    // Three bounce pairs — the opening bars, forward/back on every beat.
    for (let index = 0; index < 3; index++) {
        if (!(stopped)) {
            r300_movement.drive(0, 80, 600)
            basic.pause(100)
        }
        if (!(stopped)) {
            r300_movement.drive(0, -80, 600)
            basic.pause(100)
        }
    }
    // The turn, where the built-in beatmap turns too (~4.4 s in).
    if (!(stopped)) {
        r300_movement.moveLeft()
    }
    // Six more bounce pairs — through the busy back half to the outro.
    for (let index = 0; index < 6; index++) {
        if (!(stopped)) {
            r300_movement.drive(0, 80, 600)
            basic.pause(100)
        }
        if (!(stopped)) {
            r300_movement.drive(0, -80, 600)
            basic.pause(100)
        }
    }
    // Close: both hands up, down, and a happy face while the last bars land.
    if (!(stopped)) {
        r300_hands.bothHands(r300_hands.HandPose.Up)
        basic.pause(400)
        r300_hands.bothHands(r300_hands.HandPose.Down)
        r300_emotion.showFace(r300.Emoji.Happy)
        basic.pause(500)
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
