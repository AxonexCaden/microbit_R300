// test_2.ts — bench pass over EVERY r300 command, one call per second.
// Copy this whole file into a MakeCode micro:bit project that has the R300 extension
// added, switch to the Blocks view, then press A to run the sequence. The LED matrix
// shows each call's answer ("ok" = R300 accepted it). A+B stops the wheels at any time.
// Not part of the extension: test_2.ts is not in pxt.json, so it never reaches students.

r300.connect()

input.onButtonPressed(Button.A, function () {
    // 1 — wheels: half speed forward.
    basic.showString(r300.motor(0, 50, 1000))
    basic.pause(1000)
    // 2 — wheels: spin right.
    basic.showString(r300.motor(60, 0, 1000))
    basic.pause(1000)
    // 3 — wheels: half speed backward.
    basic.showString(r300.motor(0, -50, 1000))
    basic.pause(1000)
    // 4 — the real stop (the one that also interrupts a move still in flight).
    basic.showString(r300.stopNow())
    basic.pause(1000)
    // 5 — hands: both down.
    basic.showString(r300.arm(90, 90))
    basic.pause(1000)
    // 6 — hands: both forward.
    basic.showString(r300.arm(0, 0))
    basic.pause(1000)
    // 7 — hands: right hand only (-1 leaves the left hand where it is).
    basic.showString(r300.arm(45, -1))
    basic.pause(1000)
    // 8 — speaker: quiet.
    basic.showString(r300.volume(30))
    basic.pause(1000)
    // 9 — speaker: loud.
    basic.showString(r300.volume(80))
    basic.pause(1000)
    // 10 — face 1.
    basic.showString(r300.emoji(r300.Emoji.Happy))
    basic.pause(1000)
    // 11 — face 2.
    basic.showString(r300.emoji(r300.Emoji.Surprised))
    basic.pause(1000)
    // 12 — raw request (the same thing volume() sends, hand-built this time).
    basic.showString(r300.send("vol_set", "{\"vol\":50}"))
    basic.pause(1000)
    // 13 — recording: name the routine...
    basic.showString(r300.describe("test", "bench test routine"))
    basic.pause(1000)
    // 14 — ...arm the recorder...
    basic.showString(r300.takeStart())
    basic.pause(1000)
    // 15 — ...make a move for it to capture...
    basic.showString(r300.motor(0, 40, 800))
    basic.pause(1000)
    // 16 — ...one more...
    basic.showString(r300.arm(90, 90))
    basic.pause(1000)
    // 17 — ...then publish it as an AI tool.
    basic.showString(r300.takeFinish())
    basic.pause(1000)
    // Done: Yes means every call above was answered.
    basic.showIcon(IconNames.Yes)
})

// Safety net while the robot is moving: A+B stops the wheels immediately.
input.onButtonPressed(Button.AB, function () {
    basic.showString(r300.stopNow())
})
