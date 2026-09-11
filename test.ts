let r300Link = r300.connect()

// Fixed 1s link self-test. Each one produces three lines in R300's console
// (MB_cmd -> MB_cmd_ack -> diag_ack), so both directions are visible at a glance.
const SEND_GAP_MS = 1000

basic.forever(function () {
    r300Link.testLink()
    basic.pause(SEND_GAP_MS)
})
