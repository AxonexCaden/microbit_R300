// tof_sensor.ts — VL53L0X time-of-flight rangefinder bench.
//
// What this proves: the sensor is wired and answering over I2C. Every reading is shown on the
// LED matrix, continuously.
//
// To run it:
//   1. Add the "Rangefinder" extension in MakeCode (Extensions → search "Rangefinder", or the
//      GitHub URL you used before). It is NOT a dependency of this R300 extension, so a project
//      without it will not compile this file.
//   2. Put tof_sensor.ts in pxt.json's `testFiles` (replacing the current program — one at a
//      time) and `pxt build`, then copy built/binary.hex onto the MICROBIT drive.
// It is a bench file: never in `files`.
//
// Wiring on the micro:bit edge connector: SDA = pin 20, SCL = pin 19, plus 3V and GND. If the
// reading stays 0 with the sensor connected, suspect the bus before the program: the VL53L0X
// answers at address 0x29, and its ID register 0xC0 reads 0xEE on a live part.
//
// R300 polls the latest reading over the P0/P1 link with the `tof_get` op: request `{}`, ack
// `{"st":"ok","d":N}` with N in millimetres and 0 = no valid reading. The handler answers from
// a cache -- Rangefinder.distance() can block ~30 ms, which is too long to hold the serial RX
// callback. A program that never registers the handler answers `noop`, so an older micro:bit
// firmware and this build can share the same R300 code.

Rangefinder.init()

// Millimetres; 0 = no valid reading (also the extension's I2C timeout value).
let lastTofMm = 0

r300.onCustomRequest = function (op: string, p: any): string {
    if (op != "tof_get") return ""
    let d = lastTofMm
    // The VL53L0X tops out around 2 m; anything larger is a no-target sentinel.
    if (d < 0 || d > 2000) d = 0
    return "{\"st\":\"ok\",\"d\":" + d + "}"
}

// Read in a background fiber so the slow LED display can never starve the cache R300 polls.
// A 0 from distance() is the extension's I2C timeout. The VL53L0X loses its configuration when
// its power is removed, so a replugged part needs the full init again; init() is safe to repeat
// (it re-reads the ID and returns at once while the sensor is missing), which is what lets this
// recover without resetting the micro:bit.
control.inBackground(function () {
    while (true) {
        const d = Rangefinder.distance()
        if (d > 0) {
            lastTofMm = d
        } else {
            lastTofMm = 0
            Rangefinder.init()
        }
        basic.pause(50)
    }
})

basic.forever(function () {
    basic.showNumber(lastTofMm)
    basic.pause(200)
})
