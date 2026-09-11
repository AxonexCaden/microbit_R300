// Local test only (testFiles): never shipped into a student's project.
r300.connect()

// Nothing moves on boot on purpose — this is a robot. Press a button instead, and the LED
// matrix shows what R300 answered ("ok" = it accepted the request, not that it has moved).

// A: one second forward at half speed.
input.onButtonPressed(Button.A, function () {
    basic.showString(r300.motor(0, 50, 1000))
})

// A+B: stop, in case the move above is somehow still running.
input.onButtonPressed(Button.AB, function () {
    basic.showString(r300.motor(0, 0, 0))
})

// B: both hands down, then back to pointing forward.
input.onButtonPressed(Button.B, function () {
    basic.showString(r300.arm(90, 90))
    basic.pause(800)
    basic.showString(r300.arm(0, 0))
})
