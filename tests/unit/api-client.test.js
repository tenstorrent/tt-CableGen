/**
 * Tests for ApiClient
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { ApiClient } from '../../static/js/api/api-client.js';

describe('ApiClient', () => {
    let client;
    let originalLocation;
    let fetchMock;

    beforeEach(() => {
        originalLocation = window.location;
        delete window.location;
        window.location = { origin: 'http://test.example.com', href: 'http://test.example.com/' };
        fetchMock = jest.fn();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        window.location = originalLocation;
        global.fetch = originalLocation?.fetch;
    });

    test('constructor sets baseUrl from window.location.origin', () => {
        client = new ApiClient();
        expect(client.baseUrl).toBe('http://test.example.com');
    });

    test('request builds URL with baseUrl and endpoint', async () => {
        fetchMock.mockResolvedValue({
            status: 200,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({ ok: true })
        });
        client = new ApiClient();
        await client.request('/api/test');
        expect(fetchMock).toHaveBeenCalledWith(
            'http://test.example.com/api/test',
            expect.objectContaining({ method: 'GET' })
        );
    });

    test('request returns success data for 200 JSON response', async () => {
        const data = { nodes: [], edges: [] };
        fetchMock.mockResolvedValue({
            status: 200,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve(data)
        });
        client = new ApiClient();
        const result = await client.request('/api/data');
        expect(result.success).toBe(true);
        expect(result.data).toEqual(data);
        expect(result.status).toBe(200);
    });

    test('request returns text for non-JSON content-type', async () => {
        const text = 'node: {}';
        fetchMock.mockResolvedValue({
            status: 200,
            headers: { get: () => 'text/plain' },
            text: () => Promise.resolve(text)
        });
        client = new ApiClient();
        const result = await client.request('/api/textproto');
        expect(result.success).toBe(true);
        expect(result.data).toBe(text);
    });

    test('request throws for non-success status with JSON error', async () => {
        fetchMock.mockResolvedValue({
            status: 500,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({ error: 'Server error' })
        });
        client = new ApiClient();
        await expect(client.request('/api/fail')).rejects.toThrow('Server error');
    });

    test('request uses POST and body when provided', async () => {
        fetchMock.mockResolvedValue({
            status: 200,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({})
        });
        client = new ApiClient();
        const body = { key: 'value' };
        await client.request('/api/post', { method: 'POST', body });
        expect(fetchMock).toHaveBeenCalledWith(
            'http://test.example.com/api/post',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify(body)
            })
        );
    });

    test('request handles circular reference in body via safeStringify', async () => {
        fetchMock.mockResolvedValue({
            status: 200,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({})
        });
        client = new ApiClient();
        const circular = { a: 1 };
        circular.self = circular;
        await client.request('/api/circular', { method: 'POST', body: circular });
        const callBody = fetchMock.mock.calls[0][1].body;
        expect(callBody).toContain('"[Circular Reference]"');
    });

    test('getNodeConfigs calls request with GET_NODE_CONFIGS', async () => {
        const configs = { N300_LB: { tray_count: 4 } };
        fetchMock.mockResolvedValue({
            status: 200,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve(configs)
        });
        client = new ApiClient();
        const result = await client.getNodeConfigs();
        expect(result).toEqual(configs);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/get_node_configs'),
            expect.any(Object)
        );
    });

    test('uploadFile uses FormData and POST', async () => {
        const file = new File(['content'], 'test.csv', { type: 'text/csv' });
        fetchMock.mockResolvedValue({
            status: 200,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({ elements: [] })
        });
        client = new ApiClient();
        await client.uploadFile(file);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                method: 'POST',
                body: expect.any(FormData)
            })
        );
    });
});
