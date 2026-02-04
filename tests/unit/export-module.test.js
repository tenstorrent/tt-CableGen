/**
 * Tests for ExportModule
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { ExportModule } from '../../static/js/modules/export.js';

describe('ExportModule', () => {
    let state;
    let commonModule;
    let apiClient;
    let notificationManager;
    let statusManager;
    let exportModule;

    beforeEach(() => {
        state = {
            cy: null,
            data: {},
            mode: 'location'
        };
        commonModule = {};
        apiClient = {};
        notificationManager = { show: jest.fn() };
        statusManager = { show: jest.fn() };
        exportModule = new ExportModule(
            state,
            commonModule,
            apiClient,
            notificationManager,
            statusManager
        );
    });

    describe('validateHostnames', () => {
        test('returns empty array when no shelf nodes', () => {
            state.cy = {
                nodes: () => ({
                    forEach: (fn) => fn({ data: () => ({ type: 'port' }) })
                })
            };
            expect(exportModule.validateHostnames()).toEqual([]);
        });

        test('returns empty array when all shelves have hostname', () => {
            state.cy = {
                nodes: () => ({
                    forEach: (fn) => {
                        fn({ data: () => ({ type: 'shelf', hostname: 'host1', label: 'S1' }) });
                        fn({ data: () => ({ type: 'shelf', hostname: 'host2', id: '2' }) });
                    }
                })
            };
            expect(exportModule.validateHostnames()).toEqual([]);
        });

        test('returns labels of shelves missing hostname', () => {
            state.cy = {
                nodes: () => ({
                    forEach: (fn) => {
                        fn({ data: () => ({ type: 'shelf', hostname: 'ok', label: 'OK' }) });
                        fn({ data: () => ({ type: 'shelf', hostname: '', label: 'Bad1' }) });
                        fn({ data: () => ({ type: 'shelf', hostname: '  ', id: 'x', label: 'Bad2' }) });
                        fn({ data: () => ({ type: 'shelf', label: 'NoHost' }) });
                    }
                })
            };
            expect(exportModule.validateHostnames()).toEqual(['Bad1', 'Bad2', 'NoHost']);
        });
    });

    describe('sanitizeForJSON', () => {
        test('returns null and undefined as-is', () => {
            expect(exportModule.sanitizeForJSON(null)).toBe(null);
            expect(exportModule.sanitizeForJSON(undefined)).toBe(undefined);
        });

        test('returns primitives as-is', () => {
            expect(exportModule.sanitizeForJSON(1)).toBe(1);
            expect(exportModule.sanitizeForJSON('a')).toBe('a');
            expect(exportModule.sanitizeForJSON(true)).toBe(true);
        });

        test('converts Date to ISO string', () => {
            const d = new Date('2025-01-01T00:00:00.000Z');
            expect(exportModule.sanitizeForJSON(d)).toBe('2025-01-01T00:00:00.000Z');
        });

        test('strips functions (returns undefined for value)', () => {
            const obj = { a: 1, fn: () => {} };
            const out = exportModule.sanitizeForJSON(obj);
            expect(out).toEqual({ a: 1 });
        });

        test('sanitizes arrays', () => {
            expect(exportModule.sanitizeForJSON([1, 2, 3])).toEqual([1, 2, 3]);
            const arr = [1, { b: 2 }];
            expect(exportModule.sanitizeForJSON(arr)).toEqual([1, { b: 2 }]);
        });

        test('removes circular references', () => {
            const circular = { a: 1 };
            circular.self = circular;
            const out = exportModule.sanitizeForJSON(circular);
            expect(out.a).toBe(1);
            expect(out.self).toBeUndefined();
        });

        test('tracks circular refs in optional array', () => {
            const circularRefs = [];
            const circular = { x: 1 };
            circular.me = circular;
            exportModule.sanitizeForJSON(circular, new WeakSet(), 'root', circularRefs);
            expect(circularRefs.length).toBeGreaterThan(0);
            expect(circularRefs[0].path).toBeDefined();
            expect(circularRefs[0].type).toBe('object');
        });
    });

    describe('formatErrorMessage', () => {
        test('returns error string when error present', () => {
            expect(exportModule.formatErrorMessage({ error: 'Something failed' })).toContain('Something failed');
        });

        test('returns "Unknown error occurred" when no error key', () => {
            expect(exportModule.formatErrorMessage({})).toContain('Unknown error occurred');
        });

        test('adds generation_failed prefix and exit_code', () => {
            const msg = exportModule.formatErrorMessage({
                error_type: 'generation_failed',
                error: 'Failed',
                exit_code: 1
            });
            expect(msg).toContain('Cabling Generator Failed');
            expect(msg).toContain('Failed');
            expect(msg).toContain('Exit Code: 1');
        });

        test('adds timeout prefix and command', () => {
            const msg = exportModule.formatErrorMessage({
                error_type: 'timeout',
                error: 'Timed out',
                command: 'python script.py'
            });
            expect(msg).toContain('Generator Timeout');
            expect(msg).toContain('python script.py');
        });

        test('adds stdout and stderr section when present', () => {
            const msg = exportModule.formatErrorMessage({
                error: 'Err',
                stdout: 'out line',
                stderr: 'err line'
            });
            expect(msg).toContain('--- Generator Output ---');
            expect(msg).toContain('STDOUT');
            expect(msg).toContain('out line');
            expect(msg).toContain('STDERR');
            expect(msg).toContain('err line');
        });

        test('default error_type prefix', () => {
            const msg = exportModule.formatErrorMessage({
                error_type: 'other_type',
                error: 'Msg'
            });
            expect(msg).toContain('other_type');
            expect(msg).toContain('Msg');
        });
    });

    describe('getCustomFileName', () => {
        test('returns default when input element missing', () => {
            expect(exportModule.getCustomFileName('default.textproto')).toBe('default.textproto');
        });

        test('returns default when input value empty', () => {
            const input = document.createElement('input');
            input.id = 'exportFileNameInput';
            input.value = '';
            document.body.appendChild(input);
            try {
                expect(exportModule.getCustomFileName('fallback.csv')).toBe('fallback.csv');
            } finally {
                document.body.removeChild(input);
            }
        });

        test('returns trimmed input value when present', () => {
            const input = document.createElement('input');
            input.id = 'exportFileNameInput';
            input.value = '  my_export.textproto  ';
            document.body.appendChild(input);
            try {
                expect(exportModule.getCustomFileName('default.textproto')).toBe('my_export.textproto');
            } finally {
                document.body.removeChild(input);
            }
        });
    });
});
