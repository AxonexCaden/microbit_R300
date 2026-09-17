// test_emotion.ts — walks every face on R300's monitor, one every three seconds, starting by
// itself as soon as the handshake lands.
//
// Student-facing blocks only, like test_2.ts and test_mcp_high_five.ts: paste this file into a
// MakeCode micro:bit project that has the R300 extension added, switch to Blocks, and every call
// turns into the same block you would drag out of the R300 Emotion categories.
//
// The faces are written out one by one rather than looped over a list on purpose: a straight
// run of calls is what the block decompiler can always reproduce, and every face stays visible
// in the stack, in order, where it can be read and moved. The repeat is the one "forever" block
// wrapped around them — nothing inside it is looped, and no list has to be indexed.
//
// The run never ends on its own: it wraps around after the last face and starts again. To stop
// it, press the micro:bit's reset button.
//
// 🔴 NO BEEP, and it must not come back (bench, 2026-09-17). An earlier version of this file
// played a tone from the micro:bit as each face changed. It never survived the SECOND face:
// R300's log shows the first face accepted and then the micro:bit going completely silent —
// no live ack, no hello ack — for ~14 s, after which it comes back and sends face ONE again.
// A face sequence that starts again at Happy is a program that RESTARTED, so the beep was not
// merely noisy: it killed the micro:bit and it came back by resetting.
//
// ⚠️ PASTED-IN MUSIC IS WHAT KILLS IT, not the micro:bit's speaker as such. With the built-in
// speaker enabled, music.playTone reaches the audio path through pins.analogPitch
// (core/pins.cpp), and on V2 that path is the one the DAL itself annotates as having DMA
// trouble ("causes issues with v2 DMA"). Whatever the exact fault, the beep shares hardware
// with the UART link — the same on-board speaker/audio pin is the pin this program talks to
// R300 on. Do not add a tone back to make the run audible, and do not put any other micro:bit
// sound block in the same project as this link. A face change needs no cue: the monitor is
// the output.
//
// ⚠️ No button is used any more, so A is free again. Do not put this in the same project as
// test_mcp_high_five.ts anyway: two senders running at once meet r300.send()'s one-request rule,
// and the loser of that race is refused with "busy" instead of moving anything.
//
// Not part of the extension: not referenced by pxt.json, so it never reaches a student's project.

// 3 s per face — time to look at the monitor, or to walk past it. One pass over the nineteen
// faces is just under a minute, and the last face pauses too, which is what keeps the
// wrap-around even with every other step.
basic.forever(function () {
    // Wait for the handshake before showing anything. R300 ignores the link for about ten
    // seconds after it powers up, and a face sent before that is answered as a FAILED request
    // rather than shown. liveCount only leaves 0 once a live cycle has been answered IN THIS
    // SESSION, so this also covers R300 rebooting mid-run: the run parks on the standby icon
    // and picks itself back up, with nothing to press and nothing to reset.
    while (!r300_status.isConnected()) {
        basic.showIcon(IconNames.Asleep)
        basic.pause(200)
    }
    basic.clearScreen()

    r300_emotion.showFace(r300.Emoji.Happy)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Sad)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Angry)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Surprised)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Shocked)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Confused)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Funny)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Laughing)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Silly)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Crying)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Embarrassed)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Loving)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Kissy)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Winking)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Cool)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Confident)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Suspicious)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Relaxed)
    basic.pause(3000)
    r300_emotion.showFace(r300.Emoji.Delicious)
    basic.pause(3000)
})
