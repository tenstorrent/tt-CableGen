/**
 * Tests for UIDisplayModule
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { UIDisplayModule } from '../../static/js/modules/ui-display.js';

describe('UIDisplayModule', () => {
    let state;
    let commonModule;
    let locationModule;
    let hierarchyModule;
    let notificationManager;
    let statusManager;
    let module;

    beforeEach(() => {
        state = {};
        commonModule = { getTemplateColor: jest.fn((name) => (name === 't1' ? '#abc' : '#000')) };
        locationModule = {};
        hierarchyModule = {};
        notificationManager = { show: jest.fn() };
        statusManager = { show: jest.fn() };
        module = new UIDisplayModule(
            state,
            commonModule,
            locationModule,
            hierarchyModule,
            notificationManager,
            statusManager
        );
    });

    describe('showExportStatus', () => {
        test('delegates to notificationManager.show', () => {
            module.showExportStatus('Export done', 'success');
            expect(notificationManager.show).toHaveBeenCalledWith('Export done', 'success', null);
        });
    });

    describe('getTemplateColor', () => {
        test('delegates to commonModule.getTemplateColor', () => {
            const color = module.getTemplateColor('my_template');
            expect(commonModule.getTemplateColor).toHaveBeenCalledWith('my_template');
            expect(color).toBe('#000');
        });

        test('returns color from commonModule', () => {
            expect(module.getTemplateColor('t1')).toBe('#abc');
        });
    });
});
