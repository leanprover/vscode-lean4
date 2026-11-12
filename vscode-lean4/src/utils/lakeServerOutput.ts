import { Transform, TransformCallback } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

const maxHeaderBytes = 8192
const maxFirstMessageBytes = 8 * 1024 * 1024

function isJsonRpcMessage(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const message = value as Record<string, unknown>
    if (message.jsonrpc !== '2.0') return false
    const validId =
        message.id === null ||
        typeof message.id === 'string' ||
        (typeof message.id === 'number' && Number.isFinite(message.id))
    if (typeof message.method === 'string') {
        return !('id' in message) || validId
    }
    if (!('id' in message) || !validId) return false
    if ('result' in message) return !('error' in message)
    const error = message.error
    return (
        error !== null &&
        typeof error === 'object' &&
        !Array.isArray(error) &&
        Number.isInteger((error as Record<string, unknown>).code) &&
        typeof (error as Record<string, unknown>).message === 'string'
    )
}

/** Route Lake's dependency-hook output to the log before the first LSP frame.
 * Once protocol output starts, pass every byte through to the strict LSP reader.
 */
export class LakeServerOutput extends Transform {
    private pending = Buffer.alloc(0)
    private protocolStarted = false
    private readonly logDecoder = new StringDecoder('utf8')

    constructor(private readonly log: (text: string) => void) {
        super()
    }

    override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        if (this.protocolStarted) {
            callback(undefined, chunk)
            return
        }
        this.pending = Buffer.concat([this.pending, chunk])
        const text = this.pending.toString('latin1')
        const headers = /Content-Length:[ \t]*([0-9]+)\r\n/gi
        let keepFrom = this.pending.length
        let header: RegExpExecArray | null
        while ((header = headers.exec(text)) !== null) {
            const length = Number(header[1])
            if (!Number.isSafeInteger(length) || length > maxFirstMessageBytes) continue
            const separator = this.pending.indexOf('\r\n\r\n', header.index)
            if (separator === -1) {
                if (this.pending.length - header.index <= maxHeaderBytes) keepFrom = Math.min(keepFrom, header.index)
                continue
            }
            if (separator - header.index > maxHeaderBytes) continue
            const body = separator + 4
            const end = body + length
            if (end > this.pending.length) {
                // An HTTP-style hook header may claim a body that never arrives.
                // Keep searching: a later complete Lean frame can still start us.
                keepFrom = Math.min(keepFrom, header.index)
                continue
            }
            try {
                if (!isJsonRpcMessage(JSON.parse(this.pending.subarray(body, end).toString('utf8')))) continue
            } catch {
                continue
            }
            this.log(this.logDecoder.end(this.pending.subarray(0, header.index)))
            this.protocolStarted = true
            this.push(this.pending.subarray(header.index))
            this.pending = Buffer.alloc(0)
            callback()
            return
        }
        // Hooks may use IO.print or CR-only progress. Retain only a possible
        // split header or bounded incomplete frame, not all setup output.
        const marker = 'content-length:'
        const lower = text.toLowerCase()
        const start = lower.lastIndexOf(marker)
        if (start !== -1 && /^[ \t]*[0-9]*\r?$/.test(text.slice(start + marker.length))) {
            if (this.pending.length - start > maxHeaderBytes) {
                callback(new Error('Lean sent an oversized startup protocol header. See the Lean output log.'))
                return
            }
            keepFrom = Math.min(keepFrom, start)
        } else {
            for (let n = 1; n < marker.length && n <= text.length; n++) {
                if (lower.endsWith(marker.slice(0, n))) keepFrom = Math.min(keepFrom, this.pending.length - n)
            }
        }
        this.log(this.logDecoder.write(this.pending.subarray(0, keepFrom)))
        // Copy to avoid retaining a large chunk behind a short suffix.
        this.pending = Buffer.from(this.pending.subarray(keepFrom))
        callback()
    }

    override _flush(callback: TransformCallback): void {
        if (!this.protocolStarted) {
            this.log(this.logDecoder.end(this.pending))
            callback(
                new Error(
                    'Lean exited before sending a protocol header. See the Lean output log, then restart the server.',
                ),
            )
            return
        }
        callback()
    }
}
