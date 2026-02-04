/**
 * Tests for FileManagementModule
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { FileManagementModule } from '../../static/js/modules/file-management.js';

describe('FileManagementModule', () => {
    let state;
    let apiClient;
    let uiDisplayModule;
    let notificationManager;
    let module;
    let initSection;

    beforeEach(() => {
        state = { cy: null };
        apiClient = {};
        uiDisplayModule = {};
        notificationManager = { error: jest.fn() };
        module = new FileManagementModule(
            state,
            apiClient,
            uiDisplayModule,
            notificationManager
        );
        initSection = document.createElement('div');
        initSection.id = 'initializationSection';
        initSection.style.display = 'block';
        document.body.appendChild(initSection);
    });

    afterEach(() => {
        if (initSection.parentNode) {
            initSection.parentNode.removeChild(initSection);
        }
    });

    describe('isInitialized', () => {
        test('returns true when state.cy is set', () => {
            state.cy = {};
            expect(module.isInitialized()).toBe(true);
        });

        test('returns true when initializationSection is not present', () => {
            document.body.removeChild(initSection);
            expect(module.isInitialized()).toBe(true);
        });

        test('returns true when initializationSection is display none', () => {
            initSection.style.display = 'none';
            expect(module.isInitialized()).toBe(true);
        });

        test('returns false when initializationSection visible and state.cy null', () => {
            initSection.style.display = 'block';
            state.cy = null;
            expect(module.isInitialized()).toBe(false);
        });
    });

    describe('determineModeFromFile', () => {
        test('returns "location" for .csv', () => {
            expect(module.determineModeFromFile('data.csv')).toBe('location');
            expect(module.determineModeFromFile('DATA.CSV')).toBe('location');
        });

        test('returns "hierarchy" for .textproto', () => {
            expect(module.determineModeFromFile('cabling.textproto')).toBe('hierarchy');
            expect(module.determineModeFromFile('file.TEXTPROTO')).toBe('hierarchy');
        });

        test('returns null for unknown extension', () => {
            expect(module.determineModeFromFile('file.json')).toBe(null);
            expect(module.determineModeFromFile('file.txt')).toBe(null);
            expect(module.determineModeFromFile('file')).toBe(null);
        });
    });
});
