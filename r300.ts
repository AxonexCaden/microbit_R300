//% color="#E67E22" weight=100 block="R300"
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
            // MakeCode's 20-byte default buffers cannot hold a single protocol line; 254 is
            // the documented maximum for both.
            serial.setRxBufferSize(254)
            serial.setTxBufferSize(254)
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
    // that id, and a fin only after a final ack (README.md 6, 8).
    // ---------------------------------------------------------------------------

    const kAckTimeoutMs = 500
    // Longest description one describe() carries; longer text is appended across calls
    // (README.md 9.7). Sentence-sized on purpose -- fitting one 253-byte line is no
    // longer what sets it.
    const kMaxDescChars = 34
    // Longest recording NAME: it becomes part of the AI's tool name on R300 (README.md 9.7).
    // Keep in lockstep with R300's kMaxName -- the same name must be answered the same way
    // whether or not the link is up.
    const kMaxNameChars = 24
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

    // The reply to the most recent request, worded the way R300 words it: "ok" when it took the
    // request, or "badarg" / "noop" / "badver" / "busy" / "timeout" / "long" when it did not.
    // The student-facing ACTION blocks throw that answer away on purpose — one refusal should
    // not put a number on the LED of every block — so it is kept here instead, for the status
    // block that does want it. "" until something has been sent.
    export let lastReply = ""

    // The single writer for lastReply. Exported because the student-facing wrappers refuse some
    // input THEMSELVES — a description past 32 characters never leaves the micro:bit — and that
    // refusal has to be as visible to a status block as one R300 sent back.
    export function setLastReply(reply: string): void {
        lastReply = reply
    }

    // "Record and return", for the paths in this file that produce a reply WITHOUT going through
    // send(): nothing went on the wire, but the request still failed, and a status block has to
    // be able to see that.
    function keepReply(reply: string): string {
        setLastReply(reply)
        return reply
    }

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
        if (busy) return keepReply("busy")
        busy = true
        abandoned = false     // a fresh request waits for its own ack, not the last one's
        const result = sendOne(op, pJson)
        busy = false          // the single release point: every sendOne exit passes through here
        return keepReply(result)
    }

    function sendOne(op: string, pJson: string): string {
        const id = nextId
        // Same 0-99 id space as R300's senders; a retry reuses the id it is retrying.
        nextId = nextId >= 99 ? 0 : nextId + 1
        let last = "timeout"
        for (let attempt = 0; attempt < 3; attempt++) {
            const line = buildLine("r", id, op, pJson)
            if (line.length == 0) return "long"     // would not fit R300's 254-byte line buffer
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
            serial.writeString(buildLine("f", id, op, "{\"rt\":" + (control.millis() - sentAt) + "}") + "\n")
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
        return send("leg_set", "{\"ro\":" + rot + ",\"fd\":" + fwd + ",\"ms\":" + ms + "}")
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
        // The only exit from here that never reaches send(), so the only one that has to record
        // its own answer.
        if (busy) return keepReply("busy")
        return send("leg_set", "{\"ro\":0,\"fd\":0,\"ms\":0}")
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
     * The name must be 1-24 characters of a-z, 0-9 or _ — it becomes part of the AI's tool name
     * (R300's kMaxName), so no spaces and no capitals.
     * Calling it again with the SAME name APPENDS to the description, which is how a description
     * longer than one line gets sent: pass at most kMaxDescChars (34) characters at a time.
     */
    //% blockHidden=true
    //% blockId=r300_describe block="name recording %name described as %desc"
    //% weight=89
    export function describe(name: string, desc: string): string {
        // Caught here rather than left to send(), because "long" is the one failure a student can
        // actually fix — by splitting the description across several describe() calls.
        if (desc.length > kMaxDescChars) return keepReply("long")
        // The name becomes part of a tool name on R300, so its rule ([a-z0-9_], 1-24 chars,
        // lockstep with R300's kMaxName) is enforced here too — same answer whether or not
        // the link is up.
        if (!isToken(name, kMaxNameChars)) return keepReply("badarg")
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
        return send("emo_set", "{\"em\":\"" + emojiName(e) + "\"}")
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
        return send("vol_set", "{\"vl\":" + v + "}")
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

    /**
     * Let the user talk over R300 while it is speaking — interrupting the reply — or stop
     * letting them. An absolute mode, never a toggle: "on" sent twice is still on, so a
     * replayed request cannot flip it either way.
     * R300 refuses it with "badarg" whenever it is not idle (changing the mode closes the audio
     * channel, which would cut off the reply being spoken), and that refusal is cached — but
     * pressing the block again is a fresh request, because every send() takes a new id. "noop"
     * means this R300's firmware was built without AEC, not that the link is broken.
     * "ok" only ever means accepted: the mode is applied on R300's main loop, so a bench reads
     * its log (`AEC mode -> 1`), never this return value. Nothing here survives a reboot.
     */
    //% blockId=r300_aec block="talk over the reply %on"
    //% blockHidden=true
    //% weight=91
    export function aec(on: boolean): string {
        return send("aec_set", "{\"on\":" + (on ? 1 : 0) + "}")
    }

    /**
     * Be in a conversation with R300's AI, or be out of one — the same thing one press of the
     * robot's boot button does. An absolute mode, never a toggle: "on" sent twice is still on,
     * so a repeated request cannot flip it either way.
     * There is no second reply for this op: "ok" means R300 accepted the request, not that the
     * conversation has opened or closed yet.
     * "badarg" is the one answer to plan for, and it covers a malformed payload AND a refusal by
     * state, which a program cannot tell apart. The state refusals: {"on":0} while R300 is
     * SPEAKING, which it answers badarg rather than cut off its own reply — the surprise for a
     * student who expects a stop button; {"on":0} while a connection is still being made, which
     * cannot be cancelled; and either direction during start-up, activation, WiFi setup, the
     * audio test or limited charging. Retrying after a refusal needs a fresh id, which every
     * send() gives it — the refusal itself is cached against the (id, op) pair.
     */
    //% blockId=r300_ai block="conversation with the AI %on"
    //% blockHidden=true
    //% weight=91
    export function ai(on: boolean): string {
        return send("ai_set", "{\"on\":" + (on ? 1 : 0) + "}")
    }

    /**
     * Play one of the robot's three songs by number: 0 = ActiveSummer, 1 = CosmicFluff, 2 = Fever.
     * "ok" means R300 accepted the request, not that anything is audible yet.
     * MUSIC ONLY: R300 does not move on its own while a song plays, so the wheels and hands stay
     * the program's to drive. There is no "the song finished" reply and no way to ask for one, so
     * a program that chains two songs has to time the gap itself, and a song cut short (boot
     * button, R300's own stop_dance, the model starting a dance) says nothing. While music plays
     * R300 mutes its own mic, so it cannot hear anyone until the song ends.
     * "badarg" is the one answer to plan for, and it covers a malformed payload, an index outside
     * 0..2 AND a song already playing — a program cannot tell those apart, and this never replaces
     * what is playing. The index is deliberately NOT clamped: it is the robot's own numbering, so
     * a wrong one has to look wrong on the bench rather than quietly play song 0. "noop" means
     * this R300's firmware predates song_set, the same lesson as aec_set and ai_set.
     */
    //% blockId=r300_song block="play song %ix"
    //% blockHidden=true
    //% ix.min=0 ix.max=2 ix.defl=0
    //% weight=91
    export function song(ix: number): string {
        return send("song_set", "{\"ix\":" + ix + "}")
    }

    /**
     * Take a photo and put it to the vision model with a question: what the model does through its
     * own take-photo tool, except a program starts it and nobody has to speak.
     * q is optional — leave it out and R300 asks its own default ("What do you see?"), which is why
     * an empty question is sent as `{}` rather than `{"q":""}`: R300 refuses a literal empty q.
     * Anything else in q is JSON-escaped first (escapeJson), because a `"` or a `\` in the text
     * would otherwise break the payload and R300 would drop the line without an ack.
     * "ok" means accepted, not done — and NOTHING comes back for this op: no answer, no "the photo
     * finished", no image. R300 speaks the answer and logs it; this side never sees it, so there is
     * no ask-and-wait shape to build.
     * ⚠️ It needs an OPEN AI CONVERSATION (ai_set, or the robot's own boot button): the vision
     * endpoint's URL reaches R300 from the server during the MCP handshake, so only a conversation
     * that actually opened has it. That cannot be checked from here — the boot button changes the
     * state behind our back and "ok" means accepted rather than applied, so a flag kept on this
     * side would be confidently wrong. On a robot that was never connected the op still answers ok
     * and then fails silently in R300's log.
     * ⚠️ The ack lands in milliseconds but the work takes ~9 s (~20 s worst case), and the photo
     * sits on the robot's screen for about 5 s. The wheels and hands keep working throughout —
     * leg_set/arm_set go straight to the motor board and are never queued — but emo_set and
     * song_set are queued behind the photo and land when it finishes, up to ~9 s late.
     * "badarg" covers: no camera on this unit, limited charging mode, a vision call already in
     * flight, and a q that is present but not a usable string. "noop" means this R300's firmware
     * predates cam_set.
     */
    //% blockId=r300_cam block="take a photo and ask %q"
    //% blockHidden=true
    //% weight=91
    export function cam(q: string): string {
        return send("cam_set", q.length == 0 ? "{}" : "{\"q\":\"" + escapeJson(q) + "\"}")
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
// The toolbox layout is deliberately flat: one namespace per category, weights ordering the
// blocks inside it, and group labels ONLY where they earn their keep — so the main list carries
// no label, because a label over a single block is noise. `others` is the reserved name for
// that unlabelled list and it is listed FIRST on purpose: the groups array is also the order the
// groups appear in the flyout. Each action category ends with its "More" group, which is where
// the two manual-control blocks live — out of a beginner's way, but still in the toolbox.
//
// Every numeric input is rounded and clamped before the request is built — the block fields
// already clamp typed values in the IDE, but a value computed in JavaScript never met one.
// ---------------------------------------------------------------------------

//% color="#E67E22" icon="\uf085" weight=95 block="R300 Movement"
//% groups="['others', 'More']"
namespace r300_movement {
    // Fixed speeds, as percent of full speed. Deliberately not fields: the block a student
    // picks says WHICH WAY, and how long is the only thing worth tuning in a lesson.
    const MOVE_SPEED = 80
    const TURN_SPEED = 80
    // A turn runs this long. Also fixed: "left" and "right" are one obvious amount of turn
    // each, and the motor window's 3000 ms ceiling is a full spin, not a turn.
    const TURN_MS = 1000

    /**
     * Drive forward, then WAIT for the move to finish before the next block runs. Without the
     * wait the next command lands mid-move and overwrites it, so a list of moves would only
     * ever show the last one moving. A stop from another event handler still stops the wheels
     * mid-move, because every handler runs in its own fiber.
     */
    //% blockId=r300_movement_forward block="move forward for %seconds seconds"
    //% seconds.min=1 seconds.max=3 seconds.defl=1
    //% weight=100
    export function moveForward(seconds: number): void {
        driveStraight(MOVE_SPEED, seconds)
    }

    /**
     * Drive backward for `seconds`. Same wait as moveForward().
     */
    //% blockId=r300_movement_backward block="move backward for %seconds seconds"
    //% seconds.min=1 seconds.max=3 seconds.defl=1
    //% weight=90
    export function moveBackward(seconds: number): void {
        driveStraight(-MOVE_SPEED, seconds)
    }

    /**
     * Turn left on the spot: the wheels counter-rotate for a second, then stop. No field —
     * how far a turn actually gets you is a property of the robot and the floor, not
     * something a student can usefully guess at.
     */
    //% blockId=r300_movement_left block="move left"
    //% weight=80
    export function moveLeft(): void {
        turn(-TURN_SPEED)
    }

    /**
     * Turn right on the spot. The mirror of moveLeft().
     */
    //% blockId=r300_movement_right block="move right"
    //% weight=70
    export function moveRight(): void {
        turn(TURN_SPEED)
    }

    /**
     * Stop the wheels NOW. Unlike drive(0, 0, 0), this also interrupts a move that is still in
     * flight, so it works as an emergency stop even from another button handler.
     */
    //% blockId=r300_movement_stop block="stop driving now"
    //% weight=60
    export function stop(): void {
        r300.stopNow()
    }

    /**
     * Full manual control, for when the four direction blocks cannot say what you mean: rot /
     * fwd are -100..100 percent of full speed and can BOTH be non-zero at once (a curve), ms is
     * 0..3000 and says how long the motor board should run. rot and fwd both 0 is a stop.
     * Like the direction blocks, this waits out the move before the next block runs — a stop
     * from another handler still cuts it short, because every handler runs in its own fiber.
     */
    //% blockId=r300_movement_drive block="drive rot %rot fwd %fwd for %ms ms"
    //% rot.min=-100 rot.max=100 rot.defl=0
    //% fwd.min=-100 fwd.max=100 fwd.defl=50
    //% ms.min=0 ms.max=3000 ms.defl=1000
    //% weight=10
    //% group="More"
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

    // Seconds -> the millisecond window R300's motor board takes. Rounded first, then clamped:
    // the clamp must be the LAST step, or rounding a boundary value could push it back out of
    // range. Keep the bounds in step with the //% values above. The floor is 1 ms, not 0: a
    // move with ms = 0 makes R300 answer badarg (0 means "use the board's own default
    // duration", which is never what was meant).
    function secondsToMs(seconds: number): number {
        return r300.clamp(Math.round(seconds * 1000), 1, 3000)
    }

    // rot = 0: straight line. The sign of `speed` picks the direction.
    function driveStraight(speed: number, seconds: number): void {
        const ms = secondsToMs(seconds)
        r300.motor(0, speed, ms)
        // The command is only the START of the move: R300 hands `ms` to the motor board and
        // answers straight away, so hold the student's code still until the move is over.
        basic.pause(ms)
    }

    // fwd = 0: spinning in place. The sign of `speed` picks the side.
    function turn(speed: number): void {
        r300.motor(speed, 0, TURN_MS)
        basic.pause(TURN_MS)
    }
}

//% color="#E67E22" icon="\uf256" weight=94 block="R300 Hands"
//% groups="['others', 'More']"
namespace r300_hands {
    /**
     * Where a hand can point — the dropdown offers exactly these three.
     *
     * The angles follow pxt-axonex_test's HandPosition: up = 180°, down = 90°, back = 0°.
     * Confirmed 2026-09-15: up (180°) is the RAISED pose, and that is what test_mcp_high_five.ts's
     * high five offers with. ⚠️ README.md 9.5 describes the same wire range in other words
     * (0 = pointing forward, 90 = down, 180 = back) — two sets of names for the same numbers,
     * so do not read one back onto the other.
     */
    export enum HandPose {
        //% block="up"
        Up = 180,
        //% block="down"
        Down = 90,
        //% block="back"
        Back = 0,
    }

    /**
     * Move the LEFT hand only; the right hand stays where it is. arm_set leaves a hand alone
     * by omitting its key, and -1 is how this side says "not this one" — 0 is a real angle,
     * so it cannot mean "don't move".
     */
    //% blockId=r300_hands_left block="move left hand %pose"
    //% weight=100
    export function leftHand(pose: HandPose): void {
        // a1 = right hand, so the hand this block means is a2.
        r300.arm(-1, pose)
    }

    /**
     * Move the RIGHT hand only. The mirror of leftHand().
     */
    //% blockId=r300_hands_right block="move right hand %pose"
    //% weight=90
    export function rightHand(pose: HandPose): void {
        r300.arm(pose, -1)
    }

    /**
     * Move both hands together. They end up at the same angle — mirroring is R300's job, so
     * "both up" looks symmetric on the robot.
     */
    //% blockId=r300_hands_both block="move both hands %pose"
    //% weight=80
    export function bothHands(pose: HandPose): void {
        r300.arm(pose, pose)
    }

    /**
     * Raw angles for the two hands at once, for when the three dropdown blocks cannot say what
     * you mean (an asymmetric pose, say): a1 = RIGHT hand, a2 = LEFT hand, physical degrees
     * 0..180 (0 = pointing forward, 90 = down, 180 = back). Pass -1 for a hand to leave it
     * alone — the key is then left out of the request, because 0 is a real angle and cannot
     * mean "don't move".
     */
    //% blockId=r300_hands_move block="move hands to %a1 and %a2 degrees"
    //% a1.min=-1 a1.max=180 a1.defl=90
    //% a2.min=-1 a2.max=180 a2.defl=90
    //% weight=10
    //% group="More"
    export function moveHands(a1: number, a2: number): void {
        // -1 (leave the hand alone) is the floor, so clamping can never turn "skip" into a move.
        a1 = r300.clamp(Math.round(a1), -1, 180)
        a2 = r300.clamp(Math.round(a2), -1, 180)
        r300.arm(a1, a2)
    }
}

//% color="#E67E22" icon="\uf118" weight=93 block="R300 Emotion"
namespace r300_emotion {
    /**
     * Show a face on R300's monitor (the eyes). The face stays until something else
     * changes it.
     */
    //% blockId=r300_emotion_show block="show face %e"
    //% weight=100
    export function showFace(e: r300.Emoji): void {
        r300.emoji(e)
    }
}

//% color="#E67E22" icon="\uf028" weight=92 block="R300 Speaker"
namespace r300_speaker {
    /**
     * Set the speaker volume, 0..100.
     */
    //% blockId=r300_speaker_volume block="set speaker volume to %v"
    //% v.min=0 v.max=100 v.defl=50
    //% weight=100
    export function setVolume(v: number): void {
        v = r300.clamp(Math.round(v), 0, 100)
        r300.volume(v)
    }

    /**
     * Turn the volume up (positive) or down (negative) by `v`, from whatever R300 last
     * confirmed. set / change / read is the same trio Music offers for tempo, and it is what
     * makes "set" and "change" teachable against something the student can HEAR.
     */
    //% blockId=r300_speaker_change block="change speaker volume by %v"
    //% v.min=-100 v.max=100 v.defl=10
    //% weight=90
    export function changeVolumeBy(v: number): void {
        // Round and clamp the step first, then let setVolume clamp the total — the order every
        // other wrapper here uses, so a computed value meets the same bounds a typed one does.
        // Clamping the TOTAL is what keeps a change at the ceiling from being refused: R300
        // answers badarg for an out-of-range volume rather than clamping it, and a change block
        // that silently did nothing there would look broken.
        v = r300.clamp(Math.round(v), -100, 100)
        setVolume(speakerVolumeNow() + v)
    }

    /**
     * The volume R300 last CONFIRMED it applied, 0..100 — not the level that was asked for.
     * Until one has been confirmed this reads 50, the same default the set block offers: R300
     * never reports the level it booted with, so there is no truer number to read before the
     * first set.
     */
    //% blockId=r300_speaker_volume_now block="speaker volume"
    //% weight=80
    export function volume(): number {
        return speakerVolumeNow()
    }

    // The level to change FROM, and the one the read block reports. lastVolume is what R300
    // confirmed it APPLIED (protocol.ts tracks it from vol_done); -1 means it never confirmed
    // one, which is the only case where the set block's default is the best answer available.
    function speakerVolumeNow(): number {
        return r300.lastVolume >= 0 ? r300.lastVolume : 50
    }
}

//% color="#E67E22" icon="\uf130" weight=90 block="R300 Talk Over"
namespace r300_talkover {
    /**
     * Let the user interrupt R300 by talking while it is speaking: it stops the reply and
     * listens to them instead. Until this runs, only R300's own wake word can interrupt it.
     * The mode is absolute (there is deliberately no toggle block, so a replay cannot invert
     * it) and it does not survive a reboot — put this in "on start" to apply it to every run.
     * R300 accepts it only while idle, and this block, like every action block, does not show
     * a refusal: if it was pressed mid-reply, simply press it again once the reply finishes.
     */
    //% blockId=r300_talkover_allow block="allow talking over R300's reply"
    //% weight=100
    export function allowTalkingOver(): void {
        r300.aec(true)
    }

    /**
     * Stop letting the user talk over R300: only its wake word ends a reply. The mirror of
     * allowTalkingOver(), and the state a freshly booted R300 starts in.
     */
    //% blockId=r300_talkover_stop block="don't allow talking over R300's reply"
    //% weight=90
    export function stopTalkingOver(): void {
        r300.aec(false)
    }
}

// One category for everything that talks to the robot's AI. The conversation pair comes first
// (that is where a lesson starts) and the recording flow follows it; they were two namespaces —
// and so two toolbox drawers with confusingly similar names — until they were merged here.
//% color="#E67E22" icon="\uf0d0" weight=91 block="R300 AI"
namespace r300_ai {
    /**
     * Start a conversation with the AI — the same thing one press of the robot's boot button
     * does, without touching the robot. The connection opens and the robot starts listening.
     * The state is absolute (there is deliberately no toggle block, so a replay cannot invert
     * it): running this while R300 is already connecting, listening or speaking is accepted and
     * changes nothing.
     * "ok" only means R300 accepted the request, and it can refuse — R300 will not take this
     * during start-up, activation, WiFi setup, the audio test or limited charging. A refusal is
     * not shown here: if nothing happened, press it again once R300 has settled.
     */
    //% blockId=r300_ai_start block="start an AI conversation"
    //% weight=100
    export function startConversation(): void {
        r300.ai(true)
    }

    /**
     * End the conversation with the AI. The mirror of startConversation() — the connection
     * closes, and it is accepted even if no conversation was open.
     *
     * ⚠️ R300 will NOT cut off its own reply. Asking for this while the robot is SPEAKING is
     * refused and the reply plays to the end, so press it again once the robot has finished
     * talking. A connection that is still being made cannot be cancelled either.
     */
    //% blockId=r300_ai_stop block="end the AI conversation"
    //% weight=90
    export function stopConversation(): void {
        r300.ai(false)
    }


    // The description is what the voice AI reads to decide when to call the tool, and it is
    // the one field a student types that can run past what one protocol line carries
    // (README.md 9.7 chunks it at 34 characters a call). 32 keeps a chunk under that
    // AND keeps the text short enough to be useful as a tool description. A longer one is
    // REFUSED, never truncated: a quiet fix-up would look like it worked while the AI only
    // got half a clue. The block text says "(max 32 chars)" — keep the two in step.
    const DESC_MAX = 32

    // Every recording is published under this ONE name, so there is no naming rule for a
    // student to get wrong (1-16 characters of a-z, 0-9, _) and R300's 8-slot tool table never
    // fills up with the same routine recorded again. Re-recording replaces what the AI can
    // call, rather than adding another tool beside it.
    const TOOL_NAME = "mcp_microbit_1"

    // Local refusals show the limit that blocked them on the LED. Nothing was sent, so there is
    // no ack and nothing in R300's log to find — which is exactly why the status side is told
    // here instead: what a status block reads has to cover the refusals this side makes on its
    // own, not only the ones R300 sends back.
    function refuse(limit: number): void {
        r300.setLastReply("long")
        basic.showNumber(limit)
        basic.pause(1000)
        basic.clearScreen()
    }

    /**
     * Say what the routine about to be recorded does. Call it BEFORE startRecording().
     * The routine is always published as "mcp_microbit_1" — the name is fixed, not a choice a
     * student makes. Calling this again appends to the description, which is how a description
     * longer than one line gets sent.
     * Keep the description to 32 characters or fewer — a longer one is refused and shows
     * 32 on the LED (nothing is sent to R300).
     */
    //% blockId=r300_mcp_name block="describe this routine as %desc (max 32 chars)"
    //% weight=80
    export function nameRecording(desc: string): void {
        if (desc.length > DESC_MAX) {
            refuse(DESC_MAX)
            return
        }
        r300.describe(TOOL_NAME, desc)
    }

    /**
     * Start recording: every move R300 accepts from here on is captured, and the moves
     * still happen live while you perform them.
     */
    //% blockId=r300_mcp_start block="start recording moves"
    //% weight=70
    export function startRecording(): void {
        r300.takeStart()
    }

    /**
     * Stop recording and publish it as a tool the voice AI can call by name.
     */
    //% blockId=r300_mcp_finish block="finish recording as an AI tool"
    //% weight=60
    export function finishRecording(): void {
        r300.takeFinish()
    }

    /**
     * How many moves the last finished routine actually captured — 0 until a take has been
     * published.
     *
     * R300 keeps at most 64 moves. A routine that ran longer still performed every move but
     * only recorded the first 64, so read this after finishRecording() when it matters.
     */
    //% blockId=r300_mcp_steps block="moves recorded"
    //% weight=50
    export function movesRecorded(): number {
        // -1 is protocol.ts's "no take has ever been reported", which is not a number a student
        // can do anything with. 0 is the truthful reading: nothing recorded yet.
        return r300.lastTakeSteps >= 0 ? r300.lastTakeSteps : 0
    }

    /**
     * Did the last recording throw moves away? True when the routine ran past R300's 64-move
     * ceiling: those moves still happened, they were just not captured, so the AI tool replays
     * less than the student performed. This is the only place a truncated take shows up on this
     * side of the link.
     *
     * False before any take, and false for a routine that fits — "short enough" and "too long"
     * are the two cases that matter, and only the second one is a problem.
     */
    //% blockId=r300_mcp_cut block="routine was cut short?"
    //% weight=40
    export function recordingWasCutShort(): boolean {
        return r300.lastTakeDrop > 0
    }
}

//% color="#E67E22" icon="\uf059" weight=89 block="R300 Status"
namespace r300_status {
    /**
     * Is the link up? True from the moment R300 has handshaked with this micro:bit and answered
     * a live check in THIS session — so it reads false for R300's first ten seconds after power
     * up, and false again if R300 reboots while the program is running.
     *
     * This is the block a lesson puts in a while loop to wait for the robot, and the first thing
     * to check before blaming a program for doing nothing.
     */
    //% blockId=r300_status_connected block="R300 is connected"
    //% weight=100
    export function isConnected(): boolean {
        // liveCount is reset by every new session (an R300 restart, or a hello arriving after
        // the live check gave up), so > 0 answers "up in THIS session" rather than "has been up
        // at some point", which a running total could never answer once a restart has happened.
        return r300.liveCount > 0
    }

    /**
     * Did R300 accept the last command? False when it refused the request, when nothing answered
     * in time, and when a block refused the input itself — a description past 32 characters
     * never leaves the micro:bit at all.
     *
     * "Accepted" is the strongest promise the link makes: R300 has the request, not that a move
     * has finished. Every action block returns void on purpose, so a refusal is silent
     * everywhere else; this is the block that makes it visible where a program wants to look.
     */
    //% blockId=r300_status_accepted block="the last command was accepted"
    //% weight=90
    export function accepted(): boolean {
        return r300.lastReply == "ok"
    }
}

//% color="#E67E22" icon="\uf001" weight=88 block="R300 Music"
namespace r300_music {
    /**
     * The robot's three songs, in the order its own list holds them.
     *
     * The values ARE the wire numbers, and they are written out explicitly so that reordering
     * this list only moves the entries in the dropdown — the names stay attached to their numbers.
     * That is the same end r300.Emoji reaches with a switch (see emojiName): a name lookup indexed
     * by position is what silently sends the wrong one the first time somebody reorders a list.
     *
     * ⚠️ The order itself is the ROBOT's, not ours. Two songs swapping places on the robot makes
     * every saved program play the other one, and nothing anywhere would report it.
     */
    export enum Song {
        //% block="ActiveSummer"
        ActiveSummer = 0,
        //% block="CosmicFluff"
        CosmicFluff = 1,
        //% block="Fever"
        Fever = 2,
    }

    /**
     * Play one of R300's three songs by name.
     *
     * ⚠️ MUSIC ONLY: R300 does not drive its own wheels or hands while a song plays, so this is
     * not a routine — move the robot yourself with the movement and hand blocks and the two run
     * together. That is the whole point of the block.
     *
     * ⚠️ Nothing reports that the song ended, and there is no block to ask. A song plays to the
     * end unless something interrupts it, so chaining two means timing the gap yourself, and a
     * song cut short (the boot button, R300's own stop_dance, the model starting a dance) is
     * silent. ⚠️ While the music plays R300 mutes its own mic, so the robot cannot hear anyone —
     * including its wake word — until the song is over.
     *
     * There is no answer to read here either. R300 can refuse this (a song is already playing —
     * it never replaces one — or the robot is busy with start-up, WiFi setup or charging), and
     * that refusal has nowhere to appear in a void block. If no music starts, let the robot settle
     * and press it again.
     */
    //% blockId=r300_music_play block="play song %song"
    //% weight=100
    export function playSong(song: Song): void {
        r300.song(song)
    }
}

//% color="#E67E22" icon="\uf030" weight=87 block="R300 Camera"
namespace r300_camera {
    /**
     * Take a photo and send it to R300's vision model with a question. Type the question in the
     * block, or leave the field alone to let R300 ask its own ("What do you see?").
     *
     * ⚠️ The robot has to be in a conversation with its AI first — press its boot button, or use
     * "start an AI conversation". Without one, this block still reports success and simply does
     * nothing: R300 mentions it only in its own log, so a program cannot tell.
     *
     * ⚠️ Nothing comes back to your program — not the answer, not even a note that the photo was
     * taken. R300 says the answer out loud and keeps it to itself. Expect it to take about nine
     * seconds, and note that anything you do to the robot's face or music while it works waits
     * its turn; the wheels and hands do not wait.
     */
    //% blockId=r300_camera_ask block="take a photo and ask %q"
    //% weight=100
    //% q.defl="What do you see?"
    export function takePhoto(q: string): void {
        r300.cam(q)
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

