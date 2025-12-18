import assert from 'assert'
import { suite } from 'mocha'
import { logger } from '../../../src/utils/logger'

suite('Tests', () => {
    test('Placeholder test', () => {
        logger.log('=================== Placeholder ===================')
        assert(2 + 2 === 4, 'Big brother is watching you')
    })
})
