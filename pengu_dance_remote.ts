// pengu_dance_remote.ts — the trigger and stop for pengu_dance.ts, on a second micro:bit.
//
// Flash this to the REMOTE board. The robot's onboard board runs pengu_dance.ts; both must be
// on the same radio group and use the same numbers — RADIO_GROUP 1, DANCE_TRIGGER 42 and
// STOP_TRIGGER 43 here, and the same three constants in pengu_dance.ts. Change one, change both.
//
// The radio is 2.4 GHz and does not touch P0/P1, so it cannot interfere with the R300 link.
//
//   A — send the start signal. The robot checks its link and then dances.
//   B — send the stop signal. The robot stops its wheels immediately and skips the rest of the
//       beats — the same thing A+B does on the robot itself.
//
// Both buttons show a tick/cross for a moment as confirmation that this board sent something.
//
// No R300 extension is needed here. Simplest is a new blank MakeCode project with just this
// code; if you build it from this repo instead, the extension's auto-connect runs too and is
// harmless (there is no robot on this board's UART).

const RADIO_GROUP = 1
const DANCE_TRIGGER = 42
const STOP_TRIGGER = 43

radio.setGroup(RADIO_GROUP)

input.onButtonPressed(Button.A, function () {
    sendThree(DANCE_TRIGGER)
    basic.showIcon(IconNames.Yes)
    basic.pause(300)
    basic.clearScreen()
})

input.onButtonPressed(Button.B, function () {
    sendThree(STOP_TRIGGER)
    basic.showIcon(IconNames.No)
    basic.pause(300)
    basic.clearScreen()
})

// Three copies: a radio packet can be lost. A repeated start is ignored by the robot's `dancing`
// guard, and a repeated stop is harmless.
function sendThree(signal: number) {
    for (let i = 0; i < 3; i++) {
        radio.sendNumber(signal)
        basic.pause(30)
    }
}
