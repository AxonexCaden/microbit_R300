// R300 UART link, protocol v1 (protocol.md). No //% annotations here: nothing in this file is a block.
namespace r300 {
    export const PROTOCOL_VERSION = 1
    // R300's line buffer is 128 bytes including the terminator.
    export const MAX_LINE_BYTES = 127
    // What R300 logs as `ext`. Keep in step with pxt.json's "version", and keep
    // it inside 23 chars ([A-Za-z0-9._+-]) -- R300 truncates past that and the
    // test vectors in protocol.md assume it.
    export const EXT_VERSION = "0.1.0"

    // Last volume R300 confirmed as APPLIED (via vol_done), or -1 if it never has.
    // Not the value that was requested — that one is only known to have been accepted.
    export let lastVolume = -1
    // R300's own firmware version, from the `fw` field of its `hello`.
    export let peerFw = ""

    // How many `live` requests R300 has sent and we have answered. Non-zero is the only
    // proof on this side that the link is really UP: R300 does not start its live check
    // until it has seen our hello ack (protocol.md 8), so seeing `hello` only means the
    // handshake has STARTED, while answering a live cycle means it COMPLETED.
    // It is also the signal that survives a micro:bit reset. A micro:bit flashed while
    // R300 keeps running never sees another hello — R300 is long past that phase — so
    // waiting on peerFw there would wait forever.
    export let liveCount = 0

    // The last recording R300 reported committing, from its `mcp_done` (protocol.md 9.7):
    // the tool's name, how many moves it captured, and how many it THREW AWAY because the
    // take ran past R300's 64-step ceiling. All three stay empty/-1 until one lands.
    // ⚠️ `lastTakeDrop` is the only place a truncated routine shows up on this side — a take
    // that lost its tail is otherwise indistinguishable from a complete one here.
    export let lastTakeName = ""
    export let lastTakeSteps = -1
    export let lastTakeDrop = -1

    // Called for every ack that survives the envelope, ck and v checks, so a sender can be
    // woken by the reply it is waiting for. A no-op until r300.ts's sender installs it — a
    // plain function rather than a nullable one so no caller needs an undefined check.
    export let onReply: (id: number, op: string, p: any) => void = function (id: number, op: string, p: any) { }

    export function checksum256(s: string, len: number): number {
        let sum = 0
        for (let i = 0; i < len; i++) sum += s.charCodeAt(i)
        return sum % 256
    }

    // MakeCode strings have no lastIndexOf.
    export function lastIndexOf(s: string, needle: string): number {
        let at = -1
        let from = 0
        while (true) {
            const i = s.indexOf(needle, from)
            if (i < 0) return at
            at = i
            from = i + 1
        }
    }

    // ck covers the received bytes with ,"ck":N stripped, never a re-serialisation.
    export function verifyCk(line: string): boolean {
        const at = lastIndexOf(line, ",\"ck\":")
        if (at < 0) return false
        let i = at + 6
        let got = 0
        let digits = 0
        while (i < line.length) {
            const c = line.charCodeAt(i)
            if (c < 48 || c > 57) break
            digits++
            if (digits > 3) return false
            got = got * 10 + (c - 48)
            i++
        }
        if (digits == 0 || i != line.length - 1 || line.charCodeAt(i) != 125) return false
        return got == (checksum256(line, at) + 125) % 256
    }

    // One envelope line without "\n"; "" if it would not fit R300's buffer.
    export function buildLine(t: string, id: number, op: string, pJson: string): string {
        const body = "{\"v\":" + PROTOCOL_VERSION + ",\"id\":" + id + ",\"t\":\"" + t +
            "\",\"op\":\"" + op + "\",\"p\":" + pJson + "}"
        const line = body.substr(0, body.length - 1) + ",\"ck\":" + checksum256(body, body.length) + "}"
        return line.length <= MAX_LINE_BYTES ? line : ""
    }

    // op is echoed back into JSON, so it must not need escaping.
    function isToken(s: string): boolean {
        if (s.length == 0 || s.length > 16) return false
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i)
            if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 95)) return false
        }
        return true
    }

    // Reply line for one received line (without "\n"), or "" to stay silent.
    export function handleLine(line: string): string {
        if (line.length < 2 || line.charCodeAt(0) != 123) return ""
        // R300 only ever sends a line it built, but a damaged or truncated one reaches here as
        // arbitrary bytes following a "{", and JSON.parse throws on those. This runs inside the
        // RX event handler, so an exception escaping it takes the link's only reader with it.
        let msg: any = undefined
        try {
            msg = JSON.parse(line)
        } catch (e) {
            return ""
        }
        if (msg === undefined || msg === null) return ""
        const t = msg["t"]
        const id = msg["id"]
        const op = msg["op"]
        const idOk = typeof id == "number" && id >= 0 && id <= 255 && id == Math.floor(id)
        const canReply = t === "req" && idOk && typeof op == "string" && isToken(op)

        // No ,"ck": marker at all -> not a line this protocol produced (v0 noise,
        // truncation). §7 #2 says drop it, and badck would be a retry hint to a
        // sender that does not understand this envelope anyway.
        if (lastIndexOf(line, ",\"ck\":") < 0) return ""
        if (!verifyCk(line)) return canReply ? buildLine("ack", id, op, "{\"st\":\"err\",\"e\":\"badck\"}") : ""
        if (msg["v"] !== PROTOCOL_VERSION) {
            // protocol.md 7 #3: a peer that disagrees about `v` answers with a badver ack built
            // on ITS OWN version, so that reply fails the very check we are standing in. Without
            // the exception below, a sender sits out its whole retry budget and reports "timeout"
            // for what is really a version mismatch — the one failure it cannot resend its way out
            // of. `ck` is still enforced above, so a forged line cannot get in through this door.
            const bp = msg["p"]
            if (t == "ack" && idOk && typeof op == "string" &&
                bp !== undefined && bp !== null && bp["e"] == "badver") onReply(id, op, bp)
            return canReply ? buildLine("ack", id, op, "{\"st\":\"err\",\"e\":\"badver\"}") : ""
        }
        // Valid ack/fin land here too: answering either would ping-pong forever (§6). An ack
        // is also the one thing a sender waiting on this id wants to hear about.
        if (!canReply) {
            if (t == "ack" && idOk && typeof op == "string") onReply(id, op, msg["p"])
            return ""
        }
        if (op == "live") {
            liveCount++
            return buildLine("ack", id, op, "{\"st\":\"ok\"}")
        }
        // R300 raises this itself once the volume has actually landed (protocol.md 9.6).
        // Nothing to do but confirm it: answering "noop" would make R300 log the whole
        // two-stage path as failed even though the volume was set.
        if (op == "vol_done") {
            const vp = msg["p"]
            if (vp !== undefined && vp !== null && typeof vp["vol"] == "number") lastVolume = vp["vol"]
            return buildLine("ack", id, op, "{\"st\":\"ok\"}")
        }
        if (op == "hello") {
            const p = msg["p"]
            if (p !== undefined && p !== null && typeof p["fw"] == "string") peerFw = p["fw"]
            return buildLine("ack", id, op, "{\"st\":\"ok\",\"ext\":\"" + EXT_VERSION + "\"}")
        }
        // R300's SECOND reply to a recording (protocol.md 9.7): the mcp_take ack already said
        // "taken", this one says the tool is now live and how big it turned out to be. R300
        // sends it once and never retries it, so a request landing here with no branch to catch
        // it loses that recording's step count for good — which is exactly what happened while
        // this op was missing: the take worked, and the micro:bit could never tell anyone.
        if (op == "mcp_done") {
            const p = msg["p"]
            if (p !== undefined && p !== null && typeof p["name"] == "string" &&
                typeof p["steps"] == "number" && typeof p["drop"] == "number") {
                lastTakeName = p["name"]
                lastTakeSteps = p["steps"]
                lastTakeDrop = p["drop"]
            }
            return buildLine("ack", id, op, "{\"st\":\"ok\"}")
        }
        return buildLine("ack", id, op, "{\"st\":\"err\",\"e\":\"noop\"}")
    }
}
