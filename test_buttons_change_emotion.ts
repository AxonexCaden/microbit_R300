// test_emotion_buttons.ts — walk R300's faces by hand: press A OR B to advance to the NEXT
// face, wrapping Delicious back to Happy. Power-up starts on Happy, so the first press of
// either button goes to Sad. Both buttons do the same thing on purpose: there is no step
// backwards, so nobody can get stuck walking the list the wrong way.
//
// Copy this whole file into a MakeCode micro:bit project that has the R300 extension added and
// switch to Blocks: every call below turns into a block from the R300 Emotion / R300 Status
// categories, and the if/else chains are ordinary Logic blocks. Nothing here is JavaScript-only.
//
// The 19 faces are the ones every monitor profile (floki / pengu / bduck) carries. The three
// custom slots are left out on purpose: a profile with no art for custom1..custom3 still
// ACCEPTS the request and then draws nothing, which looks like a broken demo rather than a
// missing picture. Add them after Delicious if this robot's profile has the art.
//
// Not part of the extension: not in pxt.json, so it never reaches a student's project.

let faceIndex = 0        // 0..18 — the face on the monitor now
let ready = false        // false until the handshake has landed and the first face is sent

// Show one of the 19 faces by number. The face only CHANGES if R300 accepted the request:
// faceIndex stays put after "busy" (a button pressed while the previous change was still
// waiting for its ack) or "timeout", so the next press asks again for the face this one
// missed instead of skipping it. "Accepted" is still not "drawn" — R300 sends no second report for
// a face — but it is the strongest promise the link makes.
function showFaceAt(index: number): void {
    if (index == 0) {
        r300_emotion.showFace(r300.Emoji.Happy)
    } else if (index == 1) {
        r300_emotion.showFace(r300.Emoji.Sad)
    } else if (index == 2) {
        r300_emotion.showFace(r300.Emoji.Angry)
    } else if (index == 3) {
        r300_emotion.showFace(r300.Emoji.Surprised)
    } else if (index == 4) {
        r300_emotion.showFace(r300.Emoji.Shocked)
    } else if (index == 5) {
        r300_emotion.showFace(r300.Emoji.Confused)
    } else if (index == 6) {
        r300_emotion.showFace(r300.Emoji.Funny)
    } else if (index == 7) {
        r300_emotion.showFace(r300.Emoji.Laughing)
    } else if (index == 8) {
        r300_emotion.showFace(r300.Emoji.Silly)
    } else if (index == 9) {
        r300_emotion.showFace(r300.Emoji.Crying)
    } else if (index == 10) {
        r300_emotion.showFace(r300.Emoji.Embarrassed)
    } else if (index == 11) {
        r300_emotion.showFace(r300.Emoji.Loving)
    } else if (index == 12) {
        r300_emotion.showFace(r300.Emoji.Kissy)
    } else if (index == 13) {
        r300_emotion.showFace(r300.Emoji.Winking)
    } else if (index == 14) {
        r300_emotion.showFace(r300.Emoji.Cool)
    } else if (index == 15) {
        r300_emotion.showFace(r300.Emoji.Confident)
    } else if (index == 16) {
        r300_emotion.showFace(r300.Emoji.Suspicious)
    } else if (index == 17) {
        r300_emotion.showFace(r300.Emoji.Relaxed)
    } else {
        r300_emotion.showFace(r300.Emoji.Delicious)
    }
    if (r300_status.accepted()) {
        faceIndex = index
    }
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
