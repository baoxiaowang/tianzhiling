import { readFileSync } from 'fs';
import { join } from 'path';
import { WechatPayService } from '../../src/service/wechat-pay.service';

const CERT = readFileSync(
  join(__dirname, '../fixtures/merchant-cert-cn-1747506198.pem'),
  'utf8'
);

function createService(mchId: string, enabled = true) {
  const service = new WechatPayService();
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never;
  (service as unknown as { wechatPayConfig: unknown }).wechatPayConfig = {
    enabled,
    mchId,
  };
  return service;
}

describe('WechatPayService 证书守卫', () => {
  const originalPath = process.env.NODE_WECHAT_PAY_CERT_PATH;
  const originalGuard = process.env.NODE_WECHAT_PAY_CERT_GUARD;

  beforeEach(() => {
    process.env.NODE_WECHAT_PAY_CERT_PATH = join(
      __dirname,
      '../fixtures/merchant-cert-cn-1747506198.pem'
    );
    delete process.env.NODE_WECHAT_PAY_CERT_GUARD;
  });

  afterAll(() => {
    if (originalPath === undefined) delete process.env.NODE_WECHAT_PAY_CERT_PATH;
    else process.env.NODE_WECHAT_PAY_CERT_PATH = originalPath;
    if (originalGuard === undefined) delete process.env.NODE_WECHAT_PAY_CERT_GUARD;
    else process.env.NODE_WECHAT_PAY_CERT_GUARD = originalGuard;
  });

  it('证书 CN 与 mchid 一致时通过', () => {
    const service = createService('1747506198');
    expect(() => service.assertMerchantCertificateMatches()).not.toThrow();
  });

  it('证书 CN 与 mchid 不一致时拒绝启动', () => {
    const service = createService('1724527140');
    expect(() => service.assertMerchantCertificateMatches()).toThrow(
      /商户证书与配置不匹配/
    );
  });

  it('warn 模式下只记录 error 不抛异常', () => {
    process.env.NODE_WECHAT_PAY_CERT_GUARD = 'warn';
    const service = createService('1724527140');
    expect(() => service.assertMerchantCertificateMatches()).not.toThrow();
    expect(service.logger.error).toHaveBeenCalled();
  });

  it('证书文件不存在时跳过校验', () => {
    process.env.NODE_WECHAT_PAY_CERT_PATH = '/tmp/not-exists-cert.pem';
    const service = createService('1724527140');
    expect(() => service.assertMerchantCertificateMatches()).not.toThrow();
    expect(service.logger.warn).toHaveBeenCalled();
  });

  it('未启用微信支付时跳过校验', () => {
    const service = createService('1724527140', false);
    expect(() => service.assertMerchantCertificateMatches()).not.toThrow();
  });

  it('fixture 证书确实包含预期的 CN', () => {
    expect(CERT).toContain('BEGIN CERTIFICATE');
  });
});
