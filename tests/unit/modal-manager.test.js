/**
 * Tests for ModalManager
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { ModalManager } from '../../static/js/ui/modal-manager.js';

describe('ModalManager', () => {
    let manager;
    let modalEl;
    let consoleErrorSpy;

    beforeEach(() => {
        modalEl = document.createElement('div');
        modalEl.id = 'testModal';
        document.body.appendChild(modalEl);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        if (modalEl.parentNode) {
            modalEl.parentNode.removeChild(modalEl);
        }
        consoleErrorSpy?.mockRestore();
    });

    test('constructor initializes activeModals set', () => {
        manager = new ModalManager();
        expect(manager.activeModals).toBeInstanceOf(Set);
        expect(manager.activeModals.size).toBe(0);
    });

    test('show returns false when modal id not found', () => {
        manager = new ModalManager();
        const result = manager.show('nonexistent');
        expect(result).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith('Modal not found: nonexistent');
    });

    test('show adds active class and registers modal', () => {
        manager = new ModalManager();
        const result = manager.show('testModal');
        expect(result).toBe(true);
        expect(modalEl.classList.contains('active')).toBe(true);
        expect(manager.activeModals.has('testModal')).toBe(true);
    });

    test('show calls onShow callback with modal element', () => {
        manager = new ModalManager();
        const onShow = jest.fn();
        manager.show('testModal', onShow);
        expect(onShow).toHaveBeenCalledWith(modalEl);
    });

    test('hide returns false when modal id not found', () => {
        manager = new ModalManager();
        const result = manager.hide('nonexistent');
        expect(result).toBe(false);
    });

    test('hide removes active class and unregisters modal', () => {
        manager = new ModalManager();
        manager.show('testModal');
        const result = manager.hide('testModal');
        expect(result).toBe(true);
        expect(modalEl.classList.contains('active')).toBe(false);
        expect(manager.activeModals.has('testModal')).toBe(false);
    });

    test('hide calls onHide callback with modal element', () => {
        manager = new ModalManager();
        manager.show('testModal');
        const onHide = jest.fn();
        manager.hide('testModal', onHide);
        expect(onHide).toHaveBeenCalledWith(modalEl);
    });

    test('isVisible returns falsy when modal not found', () => {
        manager = new ModalManager();
        expect(manager.isVisible('nonexistent')).toBeFalsy();
    });

    test('isVisible returns false when modal has no active class', () => {
        manager = new ModalManager();
        expect(manager.isVisible('testModal')).toBe(false);
    });

    test('isVisible returns true when modal has active class', () => {
        manager = new ModalManager();
        manager.show('testModal');
        expect(manager.isVisible('testModal')).toBe(true);
    });

    test('toggle shows modal when hidden', () => {
        manager = new ModalManager();
        manager.toggle('testModal');
        expect(modalEl.classList.contains('active')).toBe(true);
    });

    test('toggle hides modal when visible', () => {
        manager = new ModalManager();
        manager.show('testModal');
        manager.toggle('testModal');
        expect(modalEl.classList.contains('active')).toBe(false);
    });

    test('hideAll hides all active modals', () => {
        const modal2 = document.createElement('div');
        modal2.id = 'testModal2';
        document.body.appendChild(modal2);
        manager = new ModalManager();
        manager.show('testModal');
        manager.show('testModal2');
        manager.hideAll();
        expect(modalEl.classList.contains('active')).toBe(false);
        expect(modal2.classList.contains('active')).toBe(false);
        document.body.removeChild(modal2);
    });

    test('setupClickOutsideClose does nothing when modal not found', () => {
        manager = new ModalManager();
        expect(() => manager.setupClickOutsideClose('nonexistent', () => {})).not.toThrow();
    });

    test('setupClickOutsideClose adds click listener to modal', () => {
        manager = new ModalManager();
        manager.setupClickOutsideClose('testModal', () => {});
        expect(modalEl.onclick).toBeDefined();
    });
});
