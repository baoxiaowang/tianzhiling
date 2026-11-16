import 'package:flutter/material.dart';

import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/auth/wechat_auth_client.dart';
import 'package:tianzhiling_app/config/brand_config.dart';
import 'package:tianzhiling_app/main_tab_page.dart';

/// 微信登录环境状态，用于给用户明确提示。
enum _WechatAvailability {
  checking,
  unconfigured,
  notInstalled,
  ready,
}

/// 登录页：仅保留微信一键登录（2026-11-16 拍板，无备用登录通道）。
class AuthPage extends StatefulWidget {
  const AuthPage({super.key, this.wechatAuthClient});

  static const String routeName = '/auth';

  /// 单测注入假实现用；线上传 null 时使用 fluwx 实现。
  final WechatAuthClient? wechatAuthClient;

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  late final WechatAuthClient _wechatAuthClient;
  _WechatAvailability _availability = _WechatAvailability.checking;
  bool _agreed = true;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _wechatAuthClient = widget.wechatAuthClient ?? FluwxWechatAuthClient();
    _checkWechatAvailability();
  }

  Future<void> _checkWechatAvailability() async {
    if (!_wechatAuthClient.isConfigured) {
      if (mounted) {
        setState(() {
          _availability = _WechatAvailability.unconfigured;
        });
      }
      return;
    }

    final installed = await _wechatAuthClient.isWeChatInstalled();

    if (!mounted) {
      return;
    }

    setState(() {
      _availability = installed
          ? _WechatAvailability.ready
          : _WechatAvailability.notInstalled;
    });
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _login() async {
    if (_isSubmitting) {
      return;
    }

    if (!_agreed) {
      _showSnackBar('请先阅读并勾选用户协议与隐私政策');
      return;
    }

    if (_availability == _WechatAvailability.unconfigured) {
      _showSnackBar('当前安装包未配置微信登录参数，暂时无法登录');
      return;
    }

    if (_availability == _WechatAvailability.notInstalled) {
      _showSnackBar('未检测到微信，请先安装微信后再登录');
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    try {
      final code = await _wechatAuthClient.requestAuthCode();
      final session = await AuthApi.wechatLogin(code: code);

      _showSnackBar(
        session.isNewUser ? '首次登录成功，已为你创建账号' : '登录成功',
      );

      if (!mounted) {
        return;
      }

      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const MainTabPage()),
      );
    } on WechatAuthException catch (error) {
      if (error.failure == WechatAuthFailure.notConfigured) {
        _markUnconfigured();
      } else if (error.failure == WechatAuthFailure.notInstalled) {
        if (mounted) {
          setState(() {
            _availability = _WechatAvailability.notInstalled;
          });
        }
      }
      _showSnackBar(error.message);
    } on ApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('登录失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  void _markUnconfigured() {
    if (!mounted) {
      return;
    }

    setState(() {
      _availability = _WechatAvailability.unconfigured;
    });
  }

  String get _availabilityHint {
    switch (_availability) {
      case _WechatAvailability.checking:
        return '正在检测微信环境…';
      case _WechatAvailability.unconfigured:
        return '当前安装包未配置微信登录参数，暂时无法登录';
      case _WechatAvailability.notInstalled:
        return '未检测到微信，请先安装微信后再登录';
      case _WechatAvailability.ready:
        return '将打开微信完成授权登录';
    }
  }

  IconData get _availabilityIcon {
    switch (_availability) {
      case _WechatAvailability.checking:
        return Icons.hourglass_top_rounded;
      case _WechatAvailability.unconfigured:
      case _WechatAvailability.notInstalled:
        return Icons.info_outline_rounded;
      case _WechatAvailability.ready:
        return Icons.verified_user_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final bottomInset = mediaQuery.viewInsets.bottom;

    return Scaffold(
      backgroundColor: _AuthColors.background,
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              _AuthColors.backgroundTop,
              Color(0xFFFFF6EA),
              Colors.white,
            ],
            stops: [0, 0.42, 1],
          ),
        ),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final scale = (constraints.maxWidth / 390).clamp(0.9, 1.08);

              return Column(
                children: [
                  Expanded(
                    child: SingleChildScrollView(
                      padding: EdgeInsets.fromLTRB(
                        24 * scale,
                        14 * scale,
                        24 * scale,
                        18 * scale,
                      ),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight: constraints.maxHeight - 110 * scale,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _HeaderBar(
                              scale: scale,
                              onBack: () => Navigator.of(context).maybePop(),
                            ),
                            SizedBox(height: 28 * scale),
                            _GreetingBlock(scale: scale),
                            SizedBox(height: 56 * scale),
                            _WechatLoginPanel(scale: scale),
                            SizedBox(height: 36 * scale),
                            _WechatLoginButton(
                              scale: scale,
                              loading: _isSubmitting,
                              onTap: _login,
                            ),
                            SizedBox(height: 18 * scale),
                            _AvailabilityHint(
                              scale: scale,
                              icon: _availabilityIcon,
                              message: _availabilityHint,
                              warning:
                                  _availability ==
                                      _WechatAvailability.unconfigured ||
                                  _availability ==
                                      _WechatAvailability.notInstalled,
                            ),
                            SizedBox(height: 28 * scale),
                          ],
                        ),
                      ),
                    ),
                  ),
                  AnimatedPadding(
                    duration: const Duration(milliseconds: 220),
                    curve: Curves.easeOut,
                    padding: EdgeInsets.fromLTRB(
                      24 * scale,
                      6 * scale,
                      24 * scale,
                      bottomInset > 0 ? 12 * scale : 28 * scale,
                    ),
                    child: _AgreementFooter(
                      scale: scale,
                      agreed: _agreed,
                      onTap: () {
                        setState(() {
                          _agreed = !_agreed;
                        });
                      },
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _HeaderBar extends StatelessWidget {
  const _HeaderBar({required this.scale, required this.onBack});

  final double scale;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _HeaderCircleButton(
          scale: scale,
          icon: Icons.arrow_back_ios_new_rounded,
          onTap: onBack,
        ),
      ],
    );
  }
}

class _HeaderCircleButton extends StatelessWidget {
  const _HeaderCircleButton({
    required this.scale,
    required this.icon,
    required this.onTap,
  });

  final double scale;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: EdgeInsets.all(6 * scale),
          child: Icon(icon, size: 22 * scale, color: _AuthColors.textPrimary),
        ),
      ),
    );
  }
}

class _GreetingBlock extends StatelessWidget {
  const _GreetingBlock({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Hello!',
          style: TextStyle(
            fontSize: 36 * scale,
            fontWeight: FontWeight.w700,
            height: 1.05,
            letterSpacing: -0.8,
            color: _AuthColors.textPrimary,
          ),
        ),
        SizedBox(height: 8 * scale),
        Text(
          '欢迎使用${BrandConfig.name}',
          style: TextStyle(
            fontSize: 20 * scale,
            fontWeight: FontWeight.w600,
            color: _AuthColors.textSecondary,
          ),
        ),
      ],
    );
  }
}

class _WechatLoginPanel extends StatelessWidget {
  const _WechatLoginPanel({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 20 * scale,
        vertical: 24 * scale,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20 * scale),
        border: Border.all(color: const Color(0xFFF3F4F6)),
        boxShadow: [
          BoxShadow(
            color: const Color(0x14000000),
            blurRadius: 18 * scale,
            offset: Offset(0, 6 * scale),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 56 * scale,
            height: 56 * scale,
            decoration: const BoxDecoration(
              color: Color(0xFF07C160),
              shape: BoxShape.circle,
            ),
            child: _WeChatGlyph(scale: scale),
          ),
          SizedBox(width: 16 * scale),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '微信一键登录',
                  style: TextStyle(
                    fontSize: 18 * scale,
                    fontWeight: FontWeight.w600,
                    color: _AuthColors.textPrimary,
                  ),
                ),
                SizedBox(height: 6 * scale),
                Text(
                  '登录后可与小程序共享同一账号与会员权益',
                  style: TextStyle(
                    fontSize: 13 * scale,
                    height: 1.35,
                    color: const Color(0xFF6B7280),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _WechatLoginButton extends StatelessWidget {
  const _WechatLoginButton({
    required this.scale,
    required this.loading,
    required this.onTap,
  });

  final double scale;
  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        gradient: const LinearGradient(
          colors: [Color(0xFF2BD97C), Color(0xFF07C160)],
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0x3D07C160),
            blurRadius: 14 * scale,
            offset: Offset(0, 5 * scale),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: loading ? null : onTap,
          borderRadius: BorderRadius.circular(999),
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 16 * scale),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: loading
                  ? SizedBox(
                      key: const ValueKey('wechat-login-loading'),
                      width: 22 * scale,
                      height: 22 * scale,
                      child: const CircularProgressIndicator(
                        strokeWidth: 2.4,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : Row(
                      key: const ValueKey('wechat-login-label'),
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.wechat_rounded,
                          size: 22 * scale,
                          color: Colors.white,
                        ),
                        SizedBox(width: 8 * scale),
                        Text(
                          '微信登录',
                          style: TextStyle(
                            fontSize: 18 * scale,
                            fontWeight: FontWeight.w500,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AvailabilityHint extends StatelessWidget {
  const _AvailabilityHint({
    required this.scale,
    required this.icon,
    required this.message,
    required this.warning,
  });

  final double scale;
  final IconData icon;
  final String message;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final color = warning
        ? const Color(0xFFB45309)
        : const Color(0xFF6B7280);

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16 * scale, color: color),
        SizedBox(width: 6 * scale),
        Flexible(
          child: Text(
            message,
            style: TextStyle(fontSize: 13 * scale, height: 1.35, color: color),
          ),
        ),
      ],
    );
  }
}

class _AgreementFooter extends StatelessWidget {
  const _AgreementFooter({
    required this.scale,
    required this.agreed,
    required this.onTap,
  });

  final double scale;
  final bool agreed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 20 * scale,
            height: 20 * scale,
            margin: EdgeInsets.only(top: 1 * scale),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: agreed ? _AuthColors.accent : const Color(0xFFD1D5DB),
              ),
              color: agreed ? _AuthColors.accent : Colors.transparent,
            ),
            child: agreed
                ? Center(
                    child: Container(
                      width: 8 * scale,
                      height: 8 * scale,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                    ),
                  )
                : null,
          ),
          SizedBox(width: 8 * scale),
          Expanded(
            child: Text.rich(
              TextSpan(
                style: TextStyle(
                  fontSize: 12 * scale,
                  height: 1.4,
                  color: const Color(0xFF6B7280),
                ),
                children: [
                  const TextSpan(text: '我已阅读并同意'),
                  TextSpan(
                    text: '《${BrandConfig.name}用户服务协议》',
                    style: const TextStyle(color: Color(0xFF374151)),
                  ),
                  const TextSpan(text: '及'),
                  const TextSpan(
                    text: '《隐私政策》',
                    style: TextStyle(color: Color(0xFF374151)),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WeChatGlyph extends StatelessWidget {
  const _WeChatGlyph({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        Positioned(
          left: 13 * scale,
          top: 13 * scale,
          child: Container(
            width: 24 * scale,
            height: 19 * scale,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12 * scale),
            ),
            child: Stack(
              children: [
                Positioned(
                  left: 6 * scale,
                  top: 7 * scale,
                  child: _WeChatDot(size: 3.2 * scale),
                ),
                Positioned(
                  right: 6 * scale,
                  top: 7 * scale,
                  child: _WeChatDot(size: 3.2 * scale),
                ),
              ],
            ),
          ),
        ),
        Positioned(
          right: 11 * scale,
          bottom: 13 * scale,
          child: Container(
            width: 20 * scale,
            height: 17 * scale,
            decoration: BoxDecoration(
              color: const Color(0xFFF0FFF3),
              borderRadius: BorderRadius.circular(10 * scale),
            ),
            child: Stack(
              children: [
                Positioned(
                  left: 5 * scale,
                  top: 6 * scale,
                  child: _WeChatDot(size: 2.8 * scale),
                ),
                Positioned(
                  right: 5 * scale,
                  top: 6 * scale,
                  child: _WeChatDot(size: 2.8 * scale),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _WeChatDot extends StatelessWidget {
  const _WeChatDot({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        color: Color(0xFF07C160),
        shape: BoxShape.circle,
      ),
    );
  }
}

class _AuthColors {
  static const background = Color(0xFFFFFAF4);
  static const backgroundTop = Color(0xFFFFE7C0);
  static const accent = Color(0xFFFF5A3E);
  static const textPrimary = Color(0xFF111827);
  static const textSecondary = Color(0xFF374151);
}
