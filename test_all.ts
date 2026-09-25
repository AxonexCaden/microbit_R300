// test_all.ts — bench sweep over EVERY block the R300 extension publishes (29 of them, 46 steps).
//
// Copy this whole file into a MakeCode micro:bit project that has the R300 extension added and
// switch to the Blocks view: every call below is one of the blocks a student can drag out, so
// what this file proves is the BLOCK surface. test.ts covers the other half — the internal
// r300.* API and the wire protocol — and is the place to look when a step here fails and you
// want to see the answer R300 actually gave.
//
// To run it: put it in pxt.json's `testFiles` (replacing test.ts — the two together do not fit
// in one program) and `pxt build`. It must NEVER go in `files`: that list is what ships, and a
// bench test living there would sweep the robot on every student power-up.
//
// When it runs: by itself, on start, but only after the handshake — and exactly ONCE per
// power-up. R300 ignores the link for about ten seconds after it powers up, and everything below
// the gate needs a live link. To run it again, press the micro:bit's reset button.
//
// How it reports — on the LED matrix, never through serial. While the link is up, serial is
// redirected to R300 on P0/P1, so anything written there goes to the robot, not to a terminal.
//   · each step shows its own number as it runs, so a step that hangs names itself
//   · a failing step shows a cross and holds the screen, so the number is easy to write down
//   · the end: tick = clean; otherwise the failure count, then each failing step number,
//     blanked between them so two numbers cannot be read as one longer number
//   · A+B at any moment: stop the wheels — this test drives a real robot
//
// SIDE EFFECTS: the recording section leaves a routine on the robot, REPLACING whatever
// mcp_microbit_1 held before; the conversation steps open a conversation with the AI and then
// try to close it again; the camera steps send a real photo to the robot's vision model and it
// answers OUT LOUD, which takes about nine seconds; the look step leaves the robot armed for up
// to thirty seconds if the model never runs the detection; talk-over is left ENABLED (step 27
// has the last word on it); the music step leaves a song playing, which mutes the robot's own mic
// until it ends; and the robot is left stopped, at volume 50, face happy.
//
// Not part of a student's project: it only ever lives in pxt.json's testFiles. Do not hold A
// while resetting to run it — that is the USB-serial escape hatch, it skips the serial redirect,
// and the link is then never up, so step 1 can only fail.
//
// Step map (the number on the matrix is the check):
//    1  R300 is connected                 gate — a failure here ends the run
//    2  the last command was accepted     false before anything has been sent
//    3  speaker volume                    reads a real level
//    4  moves recorded                    reads 0..64, not the "never recorded" placeholder
//    5  routine was cut short?            false before any take
//    6  move forward for 1 seconds
//    7  move backward for 1 seconds
//    8  move left
//    9  move right
//   10  stop driving now
//   11  drive rot 50 fwd 80 for 1000 ms   the raw block, and the only one that curves
//   12  stop from another fibre, mid-move  WATCH: it must stop early, not after two seconds
//   13  move left hand up
//   14  move right hand down
//   15  move both hands up
//   16  move hands to 45 and -1 degrees   -1 = leave the left hand where it is
//   17  show face happy
//   18  show face cool                    a second value, so a stuck dropdown shows up
//   19  set speaker volume to 30
//   20  speaker volume reads 30           the level R300 CONFIRMED, not the one we asked for
//   21  turn speaker volume up or down by 20
//   22  speaker volume reads 50
//   23  turn speaker volume up or down by 100  50 + 100 has to clamp to 100, not run past it
//   24  speaker volume reads 100
//   25  set speaker volume to 50          back to a sane level for the recording section
//   26  don't allow talking over          off first, so the pair is a full round trip
//   27  allow talking over                leaves talk-over ENABLED
//   28  describe this routine
//   29  start recording
//   30  move both hands up                recorded
//   31  move forward for 1 seconds        recorded
//   32  move both hands down              recorded
//   33  finish recording as an AI tool
//   34  moves recorded > 0                R300 reports the take in a SECOND message
//   35  routine was cut short?            three moves is nowhere near the 64-step ceiling
//   36  a 64-character description        refused locally — accepted? must go false
//   37  play song ActiveSummer            music only — the robot does not drive itself
//   38  end the AI conversation           deterministic from the closed state
//   39  start an AI conversation          leaves it OPEN; see the note at the step
//   40  take a photo and ask              needs the conversation 39 opened; the robot answers
//                                        out loud, and about nine seconds pass before step 41
//   41  R300 starts looking for apple     one named object, the same door the photo uses
//   42  R300 saw apple? for up to 1 s     the timeout path: false unless an answer beats it
//   43  R300 starts looking for nothing   refused HERE — accepted? must go false
//   44  a 15-byte object                  refused HERE too, on the byte cap — 14 shows on the LED
//   45  R300 saw that same 15-byte object  refused before the wait: false at once, not after 30 s
//   46  stop driving now                  park the robot

// ---------------------------------------------------------------------------
// Steps 6-46 each assert the one thing a bench can see for itself: that R300 took the request.
// That is what "the last command was accepted" means, and it is the block a lesson uses to put a
// robot fact inside an if. The refusals that can be produced on demand are 36, 43 and 44; the
// other way accepted? goes false — a second command landing while a request is still waiting for
// its ack — needs two handlers racing inside a 500 ms window and cannot be scripted.
// ---------------------------------------------------------------------------

let step = 0
let fails = 0
let running = false
// The sweep runs exactly ONCE per power-up: done is latched on entry and never cleared, so
// nothing can start a second pass over the same robot without a reset.
let done = false
// Every step number that failed, in order, so the summary can walk them back afterwards.
let failed: number[] = []
// Only the first pass after a reset sees a micro:bit that has never sent anything; see step 2.
let firstRun = true

// One step = one number on the matrix, and a failure that cannot be missed. A failed step does
// not stop the run: it says something about that block, not about the ones after it.
function check(pass: boolean): boolean {
    step++
    basic.showNumber(step, 50)
    if (!pass) {
        fails++
        failed.push(step)
        basic.showIcon(IconNames.No)
        basic.pause(1200)
    }
    return pass
}

// The gate. liveCount only leaves 0 once a live cycle has been answered IN THIS SESSION, and
// that — not the serial port being open — is what "connected" means to the rest of the library.
// R300 needs about ten seconds after a reboot before it will hear anything, so the timeout has
// to be generous; overshooting costs nothing, because the loop leaves as soon as it is up.
function waitForLink(timeoutMs: number): boolean {
    const deadline = control.millis() + timeoutMs
    while (!r300_status.isConnected() && control.millis() < deadline) {
        basic.showIcon(IconNames.Asleep)
        basic.pause(500)
    }
    return r300_status.isConnected()
}

// A volume lands in a SECOND message: R300 acks the request, then reports later that it actually
// applied the level (vol_done). "Accepted" and "applied" are two different moments, and only the
// second one moves the read block — so poll, rather than reading once after the ack.
function waitForVolume(want: number, timeoutMs: number): boolean {
    const deadline = control.millis() + timeoutMs
    while (r300_speaker.volume() != want && control.millis() < deadline) basic.pause(50)
    return r300_speaker.volume() == want
}

// Same shape, for the take: R300 reports the finished routine (mcp_done) once, a moment after
// the ack, and never retries that message.
function waitForSteps(timeoutMs: number): boolean {
    const deadline = control.millis() + timeoutMs
    while (r300_ai.movesRecorded() <= 0 && control.millis() < deadline) basic.pause(100)
    return r300_ai.movesRecorded() > 0
}

function sweep(): void {
    // Once per power-up, and never twice at the same time: a second pass would share the counters
    // and the matrix, and both runs would lie about which step failed.
    if (running || done) return
    running = true
    done = true
    step = 0
    fails = 0
    failed = []
    basic.showIcon(IconNames.Target)
    basic.pause(800)

    // 1 — the gate. Everything below needs a live link, so a failure here ends the run instead
    //     of producing 36 more failures that all mean the same thing.
    if (!check(waitForLink(30000))) {
        basic.clearScreen()
        basic.showIcon(IconNames.Sad)
        basic.pause(1500)
        basic.showNumber(1)                  // the number to write down: the link never came up
        running = false
        return
    }

    // 2 — r300.connect() only opens the port and installs the reader; it puts no request on the
    //     wire, so on a micro:bit that has just booted nothing has been accepted yet. A re-run
    //     cannot see that state, so there it only checks the block answers at all.
    check(firstRun ? !r300_status.accepted() : true)
    firstRun = false

    // 3,4,5 — the read blocks have to answer before anything has been asked of the robot.
    const volume0 = r300_speaker.volume()
    check(volume0 >= 0 && volume0 <= 100)                    // 3
    check(r300_ai.movesRecorded() >= 0 && r300_ai.movesRecorded() <= 64)   // 4
    check(!r300_ai.recordingWasCutShort())                   // 5

    // 6-11 — the six wheel blocks. Every action block waits out its own move before returning,
    //        so this list is also the order you see on the floor.
    r300_movement.moveForward(1)
    check(r300_status.accepted())                            // 6
    r300_movement.moveBackward(1)
    check(r300_status.accepted())                            // 7
    r300_movement.moveLeft()
    check(r300_status.accepted())                            // 8
    r300_movement.moveRight()
    check(r300_status.accepted())                            // 9
    r300_movement.stop()
    check(r300_status.accepted())                            // 10
    r300_movement.drive(50, 80, 1000)
    check(r300_status.accepted())                            // 11

    // 12 — a stop from ANOTHER fibre while a move is in flight. That is the whole reason stop()
    //      exists: drive(0, 0, 0) would come back "busy" without sending anything at all and the
    //      wheels would carry on. WATCH THE ROBOT — it has to stop a fraction of a second in.
    control.inBackground(function () {
        basic.pause(400)
        r300_movement.stop()
    })
    r300_movement.moveForward(2)
    check(r300_status.accepted())                            // 12

    // 13-16 — the four hand blocks. Watch the robot: 13 and 14 move ONE hand each, and 16's -1
    //         means "leave that hand alone", because 0 is a real angle.
    r300_hands.leftHand(r300_hands.HandPose.Up)
    check(r300_status.accepted())                            // 13
    r300_hands.rightHand(r300_hands.HandPose.Down)
    check(r300_status.accepted())                            // 14
    r300_hands.bothHands(r300_hands.HandPose.Up)
    check(r300_status.accepted())                            // 15
    r300_hands.moveHands(45, -1)
    check(r300_status.accepted())                            // 16

    // 17,18 — two different faces, so a dropdown that never changes is caught.
    r300_emotion.showFace(r300.Emoji.Happy)
    check(r300_status.accepted())                            // 17
    r300_emotion.showFace(r300.Emoji.Cool)
    check(r300_status.accepted())                            // 18

    // 19-25 — the speaker trio: set, turn up or down, read. Same shape as Music's set tempo /
    //         change tempo by / tempo, with the top of the range exercised so the clamp is
    //         proven rather than assumed. The "did it apply" steps poll, because the level is
    //         confirmed in a second message.
    r300_speaker.setVolume(30)
    check(r300_status.accepted())                            // 19
    check(waitForVolume(30, 3000))                           // 20
    r300_speaker.changeVolumeBy(20)
    check(r300_status.accepted())                            // 21
    check(waitForVolume(50, 3000))                           // 22
    r300_speaker.changeVolumeBy(100)                         // 50 + 100 is past the ceiling
    check(r300_status.accepted())                            // 23
    check(waitForVolume(100, 3000))                          // 24
    r300_speaker.setVolume(50)                               // 25
    check(r300_status.accepted())

    // 26,27 — the two absolute talk-over states, exercised OFF then ON: the pair is then a full
    //         round trip (both directions really change the mode) and it finishes with talk-over
    //         ENABLED, which is the state a lesson demo wants to leave behind.
    //         R300 refuses these with "badarg" whenever it is not idle — changing the mode
    //         closes the audio channel, which would cut off a reply being spoken — so a failure
    //         here usually means the robot was talking, not that the block is dead. Press it
    //         again once it is quiet before believing it.
    r300_ai.stopTalkingOver()
    check(r300_status.accepted())                            // 26 off
    r300_ai.allowTalkingOver()
    check(r300_status.accepted())                            // 27 on — and left on

    // 28-35 — the recording flow. This is the only part of the extension that leaves something
    //         behind on the robot, and it REPLACES the tool that was there before.
    r300_ai.nameRecording("bench sweep: hands and one step")
    check(r300_status.accepted())                            // 28
    r300_ai.startRecording()
    check(r300_status.accepted())                            // 29

    // The moves ARE the take, and they still happen live: you are watching the routine being
    // built. Only moves are captured — a face or a volume change has nowhere to go in a take.
    r300_hands.bothHands(r300_hands.HandPose.Up)
    check(r300_status.accepted())                            // 30
    r300_movement.moveForward(1)
    check(r300_status.accepted())                            // 31
    r300_hands.bothHands(r300_hands.HandPose.Down)
    check(r300_status.accepted())                            // 32

    r300_ai.finishRecording()
    check(r300_status.accepted())                            // 33
    check(waitForSteps(5000))                                // 34 the mcp_done, not the ack
    check(!r300_ai.recordingWasCutShort())                   // 35 three moves, ceiling is 64

    // 36 — a description past the 32-character limit is refused HERE, before anything is sent:
    //      the robot never hears about it, the matrix shows 32 (the limit that blocked it), and
    //      the accepted? block has to say no. Repeatable, unlike the busy case.
    r300_ai.nameRecording("this description is definitely longer than thirty-two characters")
    check(!r300_status.accepted())                           // 36

    // 37 — the song. ONE step, never a chain: a second song_set while one is playing is REFUSED
    //      (a song is never replaced), so a second call here would fail by design rather than
    //      prove anything about the block. It runs at this point because it is the last one where
    //      the robot is certainly idle with no conversation open — a song has no completion
    //      signal, so nothing can wait it out before the steps that follow. It is LEFT PLAYING,
    //      and the robot's mic stays muted until it ends; see the side effects at the top.
    r300_music.playSong(r300_music.Song.ActiveSummer)
    check(r300_status.accepted())                            // 37

    // 38,39 — the AI conversation pair. Close FIRST: from the closed state the close is
    //         deterministic (R300 answers ok and changes nothing), while a close issued after a
    //         start can be REFUSED once the robot has begun speaking its greeting — it will not
    //         cut off its own reply. So the pair is closed-then-opened, and the sweep leaves the
    //         conversation open; the courtesy close further down is best effort.
    r300_ai.stopConversation()
    check(r300_status.accepted())                            // 38
    r300_ai.startConversation()
    check(r300_status.accepted())                            // 39

    // 40 — the photo, and the only step whose dependency the extension cannot check for itself:
    //      it needs a conversation that actually OPENED, because the vision endpoint's address
    //      reaches R300 from the server during the handshake. Step 39 just opened one, so this is
    //      the one place in the sweep where that holds — and the block reports nothing about it.
    //      The pause is for the handshake rather than the ack: an address that has not arrived
    //      yet makes the photo pointless, so ask a moment late rather than immediately. If this
    //      step fails on a robot whose conversation really did open, raise the pause.
    //      WATCH AND LISTEN: the robot takes about nine seconds over it and answers OUT LOUD.
    basic.pause(3000)
    r300_camera.takePhoto("What do you see?")
    check(r300_status.accepted())                            // 40

    // 41 — R300 starts looking for apple. The same door 40 used, so it needs the conversation 39
    //      opened. This block only ASKS: the verdict comes back as a request of its own, seconds
    //      later, and the extension latches it when it arrives. Nothing about it shows up here.
    r300_camera.startLooking("apple")
    check(r300_status.accepted())                            // 41

    // 42 — R300 saw apple? for up to 1 seconds. The assertion is `false`, and that is the part of
    //      this block a bench can actually prove: no verdict can arrive inside one second — the
    //      vision call alone runs about nine, as step 40 showed — so the wait has to end by itself
    //      and say so. Whether this robot can see an apple is NOT something this file can know,
    //      and the step does not claim to; what it proves is that a wait with no answer returns.
    //      The matrix stays on 41 for that second: the wait is inside the block, and the step
    //      number is shown after it, as with 40. WATCH: a verdict landing inside the second would
    //      fail this step, and would mean the look from 41 was answered faster than 40's photo.
    const sawApple = r300_camera.saw("apple", 1)
    check(!sawApple)                                         // 42

    // 43 — an empty target is refused HERE, before anything reaches the wire, and the whole point
    //      of the step is that the refusal is VISIBLE: accepted? goes false, the same way step 36's
    //      over-long description does. It has to be checked alone, because with a target R300
    //      itself rejects there is no ack to tell the two apart — the sender's own timeout and a
    //      refusal look identical in the reply. A target in another alphabet is refused for the
    //      same reason and by the same guard (the checksum cannot survive one), which the README
    //      records rather than this file typing one out.
    r300_camera.startLooking("")
    check(!r300_status.accepted())                           // 43

    // 44 — the BYTE cap, which is the refusal a student is likelier to meet than the empty one: "the
    //      big red car" is 15 bytes, one past what R300 will ask the server about, and it is ordinary
    //      English no word count would flag. Same shape as 43 — accepted? goes false — plus the one
    //      thing 43 has not got: the block shows 14 on the LED, which is the only way it can say WHAT
    //      it refused. WATCH for the 14; it holds a second. The extension catches this before the
    //      wire, so nothing goes out and there is no ack, exactly as in 43: what this step proves is
    //      that the guard is there at all, because the numbers on the LED and in R300's log are the
    //      only other places it could show up.
    r300_camera.startLooking("the big red car")
    check(!r300_status.accepted())                           // 44

    // 45 — the waiting block carries the same target. It has the same guard on purpose: a student
    //      types the object into both blocks and either one may be the one that catches it, and a
    //      wait on a question that was never asked could only burn its whole timeout to arrive at
    //      the same false. So the assertion is a false returned AT ONCE — thirty seconds are passed
    //      deliberately, so that a missing guard shows up as a stall to write down rather than as a
    //      silent pass. WATCH: the 14 on the LED again, immediately, from the same guard.
    const sawLongTarget = r300_camera.saw("the big red car", 30)
    check(!sawLongTarget)                                    // 45

    // 46 — park it. The stop and the hands land at once; the face change is queued behind step
    //      40's photo if that is still in flight, and shows up a few seconds late.
    r300_movement.stop()
    check(r300_status.accepted())                            // 46
    r300_emotion.showFace(r300.Emoji.Happy)
    r300_hands.bothHands(r300_hands.HandPose.Down)
    // Best effort, and never checked: see the note above. If the robot is still listening, its own
    // boot button does the same thing — this pair is that button, minus the finger.
    r300_ai.stopConversation()

    // ---- summary ----------------------------------------------------------
    // 0 = every check passed. Otherwise: how many failed, then which ones, blanked between so
    // two step numbers cannot be read as one longer number.
    basic.clearScreen()
    if (fails == 0) {
        basic.showIcon(IconNames.Yes)
        basic.pause(1500)
        basic.showNumber(0)
    } else {
        basic.showIcon(IconNames.Sad)
        basic.pause(1500)
        basic.showNumber(fails)
        for (let i = 0; i < failed.length; i++) {
            basic.clearScreen()
            basic.pause(600)
            basic.showNumber(failed[i])
            basic.pause(600)
        }
    }
    running = false
}

// ---------------------------------------------------------------------------
// Safety net first: this test drives a real robot.
// ---------------------------------------------------------------------------
input.onButtonPressed(Button.AB, function () {
    r300_movement.stop()
})

// Top level, so it runs once at power-up, before any handler.
//
// connect() is called here as well as at the end of r300.ts, on purpose: it is guarded, so a
// second call costs nothing, and it means this file does not care whether its top-level code
// happens to run before or after r300.ts's. Without it, a build that ordered the test first would
// sit in the gate's wait loop with the serial port never opened, and the 30 s timeout would end
// up blaming the robot for it.
r300.connect()
sweep()
