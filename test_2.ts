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
 *
 * added and switch to the Blocks view: one "on start" stack, one R300 block per call.
 *
 * The extension connects itself at power-up, so there is no connect call: the stack
 * starts with a one-second settle, then runs the list in order; A+B stops the wheels.
 *
 * Not part of the extension: test_2.ts is not in pxt.json, so it never reaches students.
 */
led.toggle(0, 0)
basic.pause(1000)
// 1 — wheels: forward.
r300_movement.drive(0, 80, 1000)
led.toggle(0, 0)
basic.pause(1000)
// 2 — wheels: spin right.
r300_movement.drive(80, 0, 1000)
led.toggle(0, 0)
basic.pause(1000)
// 3 — wheels: backward.
r300_movement.drive(0, -80, 1000)
led.toggle(0, 0)
basic.pause(1000)
// 4 — the real stop (the one that also interrupts a move still in flight).
r300_movement.stop()
led.toggle(0, 0)
basic.pause(1000)
// 5 — hands: both down.
r300_hands.moveHands(90, 90)
led.toggle(0, 0)
basic.pause(1000)
// 6 — hands: both forward.
r300_hands.moveHands(0, 0)
led.toggle(0, 0)
basic.pause(1000)
// 7 — hands: right hand only (-1 leaves the other hand where it is).
r300_hands.moveHands(45, -1)
led.toggle(0, 0)
basic.pause(1000)
// 8 — speaker: quiet.
r300_speaker.setVolume(30)
led.toggle(0, 0)
basic.pause(1000)
// 9 — speaker: loud.
r300_speaker.setVolume(80)
led.toggle(0, 0)
basic.pause(1000)
// 10 — face 1.
r300_emotion.showFace(r300.Emoji.Happy)
led.toggle(0, 0)
basic.pause(1000)
// 11 — face 2.
r300_emotion.showFace(r300.Emoji.Surprised)
led.toggle(0, 0)
basic.pause(1000)
// 12 — recording: name the routine...
r300_mcp.nameRecording("test", "bench test routine")
led.toggle(0, 0)
basic.pause(1000)
// 13 — ...arm the recorder...
r300_mcp.startRecording()
led.toggle(0, 0)
basic.pause(1000)
// 14 — ...make a move for it to capture...
r300_movement.drive(0, 80, 800)
led.toggle(0, 0)
basic.pause(1000)
// 15 — ...one more...
r300_hands.moveHands(90, 90)
led.toggle(0, 0)
basic.pause(1000)
// 16 — ...then publish it as an AI tool.
r300_mcp.finishRecording()
led.toggle(1, 0)

