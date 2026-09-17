// r300_demo.ts — the dance demo: press A and one whole routine runs, with ActiveSummer
// playing while it moves. Every step is one action — a bounce, a turn, the hands, a face —
// never two at once.
//
// Student-facing blocks only, like test_2.ts and test_emotion.ts: copy this file into a
// MakeCode project that has the R300 extension added, switch to Blocks, and every call
// turns into the same block a student would drag out of the R300 categories.
//
// The routine rides the song. ActiveSummer is 16.3 s at ~86 BPM, so one beat is ~700 ms:
// a 600 ms drive() plus a 100 ms pause lands on it. Three bounce pairs, the turn where the
// built-in beatmap turns (~4.4 s in), six more pairs, then hands and a face to close —
// ~15.5 s of dancing, and the robot is free again as the song ends.
//
// 🔴 NO BEEP, and none belongs here (bench, 2026-09-17, test_emotion.ts): an earlier
// micro:bit tone killed the link and the board reset ~14 s later — the beep shares the
// hardware this program talks to R300 on. Do not add any sound block to this project.
//
// Not part of the extension: lives in testFiles, never in `files`.

let dancing = false
let stopped = false

// Wait for the handshake before the buttons do anything: R300 ignores the link for about
// ten seconds after power-up, and a request sent before that is answered as a failure.
while (!r300_status.isConnected()) {
    basic.showIcon(IconNames.Asleep)
    basic.pause(200)
}
basic.clearScreen()

// A+B — safety. Stop the wheels NOW (this also cuts a move that is still in flight) and
// take the dance apart at the next step. The song keeps playing: the link has no stop-song
// block, so the robot's own boot button is what ends the music.
input.onButtonPressed(Button.AB, function () {
    stopped = true
    r300_movement.stop()
})

// A — one press runs the whole dance. A press while it is already dancing does nothing:
// R300 never replaces a song that is playing, so a second press would only send a second
// routine over the same music.
input.onButtonPressed(Button.A, function () {
    if (!dancing) {
        dancing = true
        stopped = false

        r300_music.playSong(r300_music.Song.ActiveSummer)
        r300_emotion.showFace(r300.Emoji.Cool)

        // Three bounce pairs — the opening bars, forward/back on every beat.
        for (let i = 0; i < 3; i++) {
            if (!stopped) {
                r300_movement.drive(0, 80, 600)
                basic.pause(100)
            }
            if (!stopped) {
                r300_movement.drive(0, -80, 600)
                basic.pause(100)
            }
        }

        // The turn, where the built-in beatmap turns too (~4.4 s in).
        if (!stopped) {
            r300_movement.moveLeft()
        }

        // Six more bounce pairs — through the busy back half to the outro.
        for (let i = 0; i < 6; i++) {
            if (!stopped) {
                r300_movement.drive(0, 80, 600)
                basic.pause(100)
            }
            if (!stopped) {
                r300_movement.drive(0, -80, 600)
                basic.pause(100)
            }
        }

        // Close: both hands up, down, and a happy face while the last bars land.
        if (!stopped) {
            r300_hands.bothHands(r300_hands.HandPose.Up)
            basic.pause(400)
            r300_hands.bothHands(r300_hands.HandPose.Down)
            r300_emotion.showFace(r300.Emoji.Happy)
            basic.pause(500)
        }

        dancing = false
    }
})
