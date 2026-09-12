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

// P2 (touch P2 and GND): flip the volume between quiet and loud.
// On a pin rather than a button because A / B / A+B are taken, and on P2 specifically
// because P0/P1 carry the serial link. Deliberately not a shake gesture — the robot gets
// handled during these tests and would trigger it by accident.
// This is the only test here that exercises R300's vol_done path: its own request, its own
// thread, its ack match and its fin. That machinery cannot be checked by building.
let loud = false
input.onPinPressed(TouchPin.P2, function () {
    loud = !loud
    basic.showString(r300.volume(loud ? 70 : 30))
    basic.pause(300)
    // What R300 reported as actually APPLIED, not what we asked for. -1 means it never
    // confirmed — which would mean vol_done did not arrive, and is worth seeing.
    basic.showNumber(r300.lastVolume)
})

// Logo touch (micro:bit V2): step through a few faces on R300's monitor.
// On the logo because A / B / A+B and P2 are all taken. No movement risk, so it is the
// safest thing to try first on Monday — and it is the only test that walks the emo_set
// path all the way out to the eyes.
const kFaces = [r300.Emoji.Happy, r300.Emoji.Angry, r300.Emoji.Surprised, r300.Emoji.Loving]
let faceIndex = 0
input.onLogoEvent(TouchButtonEvent.Pressed, function () {
    basic.showString(r300.emoji(kFaces[faceIndex]))
    faceIndex = (faceIndex + 1) % kFaces.length
})

// B: move ONE hand, so this press answers "which hand is a1?".
// Deliberately asymmetric: arm(90, 90) moves both to the same angle and therefore proves
// only that both hands work — it cannot tell a1 from a2, which is the open question
// (the 1=right / 2=left mapping is still an assumption, protocol.md 9.5).
// -1 means "leave that hand alone"; 0 would be a real angle (pointing forward).
input.onButtonPressed(Button.B, function () {
    basic.showString(r300.arm(90, -1))   // whichever hand drops is a1
    basic.pause(1500)
    basic.showString(r300.arm(0, -1))    // and back
})
