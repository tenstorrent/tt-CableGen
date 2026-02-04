/**
 * Tests for NotificationManager
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { NotificationManager } from '../../static/js/ui/notification-manager.js';

describe('NotificationManager', () => {
    let manager;
    let banner;
    let content;
    let consoleLogSpy;

    beforeEach(() => {
        banner = document.createElement('div');
        banner.id = 'notificationBanner';
        content = document.createElement('div');
        content.id = 'notificationContent';
        document.body.appendChild(banner);
        document.body.appendChild(content);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        if (banner.parentNode) banner.parentNode.removeChild(banner);
        if (content.parentNode) content.parentNode.removeChild(content);
        consoleLogSpy?.mockRestore();
    });

    test('constructor binds banner and content elements', () => {
        manager = new NotificationManager();
        expect(manager.banner).toBe(banner);
        expect(manager.content).toBe(content);
    });

    test('show sets content and displays banner with default type success', () => {
        manager = new NotificationManager();
        manager.show('Saved!');
        expect(content.innerHTML).toBe('Saved!');
        expect(banner.style.display).toBe('block');
    });

        test('show applies type styles', () => {
            manager = new NotificationManager();
            manager.show('Error occurred', 'error');
            expect(banner.style.backgroundColor).toMatch(/248|f8d7da|rgb/i);
        });

        test('error calls show with error type', () => {
            manager = new NotificationManager();
            manager.error('Failed');
            expect(content.innerHTML).toBe('Failed');
            expect(banner.style.backgroundColor).toBeTruthy();
        });

        test('success calls show with success type', () => {
            manager = new NotificationManager();
            manager.success('Done');
            expect(banner.style.backgroundColor).toBeTruthy();
        });

        test('warning calls show with warning type', () => {
            manager = new NotificationManager();
            manager.warning('Careful');
            expect(banner.style.backgroundColor).toBeTruthy();
        });

        test('info calls show with info type', () => {
            manager = new NotificationManager();
            manager.info('Note');
            expect(banner.style.backgroundColor).toBeTruthy();
        });

    test('hide clears timer and hides banner after animation', () => {
        manager = new NotificationManager();
        manager.show('Visible');
        manager.hide();
        expect(manager.notificationTimer).toBeNull();
        jest.advanceTimersByTime(350);
        expect(banner.style.display).toBe('none');
    });

    test('show clears previous timer', () => {
        manager = new NotificationManager();
        manager.show('First');
        manager.show('Second');
        jest.advanceTimersByTime(6000);
        expect(content.innerHTML).toBe('Second');
    });

    test('when banner or content missing, show logs to console', () => {
        document.body.removeChild(banner);
        document.body.removeChild(content);
        manager = new NotificationManager();
        manager.show('Fallback', 'info');
        expect(consoleLogSpy).toHaveBeenCalledWith('info:', 'Fallback');
    });

    test('_getStylesForType returns success style for unknown type', () => {
        manager = new NotificationManager();
        const style = manager._getStylesForType('unknown');
        expect(style).toEqual({
            backgroundColor: '#d4edda',
            borderLeft: '4px solid #28a745',
            color: '#155724'
        });
    });
});
