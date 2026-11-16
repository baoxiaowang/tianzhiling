/// 微信开放平台移动应用配置（Flutter 端）
///
/// 与 [BrandConfig] 一致，全部通过 `--dart-define` 编译期注入，不硬编码 appid：
///
///   flutter run \
///     --dart-define=API_BASE_URL=https://tianzhiling.chat \
///     --dart-define=WECHAT_APP_ID=wx1234567890abcdef
///
/// iOS 还需要在开放平台后台配置 Universal Link，并在构建时同传：
///   --dart-define=WECHAT_UNIVERSAL_LINK=https://tianzhiling.chat/app/
///
/// 未注入 appid 时（本地默认）App 仍可编译运行，登录页会明确提示
/// “未配置微信登录”，不会回退到手机号等备用登录通道。
class WechatConfig {
  WechatConfig._();

  /// 微信开放平台移动应用 AppID，如 wx1234567890abcdef。
  static const String appId = String.fromEnvironment('WECHAT_APP_ID');

  /// iOS 微信 SDK 需要的 Universal Link（Android 可留空）。
  static const String universalLink =
      String.fromEnvironment('WECHAT_UNIVERSAL_LINK');

  static bool get isConfigured => appId.trim().isNotEmpty;
}
