import { describe, expect, it, vi } from 'vitest';

import { HttpRegistryClient } from '../src/services/registry.js';

describe('HttpRegistryClient.resolvePackage', () => {
  it('exact semver는 메타 조회 없이 그대로 사용한다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch should not be called');
    });

    const client = new HttpRegistryClient();
    const resolved = await client.resolvePackage('@goondan/base@0.1.0', 'https://registry.example.com', 'token');
    expect(resolved.latestVersion).toBe('0.1.0');

    fetchSpy.mockRestore();
  });

  it('range semver는 메타데이터 latest를 조회한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          'dist-tags': {
            latest: '0.2.0',
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const client = new HttpRegistryClient();
    const resolved = await client.resolvePackage('@goondan/base@^0.1.0', 'https://registry.example.com', 'token');
    expect(resolved.latestVersion).toBe('0.2.0');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/%40goondan/base',
      expect.objectContaining({
        method: 'GET',
      }),
    );

    fetchMock.mockRestore();
  });
});
