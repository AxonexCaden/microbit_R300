// Local test only (testFiles): never shipped into a student's project.
r300.connect()

// Nothing moves on boot on purpose — this is a robot. Press a button instead, and the LED
// matrix shows what R300 answered ("ok" = it accepted the request, not that it has moved).

// A: one second forward at half speed.
input.onButtonPressed(Button.A, function () {
    basic.showString(r300.motor(0, 50, 1000))
})

// A+B: stop. NOT motor(0, 0, 0) — that one refuses with "busy" while the move above is still
// waiting for its ack, and refuses silently, so the wheels keep turning. r300.stopNow() is
// allowed to interrupt the request in flight, which is what a stop button has to do.
input.onButtonPressed(Button.AB, function () {
    basic.showString(r300.stopNow())
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

// ---------------------------------------------------------------------------
// B HELD (~1s): protocol sweep — one request per second.
//
// Nothing on this side can see the wire, so the real record of this test is R300's console:
// every request, every ack, and the reason for every refusal land there in order. The matrix
// only says pass / fail per step, so the robot can be checked without a cable.
//
// On a HELD B rather than a gesture of its own, because A, A+B, P2 and both logo events are
// taken, and because a held button cannot fire by accident the way a shake or a tilt can.
// ---------------------------------------------------------------------------
const kSweepGapMs = 1000
let sweepFails = 0
let sweepAbort = false
let sweepRunning = false

// want is what R300 must answer; run performs the request only when the sweep is still live.
// Passing the request as a function rather than its result is what lets A+B abort: a step that
// has been called off must not put its request on the wire at all.
function sweepStep(want: string, run: () => string): void {
    if (sweepAbort) return
    const got = run()
    // A+B set "abandoned" while the request above was in flight. An operator asking for a stop
    // means stop, not "stop until the next step" — so latch it here, where the cause is known,
    // and every remaining step skips its request.
    if (got == "stopped") sweepAbort = true
    if (got == want) {
        basic.showIcon(IconNames.Yes)
    } else {
        sweepFails++
        // Show the answer R300 actually gave — a wrong one exists nowhere else on this side.
        basic.showString(got)
    }
    // The gap is between REQUESTS, so a failing step runs slightly long because its answer
    // needs showing. A pass costs nothing.
    basic.pause(kSweepGapMs)
}

function protocolSweep(driveWheels: boolean): void {
    // Each MakeCode event handler runs in its own fibre, so a B TAP during the sweep would
    // otherwise start a second sweep alongside this one: the two loops would share sweepFails
    // and the second would reset the first's counters mid-run. A tap is meant to move a hand;
    // it must not turn into a second test.
    if (sweepRunning) return
    sweepRunning = true
    sweepFails = 0
    sweepAbort = false
    basic.showIcon(IconNames.Target)

    // 1-6: the three ops a student uses, plus emo_set, each one ACCEPTED.
    sweepStep("ok", () => r300.arm(90, 90))               // 1 both hands down
    // 2 is the ONLY step that puts power to the wheels. Auto mode sends a stop here instead:
    // R300 reboots on every monitor attach and re-handshakes on any live loss, and each of those
    // opens a new session that re-arms this sweep — so the automatic case must not move the
    // robot. The op, its ack and the motor-board UART are all still exercised; only the
    // direction is not, and the real forward move is covered by the held-B sweep.
    sweepStep("ok", () => driveWheels ? r300.motor(0, 30, 800) : r300.motor(0, 0, 0))  // 2
    sweepStep("ok", () => r300.motor(0, 0, 0))            // 3 stop
    sweepStep("ok", () => r300.volume(50))                // 4 also runs R300's vol_done round trip
    sweepStep("ok", () => r300.emoji(r300.Emoji.Happy))   // 5 face on the monitor
    sweepStep("ok", () => r300.arm(0, 0))                 // 6 hands forward

    // 7-10: the ends of each range that are still legal.
    sweepStep("ok", () => r300.volume(0))                 // 7
    sweepStep("ok", () => r300.volume(100))               // 8
    sweepStep("ok", () => r300.send("arm_set", "{\"a1\":180}"))                    // 9 backward limit
    sweepStep("ok", () => r300.send("leg_set", "{\"ro\":0,\"fd\":0,\"ms\":3000}"))  // 10 a stop

    // 11-18: out of range must be REFUSED, never clamped — a silent clamp moves the robot
    // somewhere nobody asked for. These go through send() instead of the student-facing
    // wrappers, because the wrappers turn some illegal values into legal ones before the wire
    // sees them: arm() reads ANY negative hand as "leave it alone", so arm(-1, -1) would send
    // an empty p and answer badarg for the wrong reason.
    sweepStep("badarg", () => r300.volume(101))                                       // 11
    sweepStep("badarg", () => r300.send("vol_set", "{\"vl\":-1}"))                   // 12
    sweepStep("badarg", () => r300.send("arm_set", "{\"a1\":181}"))                   // 13
    sweepStep("badarg", () => r300.send("arm_set", "{\"a1\":-1}"))                    // 14 a negative angle
    sweepStep("badarg", () => r300.send("leg_set", "{\"ro\":101,\"fd\":0,\"ms\":1000}"))  // 15
    sweepStep("badarg", () => r300.send("leg_set", "{\"ro\":0,\"fd\":50,\"ms\":0}"))      // 16 needs a time
    sweepStep("badarg", () => r300.send("arm_set", "{}"))                             // 17 no hand named
    sweepStep("badarg", () => r300.send("leg_set", "{\"ro\":0,\"fd\":0}"))          // 18 ms is required

    // 19: an op nobody registered must SAY so rather than go silent, so the sender gets an
    // answer instead of burning three 500ms retries on a typo.
    sweepStep("noop", () => r300.send("bogus_op", "{}"))                              // 19

    // 20: a detect_done raised BY the robot. This is the one step that sends nothing: nothing else
    // in this file can reach that path, because it is R300's own request and a bench has no real
    // one unless the program armed a look (test_all.ts does, but it cannot inspect the bytes). The
    // line is fed straight into the receiver, and the reply is compared against the line this side
    // would build for the same ack — that comparison is the whole point, since R300 takes the ack
    // and drops a malformed one without a word. The verdict landing in the latch is the other half:
    // answering correctly is no use if the answer itself is thrown away, which is what happened
    // while this branch was missing (the request fell through to noop).
    sweepStep(r300.buildLine("a", 20, "detect_done", "{\"st\":\"ok\"}"), () => {
        const before = r300.detectSeq
        const reply = r300.handleLine("{\"s\":\"r300\",\"id\":20,\"t\":\"r\",\"op\":\"detect_done\"," +
            "\"p\":{\"tg\":\"apple\",\"rs\":\"y\"},\"ck\":55}")
        // sweepStep compares one string, so a failure reports the latch instead of the reply: that
        // value is the one worth seeing and can never be mistaken for something R300 said.
        if (r300.detectSeq != before + 1) return "seq+" + (r300.detectSeq - before)
        if (r300.lastDetectTarget != "apple") return "tg=" + r300.lastDetectTarget
        if (r300.lastDetectAnswer != "y") return "rs=" + r300.lastDetectAnswer
        return reply
    })                                                                                // 20

    // The verdict. An aborted sweep is not a pass whatever the count says: an operator stopped
    // it, so nothing after the stop was tested.
    basic.showIcon(sweepFails == 0 && !sweepAbort ? IconNames.Yes : IconNames.No)
    basic.pause(400)
    basic.showNumber(sweepFails)
    sweepRunning = false
}

// ---------------------------------------------------------------------------
// RECORD A ROUTINE AND PUBLISH IT AS AN MCP TOOL.
//
// This is the one action whose result is invisible until you TALK to the robot, so it runs
// first in the automatic bring-up below; a logo long-press calls the same function.
//
// The moves are performed BY THIS PROGRAM, not by the operator, and that is what makes the
// test decidable. It used to be ten seconds of waiting for someone to press A / B, and an
// empty recording (0 steps) then looks identical whether the recorder is broken or nobody
// moved anything in time. A scripted routine has the same step count every run, so
// lastTakeSteps becomes a number to compare against rather than a shrug.
const kRecordScripted = true      // false = the old 10s operator window
const kRecordWindowMs = 10000
const kHandsForward = 0           // README.md 9.5: 0 = forward, 90 = down, 180 = backward
const kHandsDown = 90
// 1-16 chars of a-z, 0-9, _ ONLY — it becomes part of the AI's tool name (self.microbit.<name>),
// so no spaces and no capitals. The description is capped at 34 chars PER CALL; calling
// describe() again with the SAME name appends instead of replacing.
//
// 🔴 The name is a TRIGGER, not a label, and it has to survive the other tools. self.arm.pose's
// description lays explicit claim to "hello", "goodbye", "wave", "point" and "hands up" — so a
// routine called "wave", describing itself as "waves hello", lost every one of those words to
// that tool: it was never called ONCE, while the arm still moved, via self.arm.pose. "high_five"
// appears in no other tool's description.
const kToolName = "high_five"
const kToolDesc = "high-fives the user on request"

// True while a take is in flight. R300 accepts only ONE take at a time and a take runs for
// seconds, so a logo press landing during the automatic bring-up would arm a second take on top
// of the first — two recordings sharing one step buffer, which is not a state either side
// defines. Refusing is the honest answer; the caller decides whether to show it.
let recordBusy = false

// Returns false without doing anything if a take is already running. See kToolName above for the
// naming rules, and kAutoBringUp below for why this runs without anyone pressing a button.
function recordHighFive(): boolean {
    if (recordBusy) return false
    recordBusy = true
    // 1. Name it and say what it does. R300 needs a name staged before it will start a take.
    basic.showString(r300.describe(kToolName, kToolDesc))
    basic.pause(300)
    // 2. Arm the recorder. Moves R300 accepts from here on are captured AND still happen live.
    basic.showString(r300.takeStart())
    // 3. Perform the routine.
    if (kRecordScripted) {
        performHighFive()
    } else {
        // The manual path, and the ONLY one that can record a leg-only routine — which is what
        // the arm-tap scope check needs proving with, since a take that never touches a hand has
        // to replay without moving one. A and B keep working here: every MakeCode event handler
        // runs in its own fibre and this one is parked in basic.pause().
        basic.pause(kRecordWindowMs)
    }
    // 4. Commit it. R300 registers a tool called self.microbit.wave that the voice AI can call.
    const committed = r300.takeFinish()
    basic.showString(committed)
    // 5. What R300 actually committed: moves captured, then moves THROWN AWAY.
    //    The second number is the number that matters — anything above 0 means the routine ran
    //    past R300's 64-step ceiling and is incomplete, and nothing else on this side says so.
    //
    //    ⚠️ Shown ONLY when this take actually committed. lastTakeSteps is never reset (it starts
    //    at -1 and is written once per mcp_done), so on a failed take the two numbers below would
    //    be the PREVIOUS take's — and a stale 4 / 0 reads exactly like a fresh success, which is
    //    the one way this test could report a pass while nothing was recorded at all.
    if (committed == "ok") {
        // mcp_done is raised by R300's own notifier as a SEPARATE request, so it lands after the
        // ack above. No polling is involved — Post() wakes that thread — so this is margin, not
        // a measured wait.
        basic.pause(500)
        basic.showNumber(r300.lastTakeSteps)
        basic.pause(1000)
        basic.showNumber(r300.lastTakeDrop)
    } else {
        basic.showIcon(IconNames.No)
    }
    recordBusy = false
    return committed == "ok"
}

// false = every leg_set in this file is a STOP. R300 reboots every time a monitor attaches and
// the bring-up below re-fires on each new session, so driving here would move the robot
// unprompted, over and over. Flip to true only with the robot on the floor and someone watching.
const kDriveWheels = false

// Long enough to SEE each beat. This is pacing for the audience, NOT for the recorder: a step's
// dwell is fixed when it is captured (250ms for an arm line, the move's own ms for a leg line),
// so nothing here changes how fast the routine replays.
const kBeatMs = 700

// The demo sequence: one of each op R300 accepts, in the order it is worth watching.
//
// 🔴 Only the ARM and LEG lines are recorded. emo_set and vol_set have no tap — there is no
// ActionSink on MicrobitEmojiCommands or MicrobitSpeakerCommands, and Step carries one motor-bus
// line with no bus field — so a take containing them replays WITHOUT them. They are in the
// sequence anyway because the demo wants all four visible, and because they are the only exercise
// two otherwise-untouched op paths ever get. Expect the take to report 5 steps, not 7.
//
// Shared by the recording and by every later session on purpose. Two copies of this sequence
// would drift apart, and the copy that drifts unnoticed is the one that actually runs.
function performHighFive(): void {
    r300.arm(kHandsForward, kHandsForward)   // arms up — the offer  (recorded)
    basic.pause(kBeatMs)
    r300.arm(kHandsDown, kHandsDown)         // arms down — the five (recorded)
    basic.pause(kBeatMs)
    // leg_set. Recorded either way: the sink fires for a stop too, so the step is in the take
    // even when the wheels are not driven.
    if (kDriveWheels) {
        r300.motor(0, 30, 800)
    } else {
        r300.motor(0, 0, 0)
    }
    basic.pause(kBeatMs)
    r300.emoji(r300.Emoji.Cool)              // emo_set — NOT recorded
    basic.pause(kBeatMs)
    r300.volume(80)                          // vol_set + R300's vol_done round trip — NOT recorded
    basic.pause(kBeatMs)
}

// ---------------------------------------------------------------------------
// AUTO BRING-UP: once the link is really up, touch every op once — and publish the tool on the
// first session only.
//
// MCP FIRST. Every other op's result is visible on the robot the moment it is sent; the tool
// is the only one you cannot see until you speak to it, so it is the one worth having in the
// log first thing.
//
// The trigger is the first `live` cycle, not `hello`. R300 does not start its live check
// until it has seen our hello ack (README.md 8), so a live cycle is the earliest proof
// that the handshake COMPLETED rather than merely started — and it is the only trigger
// that still works when the micro:bit is flashed while R300 keeps running, because R300
// finished its hello phase long ago and will never send another one.
//
// Why automatic: the first version needed a held B, and the bench run produced a log with
// 60 flawless live cycles and not one command. Nothing was wrong with the button — R300
// simply was not running when it was pressed, so the request had nowhere to go and the log
// could not show it. Waiting for the link removes the operator from that loop.
//
// ⚠️ R300 resets every time a monitor is attached, and re-handshakes whenever its live check
// loses the micro:bit — and each of those opens a new session, so the loop below re-arms on
// every one of them. That is what performHighFive() wants. It is NOT what the recording wants:
// the tool is meant to belong to the take that created it, never to outlive it. See autoPublished.
// Nothing here drives a wheel — see kDriveWheels. Hold B for the full 19-step sweep when you want
// the per-op record instead.
// ---------------------------------------------------------------------------
const kAutoBringUp = true
const kLiveToSweepMs = 1000
const kCountdownMs = 3000

// One bring-up per SESSION, not one per power-on. performHighFive() costs nothing to repeat, and
// a micro:bit that ran it once would sit through every later R300 restart doing nothing — which
// is exactly how a real regression goes unnoticed. sessionEpoch ticks whenever R300 opens a new
// handshake, so this loops each time the other end comes back, including when R300 reboots while
// this micro:bit keeps running.
//
// 🔴 The recorded tool is the ONE thing here that must NOT be repeated. R300 keeps a take in
// PSRAM and never writes it to NVS, so an R300 restart really does drop the tool — and
// re-publishing on every new session would quietly undo exactly that: the tool would become
// permanent-in-practice and the hands would move on every monitor attach. The tool belongs to
// its recording, so the automatic path publishes ONCE per micro:bit power-on and then leaves it
// alone. After an R300 restart the only way back is a deliberate logo long-press.
let autoPublished = false
if (kAutoBringUp) {
    let sweptEpoch = -1
    control.inBackground(function () {
        while (true) {
            // liveCount is per-session, so this asks "is the link up in THIS session" — a
            // condition that has to be re-established after a restart, never remembered.
            while (r300.liveCount == 0 || r300.sessionEpoch == sweptEpoch) basic.pause(50)
            sweptEpoch = r300.sessionEpoch
            basic.pause(kLiveToSweepMs)
            // Shown so "which session is this" is answerable without a cable: the matrix is the
            // only evidence this firmware has that the bring-up re-armed rather than merely ran.
            basic.showNumber(r300.sessionEpoch)
            basic.pause(500)
            // The countdown is the only warning before the hands move, and that only happens on
            // the first session; later ones just show it. Nothing on this side can recall a take
            // once it has been armed, so a warning that is sometimes unnecessary is the right
            // trade — an unnecessary one is free, a missing one is not.
            for (let n = 3; n > 0; n--) {
                basic.showNumber(n)
                basic.pause(kCountdownMs / 3)
            }
            // ⚠️ Once per power-on, NOT once per session — see autoPublished. A micro:bit that
            // re-published here would be re-creating the tool on every R300 restart, which is the
            // persistence this is deliberately avoiding.
            if (!autoPublished) {
                autoPublished = true
                recordHighFive()
            } else {
                // Later sessions still PERFORM the routine; only the PUBLISHING is one-shot.
                // Without this the bring-up would go silent after the first R300 restart, and a
                // dead link would then look exactly like a link with nothing to say.
                performHighFive()
            }
        }
    })
}

// B tapped: move ONE hand, so this press answers "which hand is a1?".
// B HELD for a second: run the protocol sweep above instead.
// Deliberately asymmetric: arm(90, 90) moves both hands to the same angle and therefore proves
// only that both hands work — it cannot tell a1 from a2, which is the open question
// (the 1=right / 2=left mapping is still an assumption, README.md 9.5).
// -1 means "leave that hand alone"; 0 would be a real angle (pointing forward).
const kSweepHoldMs = 1000
input.onButtonPressed(Button.B, function () {
    // onButtonPressed fires on the way DOWN, and micro:bit MakeCode has no long-press event for
    // A/B (only the V2 logo does), so a held press has to be waited out here before there is
    // anything to tell the two cases apart.
    const pressedAt = control.millis()
    while (input.buttonIsPressed(Button.B)) basic.pause(20)
    if (control.millis() - pressedAt >= kSweepHoldMs) {
        protocolSweep(true)   // held B: the full sweep, wheels included
        return
    }
    basic.showString(r300.arm(90, -1))   // whichever hand drops is a1
    basic.pause(1500)
    basic.showString(r300.arm(0, -1))    // and back
})

// Logo LONG press: publish the routine as a tool, on demand.
//
// On a long press rather than another button because A / B / A+B / P2 are all taken. Note that
// the logo's short-press face test above still fires on the way in, so the face advances by one
// each time you record — cosmetic, and the alternative was inventing a new gesture that would
// then fire during normal handling.
//
// A thin wrapper over recordHighFive(), which the automatic bring-up also calls — the recording
// itself is documented at that function. Worth keeping as a manual trigger because it is the
// only way to re-publish WITHOUT waiting for an R300 restart, and because it keeps the whole
// flow reachable by hand when kAutoBringUp is switched off.
input.onLogoEvent(TouchButtonEvent.LongPressed, function () {
    // A press landing mid-take is refused rather than queued, and the icon is what keeps that
    // from looking like a dead button.
    if (!recordHighFive()) basic.showIcon(IconNames.Confused)
})
