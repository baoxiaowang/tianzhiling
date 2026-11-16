import 'package:flutter/foundation.dart';

/// 接口地址配置。
///
/// 生产构建（微信登录使用开放平台 AppID，与 API 地址一起用 --dart-define 注入）：
///   flutter build apk --release \
///     --dart-define=API_BASE_URL=https://tianzhiling.chat \
///     --dart-define=MEDIA_BASE_URL=https://oss.tianzhiling.chat \
///     --dart-define=WECHAT_APP_ID=wx1234567890abcdef
///
/// iOS 另外需要（Universal Link 由开放平台后台配置）：
///   + --dart-define=WECHAT_UNIVERSAL_LINK=https://tianzhiling.chat/app/
///
/// 本地不传 API_BASE_URL 时按平台取默认调试地址；不传 WECHAT_APP_ID 时
/// 登录页会明确提示「未配置微信登录参数」。
class ApiConfig {
  ApiConfig._();

  static const String _localhostBaseUrl = 'http://192.168.0.111:7001';
  static const String _androidEmulatorBaseUrl = 'http://10.0.2.2:7001';
  static const String _defaultMediaBaseUrl = 'https://oss.tianzhiling.chat';

  static String get baseUrl {
    const configured = String.fromEnvironment('API_BASE_URL');

    if (configured.isNotEmpty) {
      return configured;
    }

    if (kIsWeb) {
      return _localhostBaseUrl;
    }

    if (defaultTargetPlatform == TargetPlatform.android) {
      return _androidEmulatorBaseUrl;
    }

    return _localhostBaseUrl;
  }

  static String get mediaBaseUrl {
    const configured = String.fromEnvironment('MEDIA_BASE_URL');

    if (configured.isNotEmpty) {
      return configured;
    }

    return _defaultMediaBaseUrl;
  }
}
