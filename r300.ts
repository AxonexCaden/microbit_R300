//% color="#AA278D" icon="" block="R300"
namespace r300 {
    let listenerRegistered = false

    // Set by the shared onDataReceived handler when a control_motor ack line arrives.
    // Module-level, not per-call, because MakeCode's serial.onDataReceived is a single
    // global event handler — controlMotor() polls this instead of reading serial itself.
    let controlMotorAckStatus = ""       // "" = none yet, else "success" | "fail"
    let controlMotorAckChecksum = -1

    // runningTime() at the moment the last ack arrived, -1 if none yet.
    let lastAckTime = -1
    // Checksum of the last MB_cmd sent, so an arriving MB_cmd_ack can be matched to it
    // (the ack key is a fixed string, so the checksum is what identifies the command).
    let lastCmdChecksum = -1

    const CONNECTED_WINDOW_MS = 3000        // 3 missed 1s heartbeats before calling it offline
    const LINK_TEST_CMD = "test"            // R300 checksums the command name only

    const CONTROL_MOTOR_TIMEOUT_MS = 500    // ack-wait bound. Independent of `time` — R300
                                              // acks BEFORE running the move, so this only
                                              // has to cover round-trip latency.
    const CONTROL_MOTOR_MAX_TIME_MS = 3000  // must match R300's kControlMotorMaxTimeMs

    export class R300Link {
        constructor() {
            // tx=P0 -> R300 GPIO21 (rx), rx=P1 <- R300 GPIO10 (tx).
            // Hold Button A while resetting to skip the redirect and stay on
            // USB serial instead, for debugging without a firmware reflash.
            if (!input.buttonIsPressed(Button.A)) {
                serial.redirect(SerialPin.P0, SerialPin.P1, BaudRate.BaudRate115200)
                // Default RX/TX buffers are only 20 bytes (MakeCode default) — our JSON
                // lines (e.g. {"MicroBit_ack":"success","checksum":61}\n = 41 bytes) don't
                // fit, so the buffer wraps before the newline arrives and onDataReceived
                // either never fires or hands back a truncated tail missing the key we
                // search for. 128 matches R300's own MicrobitLink RX line cap.
                serial.setRxBufferSize(128)
                serial.setTxBufferSize(128)
            }

            // Register only once — creating more than one R300Link must not
            // stack duplicate serial.onDataReceived handlers.
            if (!listenerRegistered) {
                listenerRegistered = true
                serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
                    const line = serial.readLine()
                    if (line.indexOf("control_motor_ack") >= 0) {
                        controlMotorAckStatus = line.indexOf("success") >= 0 ? "success" : "fail"
                        controlMotorAckChecksum = extractChecksum(line)
                    } else if (line.indexOf("MB_cmd_ack") >= 0) {
                        lastAckTime = input.runningTime()
                        // Leg 3: confirm back to R300 so the round trip is visible in
                        // R300's console. Safe from ping-pong because R300 has no
                        // handler for diag_ack and deliberately never acks it.
                        const echoed = extractChecksum(line)
                        const ok = line.indexOf("success") >= 0 && echoed == lastCmdChecksum
                        serial.writeString(JSON.stringify({
                            diag_ack: ok ? "success" : "fail", checksum: echoed
                        }) + "\n")
                    } else if (line.indexOf("MicroBit_ack") >= 0) {
                        // Plain sendMessage() ack. Just timestamp it — no reply, or the
                        // two boards would ping-pong forever.
                        lastAckTime = input.runningTime()
                    }
                })
            }
        }

        /**
         * Send a text message to R300, wrapped as JSON with a checksum.
         */
        //% blockId=r300_send_message
        //% block="%this|send message %text to R300"
        //% weight=90
        sendMessage(text: string): void {
            serial.writeString(JSON.stringify({ MicroBit: text, checksum: checksum(text) }) + "\n")
        }

        /**
         * Send one link self-test to R300. R300 answers MB_cmd_ack, and this library
         * answers that with diag_ack — so all three legs appear in R300's console and
         * you can see the reply actually reached the micro:bit.
         */
        //% blockId=r300_test_link
        //% block="%this|test R300 link"
        //% weight=88
        testLink(): void {
            lastCmdChecksum = checksum(LINK_TEST_CMD)
            serial.writeString(JSON.stringify({
                MB_cmd: LINK_TEST_CMD, checksum: lastCmdChecksum
            }) + "\n")
        }

        /**
         * Whether R300 has answered recently. Every message sent gets an ack back,
         * so with the 1s heartbeat running this goes false about 3s after the link
         * drops (R300 unplugged, powered off, or still booting).
         */
        //% blockId=r300_is_connected
        //% block="%this|R300 connected"
        //% weight=85
        isConnected(): boolean {
            if (lastAckTime < 0) return false
            return input.runningTime() - lastAckTime < CONNECTED_WINDOW_MS
        }

        /**
         * Move R300's chassis: rotation/forward are fractions of max speed (-1..1),
         * time is ms (0..3000). Returns whether R300 accepted the command — NOT
         * whether the move has finished, since R300 acks before it moves. Safe to
         * call as a bare statement if you don't care about the result.
         */
        //% blockId=r300_control_motor
        //% block="%this|move rotation %rotation forward %forward for %time ms"
        //% rotation.min=-1 rotation.max=1
        //% forward.min=-1 forward.max=1
        //% weight=80
        controlMotor(rotation: number, forward: number, time: number): boolean {
            rotation = clamp(rotation, -1, 1)
            forward = clamp(forward, -1, 1)
            time = clamp(Math.round(time), 0, CONTROL_MOTOR_MAX_TIME_MS)

            // Checksum text must match R300's "%.2f,%.2f,%d" byte-for-byte, hence toFixed2().
            const canonical = "" + toFixed2(rotation) + "," + toFixed2(forward) + "," + time
            const expected = checksum(canonical)
            controlMotorAckStatus = ""
            controlMotorAckChecksum = -1

            serial.writeString(JSON.stringify({
                cmd: "control_motor", rotation: rotation, forward: forward, time: time, checksum: expected
            }) + "\n")

            let waited = 0
            while (controlMotorAckStatus == "" && waited < CONTROL_MOTOR_TIMEOUT_MS) {
                basic.pause(20)
                waited += 20
            }

            if (controlMotorAckStatus == "") return false            // link hiccup — give up
            if (controlMotorAckChecksum != expected) return false    // stale ack from an earlier call
            return controlMotorAckStatus == "success"
        }
    }

    function checksum(text: string): number {
        // Sum of char codes mod 256 — matches R300's Checksum256() for
        // ASCII text (aimo_v1_edu_microbit_board.cc).
        let sum = 0
        for (let i = 0; i < text.length; i++) {
            sum += text.charCodeAt(i)
        }
        return sum % 256
    }

    function clamp(v: number, lo: number, hi: number): number {
        return Math.max(lo, Math.min(hi, v))
    }

    // MakeCode's `number` type has no `.toFixed()` — build "-0.50"-style text by hand,
    // rounding to 2 decimal places, so it matches R300's "%.2f" byte-for-byte.
    function toFixed2(v: number): string {
        const sign = v < 0 ? "-" : ""
        const scaled = Math.round(Math.abs(v) * 100)
        const intPart = Math.floor(scaled / 100)
        let fracPart = "" + (scaled % 100)
        if (fracPart.length < 2) fracPart = "0" + fracPart
        return sign + intPart + "." + fracPart
    }

    function extractChecksum(line: string): number {
        // Textual scan, not JSON.parse — a corrupted line (a real, observed occurrence
        // on this link) may not even parse; this degrades gracefully instead of throwing.
        const idx = line.indexOf("\"checksum\":")
        if (idx < 0) return -1
        let start = idx + 11
        let end = start
        while (end < line.length && line.charCodeAt(end) >= 48 && line.charCodeAt(end) <= 57) {
            end++
        }
        if (end == start) return -1
        return parseInt(line.substr(start, end - start))
    }

    /**
     * Connect to R300 over the P0/P1 UART link.
     */
    //% blockId=r300_connect
    //% block="connect to R300"
    //% weight=100
    //% blockSetVariable=r300Link
    export function connect(): R300Link {
        return new R300Link()
    }
}
