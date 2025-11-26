/**
 * Tests for state management modules
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { VisualizerState } from '../../static/js/state/visualizer-state.js';
import { StateObserver } from '../../static/js/state/state-observer.js';

describe('VisualizerState', () => {
    let state;

    beforeEach(() => {
        state = new VisualizerState();
    });

    test('initializes with correct defaults', () => {
        expect(state.mode).toBe('location');
        expect(state.data.globalHostCounter).toBe(0);
        expect(state.editing.isEdgeCreationMode).toBe(false);
        expect(state.editing.selectedFirstPort).toBeNull();
        expect(state.editing.selectedSecondPort).toBeNull();
        expect(state.editing.selectedConnection).toBeNull();
        expect(state.editing.selectedNode).toBeNull();
    });

    test('reset() clears all state', () => {
        state.data.globalHostCounter = 10;
        state.editing.isEdgeCreationMode = true;
        state.editing.selectedFirstPort = 'port1';
        state.mode = 'hierarchy';

        state.reset();

        expect(state.data.globalHostCounter).toBe(0);
        expect(state.editing.isEdgeCreationMode).toBe(false);
        expect(state.editing.selectedFirstPort).toBeNull();
        expect(state.mode).toBe('location');
    });

    test('setMode() updates mode correctly', () => {
        state.setMode('hierarchy');
        expect(state.mode).toBe('hierarchy');

        state.setMode('location');
        expect(state.mode).toBe('location');
    });

    test('setMode() rejects invalid modes', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        state.setMode('invalid');
        expect(state.mode).toBe('location'); // Should remain unchanged
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test('isLocationMode() returns correct value', () => {
        state.setMode('location');
        expect(state.isLocationMode()).toBe(true);
        expect(state.isHierarchyMode()).toBe(false);
    });

    test('isHierarchyMode() returns correct value', () => {
        state.setMode('hierarchy');
        expect(state.isHierarchyMode()).toBe(true);
        expect(state.isLocationMode()).toBe(false);
    });

    test('enableEditMode() and disableEditMode() work correctly', () => {
        expect(state.isEditMode()).toBe(false);

        state.enableEditMode();
        expect(state.isEditMode()).toBe(true);
        expect(state.editing.isEdgeCreationMode).toBe(true);

        state.disableEditMode();
        expect(state.isEditMode()).toBe(false);
        expect(state.editing.isEdgeCreationMode).toBe(false);
    });

    test('clearSelections() clears all selections', () => {
        state.editing.selectedFirstPort = 'port1';
        state.editing.selectedSecondPort = 'port2';
        state.editing.selectedConnection = 'conn1';
        state.editing.selectedNode = 'node1';

        state.clearSelections();

        expect(state.editing.selectedFirstPort).toBeNull();
        expect(state.editing.selectedSecondPort).toBeNull();
        expect(state.editing.selectedConnection).toBeNull();
        expect(state.editing.selectedNode).toBeNull();
    });

    test('getNextConnectionNumber() increments correctly', () => {
        expect(state.getNextConnectionNumber()).toBe(0);
        expect(state.getNextConnectionNumber()).toBe(1);
        expect(state.getNextConnectionNumber()).toBe(2);
        expect(state.editing.currentConnectionNumber).toBe(3);
    });

    test('createSnapshot() creates valid snapshot', () => {
        state.setMode('hierarchy');
        state.data.globalHostCounter = 5;
        const mockCy = { json: jest.fn(() => ({ elements: [] })) };
        state.cy = mockCy;

        const snapshot = state.createSnapshot();

        expect(snapshot.mode).toBe('hierarchy');
        expect(snapshot.globalHostCounter).toBe(5);
        expect(snapshot.cytoscapeData).toEqual({ elements: [] });
        expect(snapshot.timestamp).toBeDefined();
    });

    test('saveToHistory() adds snapshot to history', () => {
        state.data.globalHostCounter = 1;
        state.saveToHistory();

        expect(state.history.stack.length).toBe(1);
        expect(state.history.currentIndex).toBe(0);
        expect(state.history.stack[0].globalHostCounter).toBe(1);
    });

    test('saveToHistory() limits history size', () => {
        state.history.maxSize = 3;

        for (let i = 0; i < 5; i++) {
            state.data.globalHostCounter = i;
            state.saveToHistory();
        }

        expect(state.history.stack.length).toBe(3);
        expect(state.history.stack[0].globalHostCounter).toBe(2); // Oldest should be 2
        expect(state.history.stack[2].globalHostCounter).toBe(4); // Newest should be 4
    });

    test('undo() restores previous state', () => {
        state.data.globalHostCounter = 0;
        state.saveToHistory();

        state.data.globalHostCounter = 5;
        state.saveToHistory();

        state.data.globalHostCounter = 10;
        state.saveToHistory();

        expect(state.undo()).toBe(true);
        expect(state.data.globalHostCounter).toBe(5);

        expect(state.undo()).toBe(true);
        expect(state.data.globalHostCounter).toBe(0);

        expect(state.undo()).toBe(false); // Can't undo further
    });

    test('redo() restores undone state', () => {
        state.data.globalHostCounter = 0;
        state.saveToHistory();

        state.data.globalHostCounter = 5;
        state.saveToHistory();

        state.undo();
        expect(state.data.globalHostCounter).toBe(0);

        expect(state.redo()).toBe(true);
        expect(state.data.globalHostCounter).toBe(5);

        expect(state.redo()).toBe(false); // Can't redo further
    });

    test('clearHistory() clears all history', () => {
        state.saveToHistory();
        state.saveToHistory();
        state.saveToHistory();

        state.clearHistory();

        expect(state.history.stack.length).toBe(0);
        expect(state.history.currentIndex).toBe(-1);
    });

    test('log() only logs when debug is enabled', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        state.log('test message');
        expect(consoleSpy).not.toHaveBeenCalled();

        state.enableDebug();
        state.log('test message');
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });
});

describe('StateObserver', () => {
    let state, observer;

    beforeEach(() => {
        state = new VisualizerState();
        observer = new StateObserver(state);
    });

    test('subscribe() registers callback', () => {
        const callback = jest.fn();
        observer.subscribe('test.path', callback);

        observer.notify('test.path', 'newValue', 'oldValue');

        expect(callback).toHaveBeenCalledWith('newValue', 'oldValue', 'test.path');
    });

    test('unsubscribe removes callback', () => {
        const callback = jest.fn();
        const unsubscribe = observer.subscribe('test.path', callback);

        unsubscribe();
        observer.notify('test.path', 'newValue', 'oldValue');

        expect(callback).not.toHaveBeenCalled();
    });

    test('notify() calls all callbacks for a path', () => {
        const callback1 = jest.fn();
        const callback2 = jest.fn();

        observer.subscribe('test.path', callback1);
        observer.subscribe('test.path', callback2);

        observer.notify('test.path', 'newValue', 'oldValue');

        expect(callback1).toHaveBeenCalled();
        expect(callback2).toHaveBeenCalled();
    });

    test('createProxy() notifies on property changes', () => {
        const callback = jest.fn();
        observer.subscribe('editing.isEdgeCreationMode', callback);

        const proxy = observer.createProxy(state.editing, 'editing');
        proxy.isEdgeCreationMode = true;

        expect(callback).toHaveBeenCalledWith(true, false, 'editing.isEdgeCreationMode');
        expect(state.editing.isEdgeCreationMode).toBe(true);
    });

    test('createProxy() handles nested objects', () => {
        const callback = jest.fn();
        observer.subscribe('data.globalHostCounter', callback);

        const proxy = observer.createProxy(state.data, 'data');
        proxy.globalHostCounter = 5;

        expect(callback).toHaveBeenCalledWith(5, 0, 'data.globalHostCounter');
        expect(state.data.globalHostCounter).toBe(5);
    });

    test('clear() removes all observers', () => {
        const callback = jest.fn();
        observer.subscribe('test.path', callback);

        observer.clear();
        observer.notify('test.path', 'newValue', 'oldValue');

        expect(callback).not.toHaveBeenCalled();
    });
});

