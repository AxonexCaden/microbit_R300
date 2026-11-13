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

Rangefinder.init()
basic.forever(function () {
    basic.showNumber(Rangefinder.distance())
})
