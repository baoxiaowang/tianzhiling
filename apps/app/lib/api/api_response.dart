import 'dart:convert';

import 'package:tianzhiling_app/api/api_exception.dart';

class ApiResponse {
  const ApiResponse._({
    required this.success,
    required this.code,
    required this.message,
    required this.data,
  });

  final bool success;
  final String? code;
  final String message;
  final dynamic data;

  factory ApiResponse.fromRaw(dynamic raw, {int? statusCode}) {
    final decoded = _decode(raw);

    if (decoded is! Map<String, dynamic>) {
      throw ApiException(
        statusCode != null && statusCode >= 400 ? '请求失败，请稍后重试' : '服务返回了无法识别的数据',
        details: 'statusCode=$statusCode rawType=${raw.runtimeType}',
      );
    }

    final success = decoded['success'] as bool? ?? _isSuccessStatus(statusCode);
    final code = decoded['code'] as String?;
    final message =
        decoded['message'] as String? ?? _fallbackMessage(statusCode);

    if (!success) {
      throw ApiException.fromCode(
        code,
        fallback: message,
        details: 'statusCode=$statusCode code=$code message=$message',
      );
    }

    return ApiResponse._(
      success: success,
      code: code,
      message: message,
      data: decoded['data'],
    );
  }

  Map<String, dynamic> requireMapData() {
    if (data is Map<String, dynamic>) {
      return data as Map<String, dynamic>;
    }

    if (data is Map) {
      return (data as Map).cast<String, dynamic>();
    }

    return <String, dynamic>{};
  }

  static dynamic _decode(dynamic raw) {
    if (raw is Map<String, dynamic>) {
      return raw;
    }

    if (raw is Map) {
      return raw.cast<String, dynamic>();
    }

    if (raw is String) {
      if (raw.trim().isEmpty) {
        return const <String, dynamic>{};
      }

      return jsonDecode(raw);
    }

    return raw;
  }

  static bool _isSuccessStatus(int? statusCode) {
    return statusCode != null && statusCode >= 200 && statusCode < 300;
  }

  static String _fallbackMessage(int? statusCode) {
    if (statusCode == null) {
      return '请求失败';
    }

    if (statusCode >= 500) {
      return '服务开小差了，请稍后重试';
    }

    return '请求失败';
  }
}
