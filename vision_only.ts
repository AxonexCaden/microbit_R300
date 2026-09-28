// vision_only.ts — VLM-only bench: the camera blocks with NO AI conversation.
//
// What this proves: "take a photo and ask" and "R300 starts looking for" both work on a robot
// straight from power-up — no conversation, no wake word, no mic — and the robot never leaves
// idle. Photo → vision model → the answer comes back HERE: text on the LED for A, a tick or a
// cross for B.
//
// To run it: put it in pxt.json's `testFiles` (replacing r300_demo.ts) and `pxt build`, then copy
// built/binary.hex onto the MICROBIT drive. It is a bench file: never in `files`.
//
//   A — one photo + one question; waits for the answer and shows it.
//   B — R300 looks for the bottle; Yes/No from the verdict.
//
// Both handlers wait for the link themselves (up to 20 s), so pressing early is fine — the robot
// ignores the link for its first ten seconds or so. Each ask takes a few seconds, and the robot
// says nothing out loud.

input.onButtonPressed(Button.A, function () {
    if (!awaitLink()) return
    r300_camera.takePhoto("Is this a bottle? Answer with only one word: yes or no.")
    const answer = r300_camera.waitPhotoAnswer(20)
    if (answer.length > 0) basic.showString(answer)
    else basic.showIcon(IconNames.No)
})

input.onButtonPressed(Button.B, function () {
    if (!awaitLink()) return
    r300_camera.startLooking("bottle")
    if (r300_camera.saw("bottle", 20)) basic.showIcon(IconNames.Yes)
    else basic.showIcon(IconNames.No)
})

// Bounded wait for the R300 link: the handshake takes a few seconds after R300 powers up.
function awaitLink(): boolean {
    let waited = 0
    while (!r300_status.isConnected() && waited < 20000) {
        basic.pause(100)
        waited += 100
    }
    return r300_status.isConnected()
}
