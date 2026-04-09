import * as semver from 'semver'
import { z } from 'zod'

export const semVerSchema = z.string().transform((v, ctx) => {
    const parsed = semver.parse(v)
    if (parsed === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid semver' })
        return z.NEVER
    }
    return parsed
})
