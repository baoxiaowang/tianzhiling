describe('online config dev login isolation', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevLoginEnabled = process.env.NODE_DEV_LOGIN_ENABLED;
  const originalMongoPassword = process.env.NODE_MONGO_PASSWORD;
  const originalGenericMongoPassword = process.env.MONGO_PASSWORD;

  beforeEach(() => {
    process.env.NODE_MONGO_PASSWORD = 'test-only-password';
  });

  afterEach(() => {
    jest.resetModules();

    if (originalNodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalDevLoginEnabled == null) {
      delete process.env.NODE_DEV_LOGIN_ENABLED;
    } else {
      process.env.NODE_DEV_LOGIN_ENABLED = originalDevLoginEnabled;
    }

    if (originalMongoPassword == null) {
      delete process.env.NODE_MONGO_PASSWORD;
    } else {
      process.env.NODE_MONGO_PASSWORD = originalMongoPassword;
    }

    if (originalGenericMongoPassword == null) {
      delete process.env.MONGO_PASSWORD;
    } else {
      process.env.MONGO_PASSWORD = originalGenericMongoPassword;
    }
  });

  it('does not enable dev login outside the online environment', () => {
    process.env.NODE_ENV = 'local';
    delete process.env.NODE_DEV_LOGIN_ENABLED;

    jest.isolateModules(() => {
      require('../../src/config/config.online');
    });

    expect(process.env.NODE_DEV_LOGIN_ENABLED).toBeUndefined();
  });

  it('does not enable dev login by default in the online environment', () => {
    process.env.NODE_ENV = 'online';
    delete process.env.NODE_DEV_LOGIN_ENABLED;

    jest.isolateModules(() => {
      require('../../src/config/config.online');
    });

    expect(process.env.NODE_DEV_LOGIN_ENABLED).toBeUndefined();
  });

  it('preserves an explicit online environment override', () => {
    process.env.NODE_ENV = 'online';
    process.env.NODE_DEV_LOGIN_ENABLED = 'true';

    jest.isolateModules(() => {
      require('../../src/config/config.online');
    });

    expect(process.env.NODE_DEV_LOGIN_ENABLED).toBe('true');
  });

  it('fails closed when the online database password is missing', () => {
    process.env.NODE_ENV = 'online';
    delete process.env.NODE_MONGO_PASSWORD;
    delete process.env.MONGO_PASSWORD;

    expect(() => {
      jest.isolateModules(() => {
        require('../../src/config/config.online');
      });
    }).toThrow(
      'missing required environment variable: NODE_MONGO_PASSWORD or MONGO_PASSWORD'
    );
  });
});
