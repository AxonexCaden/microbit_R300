// R300 UART link, protocol v1 (protocol.md). No //% annotations here: nothing in this file is a block.
namespace r300 {
    export const PROTOCOL_VERSION = 1
    // R300's line buffer is 128 bytes including the terminator.
    export const MAX_LINE_BYTES = 127

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
        const msg = JSON.parse(line)
        if (msg === undefined || msg === null) return ""
        const t = msg["t"]
        const id = msg["id"]
        const op = msg["op"]
        const idOk = typeof id == "number" && id >= 0 && id <= 255 && id == Math.floor(id)
        const canReply = t === "req" && idOk && typeof op == "string" && isToken(op)

        if (!verifyCk(line)) return canReply ? buildLine("ack", id, op, "{\"st\":\"err\",\"e\":\"badck\"}") : ""
        if (msg["v"] !== PROTOCOL_VERSION) return canReply ? buildLine("ack", id, op, "{\"st\":\"err\",\"e\":\"badver\"}") : ""
        // Valid ack/fin land here too: answering either would ping-pong forever.
        if (!canReply) return ""
        if (op == "live") return buildLine("ack", id, op, "{\"st\":\"ok\"}")
        return buildLine("ack", id, op, "{\"st\":\"err\",\"e\":\"noop\"}")
    }
}
