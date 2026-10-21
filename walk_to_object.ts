// walk_to_object.ts — drive at a named object: step forward while it is centred, turn while it
// sits at an edge, and sweep the room while it is out of frame.
//
// The camera answers yes/no and nothing else, so this asks THREE questions about the same object,
// one per region of the frame. Each is an ordinary "look for" pair — the object is just a phrase
// the vision model can answer about, and the region is written into it. A yes at the right edge
// means turn right, a yes at the left edge means turn left, a yes in the middle means the object
// is in frame and roughly centred, so step forward. No to all three means it is not in the frame
// at all, so take one search step and look again.
//
//   A   — start walking (waits for the R300 link first; pressing early is fine)
//   B   — stop: ends after the look it is in the middle of
//   A+B — stop the wheels NOW, mid-move, from a different handler (the real emergency stop)
//
// The LED shows an ARROW for the move in progress: up = both wheels forward, right = the spin for a
// turn right, left = the spin for a turn left. It is blank while the robot is stopped and looking,
// so the matrix is a live statement of what the wheels are doing — an arrow means it is moving, in
// that direction; blank means it is not.
//
// ⚠️ THREE QUESTIONS, NOT ONE, and it is not padding: "touches the right edge" is an EDGE
// condition, so a bottle right of centre but not touching the edge answers no to BOTH edge
// questions — the same pair of answers as a bottle that is not there at all. Without the middle
// question the robot drives forward into an empty room. Together the three do partition the frame.
//
// ⚠️ THE LONGEST QUESTION SETS THE OBJECT'S BUDGET. A target is capped at 32 bytes and the block
// flashes 32 when it is over. "...touches right frame edge" is 25 of them, so as written the object
// may be at most 7 bytes ("bottle" 6, "apple" 5). A longer object refuses the RIGHT question alone
// — the other two still work — so the robot quietly stops turning right while the rest carries on.
// Shorten the suffix instead of the object: "... at right edge" is 14 bytes, leaving room for 18.
//
// ⚠️ Every look is a photo and a vision call: a few seconds each (3-6 typical, 20 worst) and they
// run ONE AT A TIME. The chain stops at the first yes and the in-frame question comes first, so the
// usual decision — the object is in sight — is ONE look: GAP_MS plus the answer, then a full
// FORWARD_SECONDS of driving. Only a turn, or an object that has gone, pays for two or three looks
// — and an unanswered look now costs the result block's full 20 s, so a lost object is slow.
// The robot is stopped while it looks, because the photo is taken whenever R300 gets round to it,
// not when the block is called. ⚠️ Those rests are what keep the board alive — see GAP_MS before
// shortening them.
//
// ⚠️ A miss and a "no" are the same answer to the waiting block, so a hedged or silent vision reply
// is read as "not in the frame" and the robot sweeps. That is the safe reading, not a fast one.
//
// ⚠️ THERE IS NO ARRIVAL CONDITION. Nothing here knows how far away the object is, so once it is
// close the loop keeps nudging — and once the object drops out of frame from below, the search step
// turns the robot away from it. Give the loop a stop rule (a count of centred looks, or a number of
// forward steps) before this is pointed at anything it could drive into.
//
// No AI conversation is needed: the vision endpoint is baked into R300 at boot, so this works on a
// robot straight from power-up. Not part of the extension — add it to pxt.json's testFiles (one
// program at a time) when you flash it.

// The one line to change: what to walk to. Keep it inside the budget above (7 bytes as written).
const TARGET = "bottle"

// The three questions, each written ONCE and handed to the detection block. The result block waits
// on whatever object that block named last, so none of these is retyped anywhere.
const AT_RIGHT = TARGET + " touches right frame edge"    // 31 bytes with "bottle"
const AT_LEFT = TARGET + " touches left frame edge"      // 30 bytes
const CENTRED = TARGET + " in the middle"                // 20 bytes

// The four directions as names. Every move below is one of the extension's own blocks — "move
// forward" / "move backward" / "move left" / "move right" — because the raw "drive rot … fwd …"
// block is a two-number command that has to be right in both numbers, and a direction is what this
// program actually decides.
const DIR_FORWARD = 0
const DIR_LEFT = 1
const DIR_RIGHT = 2

// How far forward per decision. The direction blocks' own limits: forward takes 1-3 SECONDS, (3 is
// the most the block will run) and a turn is a fixed TURN_MS with no field at all.
// ⚠️ Driving is the answer for every look that finds the object, so the step is the LONGEST the
// block allows: the robot should spend its time moving, not standing. A look still costs GAP_MS
// plus the robot's own few seconds, so even at 3 s the loop stands still more than it drives — a
// shorter step only makes that worse.
// ⚠️ The turn is not symmetric: it is a whole second of spinning at full speed whatever the object
// needs, so expect overshoot. The knobs are MOVE_SPEED / TURN_SPEED / TURN_MS inside r300_movement;
// both speeds read 100 because below full these motors do not move the robot at all.
const FORWARD_SECONDS = 3

// ⚠️ The rest between looks, and it is load-bearing, not politeness. When the object is in frame
// each question answers quickly, so the three above go out back to back — and R300 cannot take
// vision calls that close together: it runs out of RAM and restarts, and a restart mid-loop is
// unrecoverable. This is the one number to raise if restarts persist. 1500 ms is the spacing a
// working one-look-per-iteration loop leaves (its 1 s move plus the icon), so it is known to hold.
const GAP_MS = 1500

let walking = false

input.onButtonPressed(Button.A, function () {
    if (walking) return
    if (!awaitLink()) return
    walking = true
    walkToObject()
    walking = false
})

// Ends the loop — after the look it is in the middle of, because a look holds this stack for up to
// 20 s. A+B is the one that acts immediately.
input.onButtonPressed(Button.B, function () {
    walking = false
})

// The real emergency stop. A move is waited out by basic.pause(), and every handler runs in its own
// fiber, so this cuts in mid-move — the same shape the bench files use.
input.onButtonPressed(Button.AB, function () {
    walking = false
    r300_movement.stop()
    basic.clearScreen()              // blank the arrow too: a stopped robot must not claim a direction
})

function walkToObject() {
    while (walking) {
        r300_movement.stop()            // stop to look: the photo is taken while R300 serves the look
        basic.clearScreen()             // and blank the arrow: the robot is not moving while it looks
        // One decision. The default IS the "not in the frame" answer — turn right and sweep — and
        // each look that answers overrides it.
        // ⚠️ THE IN-FRAME QUESTION IS ASKED FIRST. It is the answer that puts the robot back to
        // driving, so it is the one that must cost a single look; an edge question asked first
        // would charge two or three looks to the common case and leave the robot standing to pay
        // them. The chain stops at the first yes, so only a turn or a lost object pays more.
        let dir = DIR_RIGHT              // nothing in frame -> sweep right for it
        if (sees(CENTRED)) {
            dir = DIR_FORWARD            // in frame, away from both edges -> keep driving at it
        } else if (sees(AT_RIGHT)) {
            dir = DIR_RIGHT              // at the right edge -> turn right, back towards the middle
        } else if (sees(AT_LEFT)) {
            dir = DIR_LEFT               // at the left edge -> turn left
        }
        // B may have landed during a look. Check before moving: the move below is the only thing
        // that still runs after the flag is cleared, and it should not.
        if (!walking) return
        moveIn(dir)
    }
}

// One move, in one place, so the arrow and the wheels cannot disagree: the arrow is drawn from the
// same direction passed to the block below it. The blocks are the extension's own, so a student can
// drag the same three out of the toolbox and get the same motion.
function moveIn(dir: number) {
    showDirection(dir)
    if (dir == DIR_FORWARD) r300_movement.moveForward(FORWARD_SECONDS)
    else if (dir == DIR_LEFT) r300_movement.moveLeft()
    else r300_movement.moveRight()
}

// The direction arrow: up for forward, left and right for the two turns. ⚠️ Drawn with led.plot
// rather than an icon block: IconNames' arrow members are not used anywhere else in this extension,
// and a name that does not exist fails the build; pixels cannot.
function showDirection(dir: number) {
    basic.clearScreen()
    if (dir == DIR_FORWARD) {
        led.plot(2, 0)
        led.plot(1, 1); led.plot(2, 1); led.plot(3, 1)
        led.plot(2, 2); led.plot(2, 3); led.plot(2, 4)
    } else if (dir == DIR_LEFT) {
        led.plot(0, 2)
        led.plot(1, 1); led.plot(1, 2); led.plot(1, 3)
        led.plot(2, 2); led.plot(3, 2); led.plot(4, 2)
    } else {                                         // DIR_RIGHT is the only one left
        led.plot(4, 2)
        led.plot(3, 1); led.plot(3, 2); led.plot(3, 3)
        led.plot(2, 2); led.plot(1, 2); led.plot(0, 2)
    }
}

// One look: ask about a region, then wait for the verdict about that same question.
// ⚠️ One look at a time on R300: if the previous look is still outstanding, this ask is refused and
// the wait below then sits out its whole timeout and answers false. Expect a miss to cost one extra
// iteration rather than to be reported as an error.
// ⚠️ The pause comes BEFORE the ask, so it is the gap since the last verdict — exactly the spacing
// that keeps R300's memory in one piece. Putting it after the wait instead would delay the drive.
function sees(question: string): boolean {
    basic.pause(GAP_MS)
    r300_camera.startLooking(question)
    return r300_camera.sawResult()
}

// Bounded wait for the R300 link: the handshake takes a few seconds after R300 powers up.
function awaitLink(): boolean {
    let waited = 0
    while (!r300_status.isConnected() && waited < 20000) {
        basic.pause(100)
        waited += 100
    }
    return r300_status.isConnected()
}
