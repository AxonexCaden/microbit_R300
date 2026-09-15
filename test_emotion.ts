// test_emotion.ts — press A to walk every face on R300's monitor, 5 seconds apart, with a beep
// from the micro:bit as each one changes.
//
// Student-facing blocks only, like test_2.ts and test_mcp_high_five.ts: paste this file into a
// MakeCode micro:bit project that has the R300 extension added, switch to Blocks, and every call
// turns into the same block you would drag out of the R300 Emotion / Music categories.
//
// The faces are written out one by one rather than looped over a list on purpose: a straight
// run of calls is what the block decompiler can always reproduce, and every face stays visible
// in the stack, in order, where it can be read and moved.
//
// ⚠️ The tone comes from the micro:bit's OWN speaker, not from R300's: the protocol has vol_set
// (R300's volume) and nothing that asks R300 to make a sound. Put the micro:bit where you can
// hear it and the run is followable without looking at the monitor.
//
// ⚠️ If this is pasted into the same project as test_mcp_high_five.ts, remember both ride on A —
// one press then starts the face run AND the high_five recording.
//
// Not part of the extension: not referenced by pxt.json, so it never reaches a student's project.

// 5 s per face — time to look at the monitor, or to walk past it. The whole run is about a
// minute and a half, and the last face stays on screen until something else changes it.
input.onButtonPressed(Button.A, function () {
    r300_emotion.showFace(r300.Emoji.Happy)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Sad)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Angry)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Surprised)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Shocked)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Confused)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Funny)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Laughing)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Silly)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Crying)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Embarrassed)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Loving)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Kissy)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Winking)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Cool)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Confident)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Suspicious)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Relaxed)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
    basic.pause(5000)
    r300_emotion.showFace(r300.Emoji.Delicious)
    music.playTone(Note.C, music.beat(BeatFraction.Eighth))
})
