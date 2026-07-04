import { createHmac } from 'crypto';
import { WechatPayService } from '../../src/service/wechat-pay.service';

describe('WechatPayService virtual payment signing', () => {
  function createVirtualPayService() {
    const service = new WechatPayService();

    service.wechatMiniProgramConfig = {
      appId: 'mini-app-id',
      appSecret: 'mini-app-secret',
    } as any;
    service.wechatVirtualPayConfig = {
      enabled: true,
      offerId: 'offer-1',
      env: 1,
      sandboxAppKey: 'sandbox-app-key',
      productionAppKey: 'production-app-key',
    } as any;

    return service;
  }

  it('keeps openid exchange compatible without requiring session_key', async () => {
    const service = createVirtualPayService();

    (service as any).getJson = jest.fn().mockResolvedValue({
      openid: 'openid-1',
    });

    await expect(service.getOpenidByJsCode('wx-code')).resolves.toBe(
      'openid-1'
    );
  });

  it('requires session_key when exchanging jsCode for virtual payment', async () => {
    const service = createVirtualPayService();

    (service as any).getJson = jest.fn().mockResolvedValue({
      openid: 'openid-1',
    });

    await expect(service.getSessionByJsCode('wx-code')).rejects.toMatchObject({
      code: 'WECHAT_SESSION_KEY_MISSING',
    });
  });

  it('builds stable requestVirtualPayment signatures', () => {
    const service = createVirtualPayService();

    const result = service.buildVirtualPaymentParams({
      sessionKey: 'session-key',
      productId: 'vip_month_goods',
      orderNo: 'VIP202605010001',
      amount: 990,
      attach: '{"orderId":"1"}',
    });
    const expectedSignData = JSON.stringify({
      offerId: 'offer-1',
      buyQuantity: 1,
      env: 1,
      currencyType: 'CNY',
      productId: 'vip_month_goods',
      goodsPrice: 990,
      outTradeNo: 'VIP202605010001',
      attach: '{"orderId":"1"}',
      mode: 'short_series_goods',
    });

    expect(result.mode).toBe('short_series_goods');
    expect(result.signData).toBe(expectedSignData);
    expect(result.paySig).toBe(
      createHmac('sha256', 'sandbox-app-key')
        .update(`requestVirtualPayment&${expectedSignData}`)
        .digest('hex')
    );
    expect(result.signature).toBe(
      createHmac('sha256', 'session-key')
        .update(expectedSignData)
        .digest('hex')
    );
  });

  it('treats xpay query_order data missing as a pending order', async () => {
    const service = createVirtualPayService();

    (service as any).getMiniProgramAccessToken = jest
      .fn()
      .mockResolvedValue('access-token');
    (service as any).postJson = jest.fn().mockResolvedValue({
      errcode: 268490002,
      errmsg: '数据不存在',
    });

    await expect(
      service.queryVirtualOrder({
        openid: 'openid-1',
        orderNo: 'VIP202606010001',
        env: 1,
      })
    ).resolves.toBeNull();
  });

  it('does not treat generic xpay query_order parameter errors as missing data', async () => {
    const service = createVirtualPayService();

    (service as any).getMiniProgramAccessToken = jest
      .fn()
      .mockResolvedValue('access-token');
    (service as any).postJson = jest.fn().mockResolvedValue({
      errcode: 268490002,
      errmsg: '请求参数字段错误',
    });

    await expect(
      service.queryVirtualOrder({
        openid: 'openid-1',
        orderNo: 'VIP202606010001',
        env: 1,
      })
    ).rejects.toMatchObject({
      code: 'WECHAT_VIRTUAL_PAY_API_FAILED',
      data: {
        errcode: 268490002,
        errmsg: '请求参数字段错误',
      },
    });
  });

  it('calls msgSecCheck v2 with the comment scene', async () => {
    const service = createVirtualPayService();

    (service as any).getMiniProgramAccessToken = jest
      .fn()
      .mockResolvedValue('access-token');
    (service as any).postJson = jest.fn().mockResolvedValue({
      errcode: 0,
      result: {
        suggest: 'pass',
        label: 100,
      },
    });

    const result = await service.checkMessageContentSafety({
      openid: 'openid-1',
      content: '普通评论',
      scene: 2,
    });

    expect(result.isSafe).toBe(true);
    expect((service as any).postJson).toHaveBeenCalledWith(
      'https://api.weixin.qq.com/wxa/msg_sec_check?access_token=access-token',
      {
        version: 2,
        openid: 'openid-1',
        scene: 2,
        content: '普通评论',
      }
    );
  });

  it('refreshes access_token and retries msgSecCheck when cached token is invalid', async () => {
    const service = createVirtualPayService();
    const redisService = {
      get: jest.fn().mockResolvedValue('stale-token'),
      del: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
    };
    const postJson = jest.fn(async (url: string) => {
      if (
        url ===
        'https://api.weixin.qq.com/wxa/msg_sec_check?access_token=stale-token'
      ) {
        return {
          errcode: 40001,
          errmsg: 'invalid credential',
        };
      }

      if (url === 'https://api.weixin.qq.com/cgi-bin/stable_token') {
        return {
          access_token: 'fresh-token',
          expires_in: 7200,
        };
      }

      if (
        url ===
        'https://api.weixin.qq.com/wxa/msg_sec_check?access_token=fresh-token'
      ) {
        return {
          errcode: 0,
          result: {
            suggest: 'pass',
            label: 100,
          },
        };
      }

      throw new Error(`unexpected url: ${url}`);
    });

    (service as any).redisService = redisService;
    (service as any).logger = {
      warn: jest.fn(),
    };
    (service as any).postJson = postJson;

    const result = await service.checkMessageContentSafety({
      openid: 'openid-1',
      content: '普通评论',
      scene: 2,
    });

    expect(result.isSafe).toBe(true);
    expect(redisService.del).toHaveBeenCalledWith(
      'wechat:mini-program:access-token'
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'wechat:mini-program:access-token',
      'fresh-token',
      'EX',
      6900
    );
    expect(postJson).toHaveBeenCalledWith(
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      {
        grant_type: 'client_credential',
        appid: 'mini-app-id',
        secret: 'mini-app-secret',
        force_refresh: true,
      }
    );
  });

  it('treats non-pass msgSecCheck suggestions as unsafe', async () => {
    const service = createVirtualPayService();

    (service as any).getMiniProgramAccessToken = jest
      .fn()
      .mockResolvedValue('access-token');
    (service as any).postJson = jest.fn().mockResolvedValue({
      errcode: 0,
      result: {
        suggest: 'review',
        label: 20001,
      },
    });

    const result = await service.checkMessageContentSafety({
      openid: 'openid-1',
      content: '待复核评论',
    });

    expect(result).toEqual(
      expect.objectContaining({
        isSafe: false,
        suggest: 'review',
        label: 20001,
      })
    );
  });

  it('rejects msgSecCheck API failures', async () => {
    const service = createVirtualPayService();

    (service as any).getMiniProgramAccessToken = jest
      .fn()
      .mockResolvedValue('access-token');
    (service as any).postJson = jest.fn().mockResolvedValue({
      errcode: 40001,
      errmsg: 'invalid credential',
    });

    await expect(
      service.checkMessageContentSafety({
        openid: 'openid-1',
        content: '普通评论',
      })
    ).rejects.toMatchObject({
      code: 'WECHAT_MSG_SEC_CHECK_FAILED',
      status: 502,
    });
  });
});
