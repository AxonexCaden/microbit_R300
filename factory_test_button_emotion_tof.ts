// factory_test_button_emotion_tof.ts — micro:bit program for the R300 Pengu factory test.
//
// It does the two things the factory page's "micro:bit link" step checks:
//   * Press A OR B to advance R300's face to the NEXT one, wrapping Delicious back to Happy.
//     Power-up starts on Happy, so the first press of either button goes to Sad. Both buttons
//     do the same thing on purpose: there is no step backwards, so nobody can get stuck
//     walking the list the wrong way.
//   * Answer R300's `tof_get` with the cached VL53L0X reading; that is the page's "TOF
//     distance" panel. The op belongs to this program, not the R300 extension, so any other
//     micro:bit program answers `noop` and the page says UNSUPPORTED.
//
// Both extensions are required: R300 (this repo) and "Rangefinder" (the VL53L0X MakeCode
// extension, added under Extensions). Put this file in pxt.json's `testFiles` and run
// `pxt build`; it is a bench program, never in `files`.
//
// The 19 faces are the ones every monitor profile (floki / pengu / bduck) carries. The three
// custom slots are left out on purpose: a profile with no art for custom1..custom3 still
// ACCEPTS the request and then draws nothing, which looks like a broken test rather than a
// missing picture. Add them after Delicious if this robot's profile has the art.
//
// VL53L0X wiring: SDA = pin 20, SCL = pin 19, plus 3V and GND. If the reading stays 0 with the
// sensor connected, suspect the bus before the program: the part answers at address 0x29.

let faceIndex = 0        // 0..18 — the face on the monitor now
let ready = false        // false until the handshake has landed and the first face is sent

// --- TOF (VL53L0X) ----------------------------------------------------------
// The factory link's 1 Hz poller asks with tof_get ({} -> {"st":"ok","d":N}): N is millimetres,
// 0 means no valid reading. distance() can block ~30 ms on I2C, too long to hold the serial RX
// callback, so the handler only reads this cache; a background fiber keeps it fresh.
Rangefinder.init()
let lastTofMm = 0

r300.onCustomRequest = function (op: string, p: any): string {
    if (op != "tof_get") return ""
    let d = lastTofMm
    // The VL53L0X tops out around 2 m; anything larger is a no-target sentinel.
    if (d < 0 || d > 2000) d = 0
    return "{\"st\":\"ok\",\"d\":" + d + "}"
}

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

// The 19 faces in button order, as wire names. Reordering this list moves which face a press
// asks for, so keep it paired with the names.
let kFaces: string[] = [
    "happy", "sad", "angry", "surprised", "shocked", "confused", "funny",
    "laughing", "silly", "crying", "embarrassed", "loving", "kissy",
    "winking", "cool", "confident", "suspicious", "relaxed", "delicious",
]

// Show one face by number. This sends a single emo_set itself instead of going through
// r300_emotion.showFace: the block path pulls in the general sender (retries, fin, ack wait,
// emoji-name switch), and the combined TOF + face program does not fit the micro:bit flash
// with it. The factory page only needs R300 to SEE the change, not an acknowledged request;
// the ack still comes back and the link's receiver handles it. One loss just means press
// again, which is exactly what the operator is doing.
let faceReqId = 0
function showFaceAt(index: number): void {
    // Callers only pass 0..18 (nextFace wraps, and startup uses 0), so no bounds check here:
    // it was 52 bytes over the flash budget and this is a factory build.
    serial.writeString(r300.buildLine("r", faceReqId, "emo_set", "{\"em\":\"" + kFaces[index] + "\"}") + "\n")
    faceReqId = faceReqId >= 99 ? 0 : faceReqId + 1
    faceIndex = index
}

// Advance one face. 18 is Delicious, the last of the 19, so past it wraps to Happy (0).
// Both button events call this one function, so the two can never drift apart.
function nextFace(): void {
    if (faceIndex == 18) {
        showFaceAt(0)
    } else {
        showFaceAt(faceIndex + 1)
    }
}

// A — next face.
input.onButtonPressed(Button.A, function () {
    if (!(ready && r300_status.isConnected())) {
        return
    }
    nextFace()
})

// B — next face, the same as A.
input.onButtonPressed(Button.B, function () {
    if (!(ready && r300_status.isConnected())) {
        return
    }
    nextFace()
})

// Power-on splash: a heart on the micro:bit's own matrix while the board starts up.
basic.showIcon(IconNames.Heart)

// Wait for the handshake before anything is sent. R300 ignores the link for its first 10–15
// seconds after power-on, and a face sent before that is answered as a failed request. The
// buttons stay inert until `ready` is set, so a press during the wait cannot race the first
// face onto the monitor.
while (!(r300_status.isConnected())) {
    basic.showIcon(IconNames.Asleep)
    basic.pause(200)
}
basic.clearScreen()
showFaceAt(0)            // Happy — the fixed starting point the two buttons step away from
ready = true

// No LED distance readout here on purpose: showNumber and the face sender together overflow the
// micro:bit flash budget by ~1.8 KB. The factory page's TOF panel is the readout; this program
// only has to keep the cache and answer tof_get.
