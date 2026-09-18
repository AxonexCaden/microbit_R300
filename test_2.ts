// Safety net while the robot is moving: A+B stops the wheels immediately.
input.onButtonPressed(Button.AB, function () {
    r300_movement.stop()
})

// A / B set the speaker volume mid-test: A = quiet (40), B = loud (80).
input.onButtonPressed(Button.A, function () {
    r300_speaker.setVolume(40)
})
input.onButtonPressed(Button.B, function () {
    r300_speaker.setVolume(80)
})

/**
 * test_2.ts — bench pass over EVERY student-facing block, one call per second.
 *
 * Copy this whole file into a MakeCode micro:bit project that has the R300 extension
 * added and switch to the Blocks view: one "on start" stack, one R300 block per call.
 *
 * The extension connects itself at power-up, so there is no connect call: the stack
 * starts with a one-second settle, then runs the list in order; A+B stops the wheels.
 *
 * The reporter blocks — speaker volume, moves recorded, is connected, accepted and cut
 * short — are shown on the LED. The song is the last call on purpose: it runs ~16 s,
 * nothing can stop it, and the robot's mic is muted while it plays.
 *
 * Not part of the extension: test_2.ts is not in pxt.json, so it never reaches students.
 */
led.toggle(0, 0)
basic.pause(1000)
// 1 — wheels: forward for one second.
r300_movement.moveForward(1)
led.toggle(0, 0)
basic.pause(1000)
// 2 — wheels: turn left (no field — a turn is a fixed one-second spin).
r300_movement.moveLeft()
led.toggle(0, 0)
basic.pause(1000)
// 3 — wheels: turn right, the mirror of 2.
r300_movement.moveRight()
led.toggle(0, 0)
basic.pause(1000)
// 4 — wheels: backward, the other direction drive supports.
r300_movement.moveBackward(1)
led.toggle(0, 0)
basic.pause(1000)
// 5 — wheels: the real stop (the one that also interrupts a move still in flight).
r300_movement.stop()
led.toggle(0, 0)
basic.pause(1000)
// 6 — hands: left hand only, up. The right hand must NOT move.
r300_hands.leftHand(r300_hands.HandPose.Up)
led.toggle(0, 0)
basic.pause(1000)
// 7 — hands: right hand only, down. Same check the other way round.
r300_hands.rightHand(r300_hands.HandPose.Down)
led.toggle(0, 0)
basic.pause(1000)
// 8 — hands: both hands back (the far end of the arm sweep, 180°).
r300_hands.bothHands(r300_hands.HandPose.Back)
led.toggle(0, 0)
basic.pause(1000)
// 9 — speaker: quiet.
r300_speaker.setVolume(30)
led.toggle(0, 0)
basic.pause(1000)
// 10 — speaker: loud.
r300_speaker.setVolume(80)
led.toggle(0, 0)
basic.pause(1000)
// 11 — speaker: change by a step, from whatever R300 last confirmed.
r300_speaker.changeVolumeBy(-30)
led.toggle(0, 0)
basic.pause(1000)
// 12 — speaker: read the volume R300 last confirmed (shows the number).
basic.showNumber(r300_speaker.volume())
led.toggle(0, 0)
basic.pause(1000)
// 13 — face 1.
r300_emotion.showFace(r300.Emoji.Happy)
led.toggle(0, 0)
basic.pause(1000)
// 14 — face 2.
r300_emotion.showFace(r300.Emoji.Surprised)
led.toggle(0, 0)
basic.pause(1000)
// 15 — talk over: let the user interrupt R300 while it speaks.
r300_talkover.allowTalkingOver()
led.toggle(0, 0)
basic.pause(1000)
// 16 — talk over: back to only the wake word, the way a fresh R300 boots.
r300_talkover.stopTalkingOver()
led.toggle(0, 0)
basic.pause(1000)
// 17 — conversation: open one without touching the robot's boot button.
r300_ai.startConversation()
led.toggle(0, 0)
basic.pause(1000)
// 18 — conversation: close it again.
r300_ai.stopConversation()
led.toggle(0, 0)
basic.pause(1000)
// 19 — status: is the link up? Yes icon when it is, No when it is not.
if (r300_status.isConnected()) {
    basic.showIcon(IconNames.Yes)
} else {
    basic.showIcon(IconNames.No)
}
led.toggle(0, 0)
basic.pause(1000)
// 20 — status: did R300 accept the last command (step 18)? Yes/No icon.
if (r300_status.accepted()) {
    basic.showIcon(IconNames.Yes)
} else {
    basic.showIcon(IconNames.No)
}
led.toggle(0, 0)
basic.pause(1000)
// 21 — recording: describe the routine...
r300_ai.nameRecording("bench test routine")
led.toggle(0, 0)
basic.pause(1000)
// 22 — ...arm the recorder...
r300_ai.startRecording()
led.toggle(0, 0)
basic.pause(1000)
// 23 — ...make a move for it to capture...
r300_movement.moveForward(1)
led.toggle(0, 0)
basic.pause(1000)
// 24 — ...one more, on the hands...
r300_hands.bothHands(r300_hands.HandPose.Up)
led.toggle(0, 0)
basic.pause(1000)
// 25 — ...and the raw drive block, the only one that can curve (rot and fwd both set)...
r300_movement.drive(50, 80, 1000)
led.toggle(0, 0)
basic.pause(1000)
// 26 — ...and the raw hands block (-1 leaves the LEFT hand where it is)...
r300_hands.moveHands(45, -1)
led.toggle(0, 0)
basic.pause(1000)
// 27 — ...then publish it as an AI tool.
r300_ai.finishRecording()
led.toggle(0, 0)
basic.pause(1000)
// 28 — recording: how many moves the take captured (the four from steps 23–26).
basic.showNumber(r300_ai.movesRecorded())
led.toggle(0, 0)
basic.pause(1000)
// 29 — recording: did it throw any away? No icon would mean the take was cut short.
if (r300_ai.recordingWasCutShort()) {
    basic.showIcon(IconNames.No)
} else {
    basic.showIcon(IconNames.Yes)
}
led.toggle(0, 0)
basic.pause(1000)
// 30 — music: the song goes LAST — ~16 seconds of it, no stop block, and R300's mic is
// muted until it ends. The dropdown holds all three songs; one is enough for the bench.
r300_music.playSong(r300_music.Song.ActiveSummer)
led.toggle(1, 0)

