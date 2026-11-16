import 'dart:async';

import 'package:fluwx/fluwx.dart';
import 'package:tianzhiling_app/config/wechat_config.dart';

/// 微信登录失败原因，页面据此给出明确中文提示。
enum WechatAuthFailure {
  /// 安装包未注入 WECHAT_APP_ID（本地占位构建）。
  notConfigured,

  /// 设备未安装微信。拍板口径：无备用登录通道。
  notInstalled,

  /// 用户在微信内取消授权。
  cancelled,

  /// 其它失败（拉起失败、初始化失败、微信返回错误等）。
  failed,
}

class WechatAuthException implements Exception {
  const WechatAuthException(this.failure, this.message);

  final WechatAuthFailure failure;
  final String message;

  @override
  String toString() => message;
}

/// 微信授权登录客户端抽象，便于页面单测注入假实现（不触达真实微信）。
abstract class WechatAuthClient {
  /// 是否已注入开放平台 AppID。
  bool get isConfigured;

  /// 设备微信安装情况；插件不可用时按“未安装”处理。
  Future<bool> isWeChatInstalled();

  /// 拉起微信授权并返回授权 code（交给后端换 openid/unionid）。
  Future<String> requestAuthCode();
}

/// 基于 fluwx（微信开放平台官方 SDK 封装）的实现。
class FluwxWechatAuthClient implements WechatAuthClient {
  FluwxWechatAuthClient({
    Fluwx? fluwx,
    String? appId,
    String? universalLink,
    this.responseTimeout = const Duration(minutes: 2),
  }) : _fluwx = fluwx ?? Fluwx(),
       _appId = (appId ?? WechatConfig.appId).trim(),
       _universalLink =
           (universalLink ?? WechatConfig.universalLink).trim();

  final Fluwx _fluwx;
  final String _appId;
  final String _universalLink;
  final Duration responseTimeout;

  String? _registeredAppId;
  bool _authInFlight = false;

  @override
  bool get isConfigured => _appId.isNotEmpty;

  @override
  Future<bool> isWeChatInstalled() async {
    try {
      return await _fluwx.isWeChatInstalled;
    } catch (_) {
      // 宿主平台（如桌面/Web）没有微信 SDK 时按未安装处理。
      return false;
    }
  }

  @override
  Future<String> requestAuthCode() async {
    if (!isConfigured) {
      throw const WechatAuthException(
        WechatAuthFailure.notConfigured,
        '当前安装包未配置微信登录参数，暂时无法登录',
      );
    }

    if (_authInFlight) {
      throw const WechatAuthException(
        WechatAuthFailure.failed,
        '微信登录正在处理中，请稍候',
      );
    }

    _authInFlight = true;

    try {
      if (!await isWeChatInstalled()) {
        throw const WechatAuthException(
          WechatAuthFailure.notInstalled,
          '未检测到微信，请先安装微信后再登录',
        );
      }

      if (!await _ensureRegistered()) {
        throw const WechatAuthException(
          WechatAuthFailure.failed,
          '微信登录初始化失败，请稍后重试',
        );
      }

      final completer = Completer<WeChatAuthResponse>();
      final cancelable = _fluwx.addSubscriber((response) {
        if (response is WeChatAuthResponse && !completer.isCompleted) {
          completer.complete(response);
        }
      });

      try {
        final launched = await _fluwx.authBy(
          which: NormalAuth(
            scope: 'snsapi_userinfo',
            state: _buildAuthState(),
          ),
        );

        if (!launched) {
          throw const WechatAuthException(
            WechatAuthFailure.failed,
            '无法拉起微信，请确认微信版本后重试',
          );
        }

        final response = await completer.future.timeout(responseTimeout);
        final errCode = response.errCode;
        final authCode = response.code?.trim() ?? '';

        if (errCode == 0 && authCode.isNotEmpty) {
          return authCode;
        }

        if (errCode == -2) {
          throw const WechatAuthException(
            WechatAuthFailure.cancelled,
            '已取消微信登录',
          );
        }

        final errStr = response.errStr?.trim() ?? '';

        throw WechatAuthException(
          WechatAuthFailure.failed,
          errStr.isNotEmpty ? '微信登录失败：$errStr' : '微信登录失败，请稍后重试',
        );
      } on TimeoutException {
        throw const WechatAuthException(
          WechatAuthFailure.failed,
          '微信登录超时，请稍后重试',
        );
      } finally {
        cancelable.cancel();
      }
    } finally {
      _authInFlight = false;
    }
  }

  Future<bool> _ensureRegistered() async {
    if (_registeredAppId == _appId) {
      return true;
    }

    try {
      final registered = await _fluwx.registerApi(
        appId: _appId,
        universalLink: _universalLink.isEmpty ? null : _universalLink,
      );

      if (registered) {
        _registeredAppId = _appId;
      }

      return registered;
    } catch (_) {
      return false;
    }
  }

  String _buildAuthState() {
    return 'tzl_${DateTime.now().microsecondsSinceEpoch}';
  }
}
