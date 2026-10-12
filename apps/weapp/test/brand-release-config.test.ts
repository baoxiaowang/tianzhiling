/**
 * 品牌发布配置回归：域名、客服信息、工作台白名单都必须按品牌注入，
 * 未注入时才回落到天之灵默认值。
 *
 * 2026-09 的未了言支付事故根因就是「未了言构建用了天之灵的域名」，
 * 这里把品牌注入的不变量锁住。
 */
const BRAND_GLOBALS = [
  'BRAND',
  'BRAND_NAME',
  'BRAND_COMPANY',
  'BRAND_DOMAIN',
  'BRAND_ADMIN_DOMAIN',
  'BRAND_WEAPP_NAV_TITLE',
  'BRAND_WEAPP_APPID',
  'BRAND_WEAPP_API_BASE_URL',
  'BRAND_WEAPP_ASSET_BASE_URL',
  'BRAND_WEAPP_MEDIA_BASE_URL',
  'BRAND_CUSTOMER_SERVICE_PHONE',
  'BRAND_CUSTOMER_SERVICE_WECHAT_QR',
  'BRAND_CUSTOMER_SERVICE_EMAIL',
  'BRAND_CUSTOMER_SERVICE_WECHAT_ID',
] as const

type BrandGlobal = (typeof BRAND_GLOBALS)[number]

function setBrandGlobals(values: Partial<Record<BrandGlobal, string>>) {
  for (const name of BRAND_GLOBALS) {
    ;(globalThis as Record<string, unknown>)[name] = values[name]
  }
}

function loadBrand() {
  let brand: typeof import('../src/config/brand').brand | undefined
  jest.isolateModules(() => {
    brand = require('../src/config/brand').brand
  })
  return brand!
}

describe('weapp 品牌发布配置', () => {
  beforeEach(() => {
    // 不依赖 test/setup-brand.cjs：显式把编译期品牌常量声明为 undefined，
    // 保证这条用例在干净检出（无该 setup 文件）下也能跑。
    setBrandGlobals({})
  })

  afterEach(() => {
    setBrandGlobals({})
  })

  it('未注入品牌参数时回落到天之灵默认值', () => {
    const brand = loadBrand()

    expect(brand.key).toBe('tianzhiling')
    expect(brand.adminDomain).toBe('admin.tianzhiling.chat')
    expect(brand.weappApiBaseUrl).toBe('https://tianzhiling.chat')
    expect(brand.weappAssetBaseUrl).toBe('https://tianzhiling.chat')
    expect(brand.weappMediaBaseUrl).toBe('https://oss.tianzhiling.chat')
    expect(brand.customerService.email).toBe('support@tianzhiling.chat')
  })

  it('注入未了言参数后域名/客服信息/AppID 全部跟随品牌', () => {
    setBrandGlobals({
      BRAND: 'weiliaoyan',
      BRAND_NAME: '未了言',
      BRAND_DOMAIN: 'voloian.cn',
      BRAND_ADMIN_DOMAIN: 'admin.voloian.cn',
      BRAND_WEAPP_APPID: 'wx726227339067c7bb',
      BRAND_WEAPP_API_BASE_URL: 'https://voloian.cn',
      BRAND_WEAPP_ASSET_BASE_URL: 'https://voloian.cn',
      BRAND_WEAPP_MEDIA_BASE_URL: 'https://oss.voloian.cn',
      BRAND_CUSTOMER_SERVICE_EMAIL: 'support@voloian.cn',
    })
    const brand = loadBrand()

    expect(brand.key).toBe('weiliaoyan')
    expect(brand.name).toBe('未了言')
    expect(brand.weappAppid).toBe('wx726227339067c7bb')
    expect(brand.adminDomain).toBe('admin.voloian.cn')
    expect(brand.weappApiBaseUrl).toBe('https://voloian.cn')
    expect(brand.weappAssetBaseUrl).toBe('https://voloian.cn')
    expect(brand.weappMediaBaseUrl).toBe('https://oss.voloian.cn')
    expect(brand.customerService.email).toBe('support@voloian.cn')
  })

  it('声音工作台白名单只认本品牌管理后台域名', () => {
    const { validateVoiceWorkbenchUrlWithHost } = require('../src/utils/voice-workbench')
    const token = 'a'.repeat(48)
    const weiliaoyanUrl = `https://admin.voloian.cn/admin_api/agent_vt/p/avt_${token}`

    expect(
      validateVoiceWorkbenchUrlWithHost(weiliaoyanUrl, 'admin.voloian.cn')
    ).toBe(weiliaoyanUrl)
    expect(() =>
      validateVoiceWorkbenchUrlWithHost(weiliaoyanUrl, 'admin.tianzhiling.chat')
    ).toThrow('声音工作台地址不可用')
  })
})
