//% color="#AA278D" weight=100 block="R300"
namespace r300 {
    let connected = false

    /**
     * Connect to R300 over P0 (TX) / P1 (RX). Put it in "on start".
     * Once connected the micro:bit answers R300's link check by itself.
     */
    //% blockId=r300_connect block="connect to R300"
    //% blockHidden=true
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
    // Longest a description can be and still fit inside ONE request line: 127 bytes minus the
    // envelope, the 16-char name and a 3-digit id leaves about this many (protocol.md 9.7).
    const kMaxDescChars = 34
    // How long stopNow() gives a request to abandon itself before it gives up on it. The
    // give-up path is only reached by a sender wedged somewhere other than its wait loop.
    const kStopWaitMs = 300
    let nextId = 0
    let waitId = -1
    let waitOp = ""
    let waitState = ""
    let busy = false
    // Set by stopNow() to tell the request in flight to stand down. sendOne checks it on every
    // 1ms tick of its wait loop, so this normally costs about a millisecond.
    let abandoned = false

    function noteReply(id: number, op: string, p: any): void {
        if (id != waitId || op != waitOp) return
        if (waitState != "") return                 // already answered; a late duplicate changes nothing
        // p is whatever the far end put after `"p":` — a damaged or hand-built line can leave it
        // missing or not an object at all, and this runs inside the RX handler, so a throw here
        // takes the link down for something as harmless as an ack with no payload.
        if (p === undefined || p === null || typeof p != "object") { waitState = "err"; return }
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
    //% blockId=r300_send block="send %op with payload %pJson"
    //% blockHidden=true
    //% weight=60
    export function send(op: string, pJson: string): string {
        if (busy) return "busy"
        busy = true
        abandoned = false     // a fresh request waits for its own ack, not the last one's
        const result = sendOne(op, pJson)
        busy = false          // the single release point: every sendOne exit passes through here
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
            while (waitState == "" && control.millis() < deadline) {
                // stopNow() asked whoever is in flight to stand down. Nothing this request was
                // doing is wanted any more, and the stop cannot go out until we leave.
                if (abandoned) return "stopped"
                basic.pause(1)
            }
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
    //% blockId=r300_motor block="drive rot %rot fwd %fwd for %ms ms"
    //% blockHidden=true
    //% rot.min=-100 rot.max=100 rot.defl=0
    //% fwd.min=-100 fwd.max=100 fwd.defl=50
    //% ms.min=0 ms.max=3000 ms.defl=1000
    //% weight=95
    export function motor(rot: number, fwd: number, ms: number): string {
        return send("leg_set", "{\"rot\":" + rot + ",\"fwd\":" + fwd + ",\"ms\":" + ms + "}")
    }

    /**
     * Stop the wheels NOW. Unlike motor(0, 0, 0), this is allowed to interrupt a request that is
     * still in flight — which is the whole point of an emergency stop, and the one case where
     * "one request at a time" has to give way.
     *
     * motor(0, 0, 0) does NOT work as a stop button. Every MakeCode button handler runs in its
     * own fiber, so pressing the stop while another move is waiting for its ack reaches send()'s
     * in-flight guard and comes back "busy" WITHOUT SENDING ANYTHING — and the wheels carry on
     * turning for whatever was left of that move. That is what this exists for.
     */
    //% blockId=r300_stop block="stop driving now"
    //% blockHidden=true
    //% weight=94
    export function stopNow(): string {
        abandoned = true
        // The sender sees the flag on its next 1ms tick, so this normally costs about a
        // millisecond. The bound only matters for a request wedged somewhere else, and then we
        // report "busy" rather than put a second request on top of the first.
        const deadline = control.millis() + kStopWaitMs
        while (busy && control.millis() < deadline) basic.pause(1)
        if (busy) return "busy"
        return send("leg_set", "{\"rot\":0,\"fwd\":0,\"ms\":0}")
    }

    // ---------------------------------------------------------------------------
    // Recording — perform a routine once and let the AI trigger it by name afterwards.
    //
    // Three separate calls, deliberately NOT one blocking record(): each send() waits up to
    // 1.5 seconds for R300's ack, and the moves you want captured have to happen BETWEEN start
    // and finish. The student presses something for each; see test.ts for the whole flow.
    // ---------------------------------------------------------------------------

    /**
     * Name the routine you are about to record, and say what it does. Call it BEFORE takeStart().
     * The name must be 1-16 characters of a-z, 0-9 or _ — it becomes part of the AI's tool name,
     * so no spaces and no capitals.
     * Calling it again with the SAME name APPENDS to the description, which is how a description
     * longer than one line gets sent: pass at most kMaxDescChars (34) characters at a time.
     */
    //% blockHidden=true
    //% blockId=r300_describe block="name recording %name described as %desc"
    //% weight=89
    export function describe(name: string, desc: string): string {
        // Caught here rather than left to send(), because "long" is the one failure a student can
        // actually fix — by splitting the description across several describe() calls.
        if (desc.length > kMaxDescChars) return "long"
        return send("mcp_desc", "{\"name\":\"" + name + "\",\"desc\":\"" + desc + "\"}")
    }

    /**
     * Start recording. Every move R300 ACCEPTS from here on is captured, so perform the routine
     * AFTER this returns. The moves still happen live while you record them, so you are watching
     * the routine being built.
     * The name must already have been sent with describe(). Returns "ok" once R300 is armed.
     */
    //% blockHidden=true
    //% blockId=r300_take_start block="start recording moves"
    //% weight=88
    export function takeStart(): string {
        return send("mcp_take", "{\"state\":\"start\"}")
    }

    /**
     * Stop recording and publish it as a tool. R300 answers "ok" for the take itself, and then
     * reports the finished tool separately through lastTakeName / lastTakeSteps / lastTakeDrop.
     *
     * 🔴 Read lastTakeDrop. R300 keeps at most 64 moves; anything past that still runs but is not
     * recorded, and drop > 0 is the only sign on this side that the routine is incomplete.
     * A take with no moves in it is refused with "badarg", as is finishing without starting.
     */
    //% blockId=r300_take_finish block="finish recording as an AI tool"
    //% blockHidden=true
    //% weight=87
    export function takeFinish(): string {
        return send("mcp_take", "{\"state\":\"finish\"}")
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
    //% blockHidden=true
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
    //% blockId=r300_volume block="set volume %v"
    //% blockHidden=true
    //% v.min=0 v.max=100 v.defl=50
    //% weight=92
    export function volume(v: number): string {
        return send("vol_set", "{\"vol\":" + v + "}")
    }

    /**
     * Move the hands. a1 = right hand, a2 = left hand, physical degrees 0..180
     * (0 = forward, 90 = down, 180 = back). Pass -1 for a hand to leave it alone: the key is
     * then left out of the request, because 0 is a real angle and cannot mean "don't move".
     */
    //% blockId=r300_arm block="move hands to %a1 and %a2 degrees"
    //% blockHidden=true
    //% a1.min=-1 a1.max=180 a1.defl=90
    //% a2.min=-1 a2.max=180 a2.defl=90
    //% weight=93
    export function arm(a1: number, a2: number): string {
        let p = "{"
        if (a1 >= 0) p += "\"a1\":" + a1
        if (a2 >= 0) p += (a1 >= 0 ? "," : "") + "\"a2\":" + a2
        return send("arm_set", p + "}")
    }

    // Clamp a number into an inclusive range. Deliberately NOT a block: it exists for the
    // student-facing wrappers below, whose arguments can come from JavaScript or from
    // arithmetic and therefore never met a block field's min/max. R300 refuses out-of-range
    // values (badarg), and a void block cannot show that, so the range has to hold before the
    // request is built.
    export function clamp(v: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, v))
    }
}

// ---------------------------------------------------------------------------
// Student-facing blocks
//
// One namespace per subsystem, mirroring pxt-axonex_test's layout. Every function is a thin
// wrapper over the r300 API above — r300 stays the internal API, and these namespaces are the
// surface students are meant to use. They all return void, so each one drops into "on start"
// as a plain statement block; the answer R300 sends back is discarded (that report belongs in
// a status block, not in every action).
//
// The link opens itself at power-up: r300.connect() runs as a top-level statement at the end
// of this file, BEFORE any "on start" code, so there is no connect block to forget. That call
// is guarded, so calling it again (benches, or from TypeScript) is a no-op.
//
// The r300.* blocks above are hidden from the toolbox (blockHidden in their annotations),
// so this is everything a student sees; r300 itself stays callable from TypeScript.
//
// Every numeric input is rounded and clamped before the request is built — the block fields
// already clamp typed values in the IDE, but a value computed in JavaScript never met one.
// ---------------------------------------------------------------------------

//% color="#E67E22" icon="\uf085" block="R300 Movement"
//% groups="['Drive Control']"
namespace r300_movement {
    /**
     * Drive the wheels for ms milliseconds and WAIT for the move to finish before the next
     * block runs. Without the wait the next command lands mid-move and overwrites it, so a
     * list of drives would only ever show the last one moving. rot / fwd are -100..100 percent
     * of full speed, and both 0 is a stop. A stop from another event handler still stops the
     * wheels mid-move, because every handler runs in its own fiber. The wire record of what
     * R300 did with it lives in R300's console, not here.
     */
    //% blockId=r300_movement_drive block="drive rot %rot fwd %fwd for %ms ms"
    //% rot.min=-100 rot.max=100 rot.defl=0
    //% fwd.min=-100 fwd.max=100 fwd.defl=50
    //% ms.min=0 ms.max=3000 ms.defl=1000
    //% weight=90
    //% group="Drive Control"
    export function drive(rot: number, fwd: number, ms: number): void {
        // Round first, then clamp: the clamp must be the LAST step, or rounding a boundary
        // value could push it back out of range. Keep these bounds in step with the //% values.
        rot = r300.clamp(Math.round(rot), -100, 100)
        fwd = r300.clamp(Math.round(fwd), -100, 100)
        ms = r300.clamp(Math.round(ms), 0, 3000)
        r300.motor(rot, fwd, ms)
        // The command is only the START of the move: R300 hands `ms` to the motor board and
        // answers straight away, so hold the student's code still until the move is over.
        basic.pause(ms)
    }

    /**
     * Stop the wheels NOW. Unlike drive(0, 0, 0), this also interrupts a move that is
     * still in flight, so it works as an emergency stop even from another button handler.
     */
    //% blockId=r300_movement_stop block="stop driving now"
    //% weight=89
    //% group="Drive Control"
    export function stop(): void {
        r300.stopNow()
    }
}

//% color="#E67E22" icon="\uf256" block="R300 Hands"
//% groups="['Hand Control']"
namespace r300_hands {
    /**
     * Move the hands. a1 / a2 are physical degrees 0..180 (0 = forward, 90 = down,
     * 180 = back). Pass -1 for a hand to leave it alone.
     */
    //% blockId=r300_hands_move block="move hands to %a1 and %a2 degrees"
    //% a1.min=-1 a1.max=180 a1.defl=90
    //% a2.min=-1 a2.max=180 a2.defl=90
    //% weight=90
    //% group="Hand Control"
    export function moveHands(a1: number, a2: number): void {
        // -1 (leave the hand alone) is the floor, so clamping can never turn "skip" into a move.
        a1 = r300.clamp(Math.round(a1), -1, 180)
        a2 = r300.clamp(Math.round(a2), -1, 180)
        r300.arm(a1, a2)
    }
}

//% color="#E67E22" icon="\uf118" block="R300 Emotion"
//% groups="['Emotion Control']"
namespace r300_emotion {
    /**
     * Show a face on R300's monitor (the eyes). The face stays until something else
     * changes it.
     */
    //% blockId=r300_emotion_show block="show face %e"
    //% weight=90
    //% group="Emotion Control"
    export function showFace(e: r300.Emoji): void {
        r300.emoji(e)
    }
}

//% color="#E67E22" icon="\uf028" block="R300 Speaker"
//% groups="['Audio Actions']"
namespace r300_speaker {
    /**
     * Set the speaker volume, 0..100.
     */
    //% blockId=r300_speaker_volume block="set speaker volume to %v"
    //% v.min=0 v.max=100 v.defl=50
    //% weight=90
    //% group="Audio Actions"
    export function setVolume(v: number): void {
        v = r300.clamp(Math.round(v), 0, 100)
        r300.volume(v)
    }
}

//% color="#8E44AD" icon="\uf0d0" block="R300 MCP"
//% groups="['MCP Setup']"
namespace r300_mcp {
    // The description is what the voice AI reads to decide when to call the tool, and it is
    // the one field a student types that can run past the wire's 127-byte line (protocol.md
    // 9.7 allows about 34 characters in the worst case). 32 keeps the line safely under it
    // AND keeps the text short enough to be useful as a tool description. A longer one is
    // REFUSED, never truncated: a quiet fix-up would look like it worked while the AI only
    // got half a clue. The block text says "(max 32 chars)" — keep the two in step.
    const DESC_MAX = 32

    // Local refusals show the limit that blocked them on the LED. Nothing was sent, so
    // there is no ack and nothing in R300's log to find.
    function refuse(limit: number): void {
        basic.showNumber(limit)
        basic.pause(1000)
        basic.clearScreen()
    }

    /**
     * Name the routine about to be recorded and say what it does. Call it BEFORE
     * startRecording(). The name must be 1-16 characters of a-z, 0-9 or _ — it becomes
     * part of the AI's tool name. Calling it again with the same name appends to the
     * description.
     * Keep the description to 32 characters or fewer — a longer one is refused and shows
     * 32 on the LED (nothing is sent to R300).
     */
    //% blockId=r300_mcp_name block="name recording %name described as %desc (max 32 chars)"
    //% weight=90
    //% group="MCP Setup"
    export function nameRecording(name: string, desc: string): void {
        if (desc.length > DESC_MAX) {
            refuse(DESC_MAX)
            return
        }
        r300.describe(name, desc)
    }

    /**
     * Start recording: every move R300 accepts from here on is captured, and the moves
     * still happen live while you perform them.
     */
    //% blockId=r300_mcp_start block="start recording moves"
    //% weight=89
    //% group="MCP Setup"
    export function startRecording(): void {
        r300.takeStart()
    }

    /**
     * Stop recording and publish it as a tool the voice AI can call by name.
     */
    //% blockId=r300_mcp_finish block="finish recording as an AI tool"
    //% weight=88
    //% group="MCP Setup"
    export function finishRecording(): void {
        r300.takeFinish()
    }
}

// ---------------------------------------------------------------------------
// Auto-connect at power-up
//
// A top-level statement, so it runs before any "on start" code and no student has to
// remember a connect block. r300.connect() is guarded, so this call and any later one
// (benches, or TypeScript that still calls connect) cost nothing.
// ---------------------------------------------------------------------------
r300.connect()

