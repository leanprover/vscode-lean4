import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { StreamMessageReader } from 'vscode-jsonrpc/node'
import { LakeServerOutput } from '../../src/utils/lakeServerOutput'

const message = { jsonrpc: '2.0', id: 1, result: { label: 'λ' } }
const body = JSON.stringify(message)
const packet = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)

async function filter(chunks: Buffer[]) {
    const log: string[] = []
    const output = new LakeServerOutput(text => log.push(text))
    const received: Buffer[] = []
    output.on('data', (chunk: Buffer) => received.push(chunk))
    const finished = new Promise<void>((resolve, reject) => {
        output.on('end', resolve)
        output.on('error', reject)
    })
    for (const chunk of chunks) output.write(chunk)
    output.end()
    await finished
    return { log: log.join(''), bytes: Buffer.concat(received) }
}

describe('Lake server startup output', () => {
    it('keeps cold dependency setup output out of the protocol', async () => {
        const preamble = 'Current branch: HEAD\nDecompressing 8689 files\n'
        const result = await filter([Buffer.concat([Buffer.from(preamble), packet])])
        expect(result.log).toBe(preamble)
        expect(result.bytes).toEqual(packet)
    })

    it('preserves warm startup byte for byte, including split UTF-8 bodies', async () => {
        const result = await filter([...packet].map(byte => Buffer.from([byte])))
        expect(result.log).toBe('')
        expect(result.bytes).toEqual(packet)
    })

    it('recognises a header split at every possible byte boundary', async () => {
        const input = Buffer.concat([Buffer.from('setup\r\n'), packet])
        for (let i = 0; i <= input.length; i++) {
            const result = await filter([input.subarray(0, i), input.subarray(i)])
            expect(result.log).toBe('setup\r\n')
            expect(result.bytes).toEqual(packet)
        }
    })

    it('never strips unexpected output after the first protocol header', async () => {
        const input = Buffer.concat([packet, Buffer.from('bad later output\n'), packet])
        expect((await filter([input])).bytes).toEqual(input)
    })

    it.each(['setup without newline', 'progress 10%\rprogress 100%\r'])('handles progress %j', async preamble => {
        const input = Buffer.concat([Buffer.from(preamble), packet])
        for (let i = 0; i <= input.length; i++) {
            const result = await filter([input.subarray(0, i), input.subarray(i)])
            expect(result.log).toBe(preamble)
            expect(result.bytes).toEqual(packet)
        }
    })

    it('accepts the same header whitespace as the strict reader', async () => {
        const input = Buffer.from(packet.toString().replace('Content-Length: ', 'content-length:\t'))
        expect((await filter([input])).bytes).toEqual(input)
    })

    const httpBody = JSON.stringify({ ok: true })
    const oldRpcBody = JSON.stringify({ jsonrpc: '1.0', id: 1, result: true })
    it.each([
        `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(httpBody)}\r\n\r\n${httpBody}\n`,
        'HTTP/1.1 200 OK\r\nContent-Length: 999999\r\n\r\nshort progress\n',
        `Content-Length: ${Buffer.byteLength(oldRpcBody)}\r\nContent-Type: application/json\r\n\r\n${oldRpcBody}\n`,
    ])('keeps an HTTP-style hook frame out of the protocol: %j', async preamble => {
        const input = Buffer.concat([Buffer.from(preamble), packet])
        for (let i = 0; i <= input.length; i++) {
            const result = await filter([input.subarray(0, i), input.subarray(i)])
            expect(result.log).toBe(preamble)
            expect(result.bytes).toEqual(packet)
        }
    })

    it('waits for a complete JSON-RPC frame before forwarding startup bytes', async () => {
        const output = new LakeServerOutput(() => {})
        const received: Buffer[] = []
        output.on('data', (chunk: Buffer) => received.push(chunk))
        const finished = new Promise<void>((resolve, reject) => {
            output.on('end', resolve)
            output.on('error', reject)
        })
        output.write(packet.subarray(0, -1))
        expect(received).toHaveLength(0)
        output.end(packet.subarray(-1))
        await finished
        expect(Buffer.concat(received)).toEqual(packet)
    })

    it('logs long progress lines without retaining an unbounded preamble', async () => {
        const preamble = 'λ'.repeat(100_000) + '\n'
        const bytes = Buffer.from(preamble)
        const result = await filter([
            bytes.subarray(0, 8193),
            bytes.subarray(8193, 90_000),
            bytes.subarray(90_000),
            packet,
        ])
        expect(result.log).toBe(preamble)
        expect(result.bytes).toEqual(packet)
    })

    it('reports an early exit and permits a fresh reader to retry', async () => {
        await expect(filter([Buffer.from('setup failed\n')])).rejects.toThrow('before sending a protocol header')
        expect((await filter([packet])).bytes).toEqual(packet)
    })

    it('feeds the real strict JSON-RPC reader after noisy startup', async () => {
        const input = new PassThrough()
        const output = new LakeServerOutput(() => {})
        input.pipe(output)
        const reader = new StreamMessageReader(output)
        const received = new Promise((resolve, reject) => {
            reader.onError(reject)
            reader.listen(resolve)
        })
        input.end(Buffer.concat([Buffer.from('Current branch: HEAD\n'), packet]))
        expect(await received).toEqual(message)
        reader.dispose()
    })
})
