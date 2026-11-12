import { Transform, TransformCallback } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

/** Route Lake's dependency-hook output to the log before the first LSP header.
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
        const header = /Content-Length:[ \t]*[0-9]+\r\n/i.exec(text)
        if (header !== null) {
            this.log(this.logDecoder.end(this.pending.subarray(0, header.index)))
            this.protocolStarted = true
            this.push(this.pending.subarray(header.index))
            this.pending = Buffer.alloc(0)
        } else {
            // Hooks may use IO.print or CR-only progress. Retain only a possible
            // split header, rather than waiting for a newline in progress text.
            const marker = 'content-length:'
            const lower = text.toLowerCase()
            let keep = 0
            const start = lower.lastIndexOf(marker)
            if (start !== -1 && /^[ \t]*[0-9]*\r?$/.test(text.slice(start + marker.length))) {
                keep = text.length - start
            } else {
                for (let n = 1; n < marker.length && n <= text.length; n++) {
                    if (lower.endsWith(marker.slice(0, n))) keep = n
                }
            }
            if (keep > 8192) {
                callback(new Error('Lean sent an oversized startup protocol header. See the Lean output log.'))
                return
            }
            const end = this.pending.length - keep
            this.log(this.logDecoder.write(this.pending.subarray(0, end)))
            // Copy to avoid retaining a large chunk behind a short suffix.
            this.pending = Buffer.from(this.pending.subarray(end))
        }
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
