/**
 * Tests for StatusManager
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { StatusManager } from '../../static/js/ui/status-manager.js';

describe('StatusManager', () => {
    let manager;
    let statusEl;
    let consoleLogSpy;

    beforeEach(() => {
        statusEl = document.createElement('div');
        statusEl.id = 'exportStatus';
        document.body.appendChild(statusEl);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        if (statusEl.parentNode) {
            statusEl.parentNode.removeChild(statusEl);
        }
        consoleLogSpy?.mockRestore();
    });

    test('constructor binds status element', () => {
        manager = new StatusManager();
        expect(manager.statusElement).toBe(statusEl);
    });

    test('show sets text and class and displays element', () => {
        manager = new StatusManager();
        manager.show('Test message', 'success');
        expect(statusEl.textContent).toBe('Test message');
        expect(statusEl.className).toBe('status-success');
        expect(statusEl.style.display).toBe('block');
    });

    test('show defaults to info type', () => {
        manager = new StatusManager();
        manager.show('Info only');
        expect(statusEl.className).toBe('status-info');
    });

    test('hide hides element', () => {
        manager = new StatusManager();
        manager.show('Visible');
        manager.hide();
        expect(statusEl.style.display).toBe('none');
    });

    test('success calls show with success type', () => {
        manager = new StatusManager();
        manager.success('Done');
        expect(statusEl.textContent).toBe('Done');
        expect(statusEl.className).toBe('status-success');
    });

    test('error calls show with error type', () => {
        manager = new StatusManager();
        manager.error('Failed');
        expect(statusEl.textContent).toBe('Failed');
        expect(statusEl.className).toBe('status-error');
    });

    test('warning calls show with warning type', () => {
        manager = new StatusManager();
        manager.warning('Careful');
        expect(statusEl.textContent).toBe('Careful');
        expect(statusEl.className).toBe('status-warning');
    });

    test('info calls show with info type', () => {
        manager = new StatusManager();
        manager.info('Note');
        expect(statusEl.textContent).toBe('Note');
        expect(statusEl.className).toBe('status-info');
    });

    test('when exportStatus element is missing, show logs to console', () => {
        document.body.removeChild(statusEl);
        manager = new StatusManager();
        expect(manager.statusElement).toBeNull();
        manager.show('Fallback message', 'error');
        expect(consoleLogSpy).toHaveBeenCalledWith('[error]', 'Fallback message');
    });

    test('when exportStatus element is missing, hide does not throw', () => {
        document.body.removeChild(statusEl);
        manager = new StatusManager();
        expect(() => manager.hide()).not.toThrow();
    });
});
