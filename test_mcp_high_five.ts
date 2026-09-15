// test_mcp_high_five.ts — record the high_five routine using the STUDENT-FACING blocks only.
//
// Why a separate file: copy this whole file into a MakeCode micro:bit project that has the R300
// extension added, switch to Blocks, and every call below turns into the same block you would
// drag out of the R300 categories. test.ts does the same job through the internal r300.* API,
// whose blocks are blockHidden — pasted into MakeCode it lands as raw JavaScript, not blocks.
//
// The flow is test.ts's recordHighFive(), in four steps:
//   name it → arm the recorder → perform the routine → publish it as an AI tool.
//
// Not part of the extension: like test_2.ts, this file is not referenced by pxt.json, so it
// never reaches a student's project.

// On A, not "on start": the routine moves both hands, and on start would perform it on every
// power-up with nobody watching. Pressing A also means pressing it when YOU know R300 is up —
// the handshake needs about ten seconds after R300 reboots, and a command sent before that has
// nowhere to go.
input.onButtonPressed(Button.A, function () {
    // 1. Say what the routine does. It is always published as mcp_microbit_1 — the name is
    //    fixed, so there is no naming rule to get wrong — and the description is what the AI
    //    reads to decide when to call it. 32 characters maximum; a longer one is refused rather
    //    than truncated.
    r300_mcp.nameRecording("high-fives the user on request")

    // 2. Arm the recorder. Every move R300 ACCEPTS from here on is captured — and still
    //    happens live, so you are watching the routine being built while you perform it.
    r300_mcp.startRecording()

    // 3. Perform the routine. The two hand moves are the part that gets recorded; the face and
    //    the volume are the show around them and are NOT captured (a take has no sink for
    //    emo_set / vol_set), so calling the tool later replays the hands only.
    //    The pauses are for the audience: a recorded move's dwell is fixed when it is taken, so
    //    these do not change how fast the tool replays.
    r300_hands.bothHands(r300_hands.HandPose.Up)      // hands up — the offer
    basic.pause(700)
    r300_hands.bothHands(r300_hands.HandPose.Down)    // hands down — the five
    basic.pause(700)
    r300_emotion.showFace(r300.Emoji.Cool)
    basic.pause(700)
    r300_speaker.setVolume(80)
    basic.pause(700)

    // 4. Stop and publish. R300 registers the tool as self.microbit.mcp_microbit_1, and the
    //    voice AI can call it from then on. What R300 actually committed — steps taken, and
    //    steps dropped over its 64-step ceiling — is reported in r300.lastTakeSteps /
    //    r300.lastTakeDrop, which are JavaScript-side only and have no block yet.
    r300_mcp.finishRecording()
})
