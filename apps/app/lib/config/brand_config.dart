/// 品牌配置（Flutter 端）
///
/// 单一真值源为仓库根目录 brand 目录下对应品牌的 json；本模块通过 --dart-define 编译期注入，
/// 不传任何参数时默认产出"天之灵"品牌。
///
/// 构建示例：
///   flutter build apk \
///     --dart-define=BRAND=weiliaoyan \
///     --dart-define=BRAND_NAME=未了言 \
///     --dart-define=BRAND_COMPANY=武汉市未了言智能技术有限公司 \
///     --dart-define=BRAND_WEAPP_NAV_TITLE=未了言
///
/// 注意：String.fromEnvironment 是编译期常量，可直接用于 const 表达式。
class BrandConfig {
  BrandConfig._();

  /// 品牌标识 key，如 tianzhiling / weiliaoyan
  static const String key = String.fromEnvironment('BRAND', defaultValue: 'tianzhiling');

  /// 产品名（也是智能体/实体名）
  static const String name = String.fromEnvironment('BRAND_NAME', defaultValue: '天之灵');

  /// 公司主体（协议与合规用）
  static const String companyName =
      String.fromEnvironment('BRAND_COMPANY', defaultValue: '武汉市天之灵智能技术有限公司');

  /// 客服热线
  static const String customerServicePhone =
      String.fromEnvironment('BRAND_CUSTOMER_SERVICE_PHONE', defaultValue: '19986943631');

  /// 客服微信二维码 OSS 路径
  static const String customerServiceWechatQr =
      String.fromEnvironment('BRAND_CUSTOMER_SERVICE_WECHAT_QR', defaultValue: '/weapp/service.png');

  /// 客服邮箱
  static const String customerServiceEmail =
      String.fromEnvironment('BRAND_CUSTOMER_SERVICE_EMAIL', defaultValue: 'support@tianzhiling.chat');

  /// 客服微信号（可选，用于展示）
  static const String customerServiceWechatId =
      String.fromEnvironment('BRAND_CUSTOMER_SERVICE_WECHAT_ID', defaultValue: '');
}
