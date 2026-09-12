//% color="#AA278D" weight=100 icon="" block="R300"
namespace r300 {
    let connected = false

    /**
     * Connect to R300 over P0 (TX) / P1 (RX). Put it in "on start".
     * Once connected the micro:bit answers R300's link check by itself.
     */
    //% blockId=r300_connect block="connect to R300"
    //% weight=100
    export function connect(): void {
        if (connected) return
        connected = true
        // Hold Button A while resetting to stay on USB serial for debugging.
        if (!input.buttonIsPressed(Button.A)) {
            serial.redirect(SerialPin.P0, SerialPin.P1, BaudRate.BaudRate115200)
            // MakeCode's 20-byte default buffers cannot hold a single protocol line.
            serial.setRxBufferSize(128)
            serial.setTxBufferSize(128)
        }
        serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
            const reply = handleLine(serial.readLine())
            if (reply.length > 0) serial.writeString(reply + "\n")
        })
        // protocol.ts hands every accepted ack to this, so send() below can be woken by it.
        onReply = noteReply
    }

    // ---------------------------------------------------------------------------
    // Sender — test helper
    //
    // Until now R300 drove everything and the micro:bit only answered. This is the first
    // thing that goes the other way, so it is deliberately the smallest sender that is
    // still correct: one request outstanding, a fresh id per request, retries that reuse
    // that id, and a fin only after a final ack (protocol.md 6, 8).
    // ---------------------------------------------------------------------------

    const kAckTimeoutMs = 500
    let nextId = 0
    let waitId = -1
    let waitOp = ""
    let waitState = ""
    let busy = false

    function noteReply(id: number, op: string, p: any): void {
        if (id != waitId || op != waitOp) return
        if (waitState != "") return                 // already answered; a late duplicate changes nothing
        const st = p["st"]
        const e = p["e"]
        if (st == "ok") waitState = "ok"
        else if (e == "badck") waitState = "badck"  // damaged in transit, so a resend can still help
        else waitState = typeof e == "string" ? e : "err"
    }

    /**
     * Send one request and wait for its ack. Returns "ok", or the error code R300 sent
     * ("badarg" / "noop" / "badver" / "busy"), or "timeout" if nothing answered.
     * A timeout or a badck resends the SAME id, so R300 recognises the repeat and replays
     * its ack instead of running the move twice.
     * It blocks (1ms sleeps) — fine for a test, not the shape the final library will have.
     *
     * Only ONE request may be in flight, and this is what enforces it. A and B are separate
     * event handlers, so MakeCode runs them in separate fibers, and every basic.pause() below
     * hands control to the other one. Two overlapping calls would share waitId/waitOp/waitState
     * and each would answer to the other's ack: the first request then never matches its own
     * reply and reports "timeout" for a command R300 actually carried out. R300's (id, op)
     * dedupe stops it MOVING twice, so the damage is a wrong answer on the LED, not a wrong
     * move — which is worse to debug, because it looks exactly like a broken link.
     */
    export function send(op: string, pJson: string): string {
        if (busy) return "busy"
        busy = true
        const result = sendOne(op, pJson)
        busy = false          // one release point: sendOne has three exits
        return result
    }

    function sendOne(op: string, pJson: string): string {
        const id = nextId
        nextId = nextId >= 127 ? 0 : nextId + 1
        let last = "timeout"
        for (let attempt = 0; attempt < 3; attempt++) {
            const line = buildLine("req", id, op, pJson)
            if (line.length == 0) return "long"     // would not fit R300's 128-byte line buffer
            waitId = id
            waitOp = op
            waitState = ""
            const sentAt = control.millis()
            serial.writeString(line + "\n")
            const deadline = sentAt + kAckTimeoutMs
            while (waitState == "" && control.millis() < deadline) basic.pause(1)
            if (waitState == "") { last = "timeout"; continue }
            if (waitState == "badck") { last = "badck"; continue }
            waitId = -1
            // Only a final ack earns a fin; it also carries the round trip time back.
            serial.writeString(buildLine("fin", id, op, "{\"rtt\":" + (control.millis() - sentAt) + "}") + "\n")
            return waitState
        }
        waitId = -1
        return last
    }

    /**
     * Drive the wheels. rot / fwd are -100..100 percent of full speed, ms is 0..3000 and
     * says how long the motor board should run for. A stop is rot=0 and fwd=0.
     * The return value says whether R300 *accepted* the request — not that the robot moved.
     */
    export function motor(rot: number, fwd: number, ms: number): string {
        return send("leg_set", "{\"rot\":" + rot + ",\"fwd\":" + fwd + ",\"ms\":" + ms + "}")
    }


    /**
     * The faces R300's monitor board can show. This list is the gate on what a student can
     * send — R300 itself only checks the FORMAT, deliberately, so the vocabulary lives in
     * one place instead of three.
     *
     * These 19 are the names present in ALL THREE monitor profiles (floki / pengu / bduck),
     * so a robot built as a different character still knows every one. The other 8 names in
     * the GIF table are system states (connecting / disconnected / listening / neutral /
     * standby / startup / thinking / sleepy) and are left out on purpose: picking
     * "disconnected" would not disconnect anything, `neutral` gets remapped to `standby`
     * while the robot is idle so it would not even show the face you chose, and `sleepy` is
     * missing from the bduck profile.
     */
    export enum Emoji {
        //% block="happy"
        Happy,
        //% block="sad"
        Sad,
        //% block="angry"
        Angry,
        //% block="surprised"
        Surprised,
        //% block="shocked"
        Shocked,
        //% block="confused"
        Confused,
        //% block="funny"
        Funny,
        //% block="laughing"
        Laughing,
        //% block="silly"
        Silly,
        //% block="crying"
        Crying,
        //% block="embarrassed"
        Embarrassed,
        //% block="loving"
        Loving,
        //% block="kissy"
        Kissy,
        //% block="winking"
        Winking,
        //% block="cool"
        Cool,
        //% block="confident"
        Confident,
        //% block="suspicious"
        Suspicious,
        //% block="relaxed"
        Relaxed,
        //% block="delicious"
        Delicious,
    }

    function emojiName(e: Emoji): string {
        // A switch, not an array indexed by the enum: a lookup table sends the wrong face
        // the first time somebody reorders the list, and says nothing about it.
        switch (e) {
            case Emoji.Happy: return "happy"
            case Emoji.Sad: return "sad"
            case Emoji.Angry: return "angry"
            case Emoji.Surprised: return "surprised"
            case Emoji.Shocked: return "shocked"
            case Emoji.Confused: return "confused"
            case Emoji.Funny: return "funny"
            case Emoji.Laughing: return "laughing"
            case Emoji.Silly: return "silly"
            case Emoji.Crying: return "crying"
            case Emoji.Embarrassed: return "embarrassed"
            case Emoji.Loving: return "loving"
            case Emoji.Kissy: return "kissy"
            case Emoji.Winking: return "winking"
            case Emoji.Cool: return "cool"
            case Emoji.Confident: return "confident"
            case Emoji.Suspicious: return "suspicious"
            case Emoji.Relaxed: return "relaxed"
            case Emoji.Delicious: return "delicious"
        }
        return "happy"
    }

    /**
     * Show a face on R300's monitor (the eyes). Returns "ok" once R300 has ACCEPTED it.
     * "ok" means R300 forwarded it, NOT that the face changed — R300 cannot promise the
     * second without stalling the link. The face then stays until something else changes it.
     */
    //% blockId=r300_emoji block="show face %e"
    //% weight=90
    export function emoji(e: Emoji): string {
        return send("emo_set", "{\"emoji\":\"" + emojiName(e) + "\"}")
    }
    /**
     * Set the speaker volume, 0..100. Returns "ok" once R300 has ACCEPTED it.
     * R300 separately confirms that the level actually landed, and that value shows up in
     * r300.lastVolume — "accepted" and "applied" are different claims and this link
     * reports them separately.
     */
    export function volume(v: number): string {
        return send("vol_set", "{\"vol\":" + v + "}")
    }

    /**
     * Move the hands. a1 = right hand, a2 = left hand, physical degrees 0..180
     * (0 = forward, 90 = down, 180 = back). Pass -1 for a hand to leave it alone: the key is
     * then left out of the request, because 0 is a real angle and cannot mean "don't move".
     */
    export function arm(a1: number, a2: number): string {
        let p = "{"
        if (a1 >= 0) p += "\"a1\":" + a1
        if (a2 >= 0) p += (a1 >= 0 ? "," : "") + "\"a2\":" + a2
        return send("arm_set", p + "}")
    }
}
