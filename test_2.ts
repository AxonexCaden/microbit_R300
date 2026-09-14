// test_2.ts — bench pass over EVERY student-facing block, one call per second.
// Copy this whole file into a MakeCode micro:bit project that has the R300 extension
// added and switch to the Blocks view: one "on start" stack, one R300 block per call.
// It waits a second after connect, then runs the list in order; A+B stops the wheels.
// Not part of the extension: test_2.ts is not in pxt.json, so it never reaches students.

r300_core.connect()
basic.pause(1000)

// 1 — wheels: half speed forward.
r300_movement.drive(0, 50, 1000)
basic.pause(1000)
// 2 — wheels: spin right.
r300_movement.drive(60, 0, 1000)
basic.pause(1000)
// 3 — wheels: half speed backward.
r300_movement.drive(0, -50, 1000)
basic.pause(1000)
// 4 — the real stop (the one that also interrupts a move still in flight).
r300_movement.stop()
basic.pause(1000)
// 5 — hands: both down.
r300_hands.moveHands(90, 90)
basic.pause(1000)
// 6 — hands: both forward.
r300_hands.moveHands(0, 0)
basic.pause(1000)
// 7 — hands: right hand only (-1 leaves the other hand where it is).
r300_hands.moveHands(45, -1)
basic.pause(1000)
// 8 — speaker: quiet.
r300_speaker.setVolume(30)
basic.pause(1000)
// 9 — speaker: loud.
r300_speaker.setVolume(80)
basic.pause(1000)
// 10 — face 1.
r300_emotion.showFace(r300.Emoji.Happy)
basic.pause(1000)
// 11 — face 2.
r300_emotion.showFace(r300.Emoji.Surprised)
basic.pause(1000)
// 12 — recording: name the routine...
r300_mcp.nameRecording("test", "bench test routine")
basic.pause(1000)
// 13 — ...arm the recorder...
r300_mcp.startRecording()
basic.pause(1000)
// 14 — ...make a move for it to capture...
r300_movement.drive(0, 40, 800)
basic.pause(1000)
// 15 — ...one more...
r300_hands.moveHands(90, 90)
basic.pause(1000)
// 16 — ...then publish it as an AI tool.
r300_mcp.finishRecording()

// Safety net while the robot is moving: A+B stops the wheels immediately.
input.onButtonPressed(Button.AB, function () {
    r300_movement.stop()
})

