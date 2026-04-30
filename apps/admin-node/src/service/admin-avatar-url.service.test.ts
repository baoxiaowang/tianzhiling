import { AdminAvatarUrlService } from './admin-avatar-url.service';

function createService() {
  const service = new AdminAvatarUrlService();

  service.tencentCosConfig = {
    enabled: true,
    bucket: 'tzl-bucket',
    region: 'ap-shanghai',
    publicBaseUrl: 'https://cdn.example.com',
  };
  service.ossConfig = {
    enabled: true,
    bucket: 'oss-bucket',
    region: 'cn-shanghai',
    publicBaseUrl: 'https://oss-cdn.example.com',
    secure: true,
  };

  return service;
}

describe('AdminAvatarUrlService', () => {
  it('resolves object keys to public urls', () => {
    const service = createService();

    expect(service.resolve('avatars/user one.png')).toBe(
      'https://cdn.example.com/avatars/user%20one.png'
    );
  });

  it('keeps external urls unchanged', () => {
    const service = createService();

    expect(service.resolve('https://example.com/avatar.png')).toBe(
      'https://example.com/avatar.png'
    );
  });

  it('normalizes known public urls before returning', () => {
    const service = createService();

    expect(service.resolve('https://cdn.example.com/avatars/user.png')).toBe(
      'https://cdn.example.com/avatars/user.png'
    );
  });

  it('normalizes known public urls back to object keys for storage', () => {
    const service = createService();

    expect(
      service.normalizeForStorage('https://cdn.example.com/avatars/user.png')
    ).toBe('avatars/user.png');
  });

  it('normalizes protocol-relative known urls back to object keys', () => {
    const service = createService();

    expect(
      service.normalizeForStorage('//cdn.example.com/avatars/user.png')
    ).toBe('avatars/user.png');
  });
});
