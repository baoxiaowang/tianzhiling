import 'package:flutter/foundation.dart';

class ApiConfig {
  ApiConfig._();

  static const String _localhostBaseUrl = 'http://192.168.0.111:7001';
  static const String _androidEmulatorBaseUrl = 'http://10.0.2.2:7001';
  static const String _defaultMediaBaseUrl = 'https://oss.soullink.top';

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
