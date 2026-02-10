/**
 * Tests for shared serialization utilities
 */

import { describe, test, expect } from '@jest/globals';
import { safeStringify } from '../../static/js/utils/serialization.js';

describe('serialization', () => {
    describe('safeStringify', () => {
        test('stringifies primitives', () => {
            expect(safeStringify(1)).toBe('1');
            expect(safeStringify('a')).toBe('"a"');
            expect(safeStringify(true)).toBe('true');
            expect(safeStringify(null)).toBe('null');
        });

        test('stringifies plain objects', () => {
            expect(safeStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
        });

        test('replaces circular references with placeholder', () => {
            const circular = { a: 1 };
            circular.self = circular;
            const out = safeStringify(circular);
            expect(out).toContain('[Circular Reference]');
            expect(() => JSON.parse(out)).not.toThrow();
        });

        test('skips functions', () => {
            const obj = { a: 1, fn: () => { } };
            expect(safeStringify(obj)).toBe('{"a":1}');
        });

        test('handles nested circular refs', () => {
            const a = { name: 'a' };
            const b = { name: 'b', ref: a };
            a.ref = b;
            const out = safeStringify({ a, b });
            expect(out).toContain('[Circular Reference]');
        });
    });
});
