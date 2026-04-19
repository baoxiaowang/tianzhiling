import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/main_tab_page.dart';

enum AuthMode { phone, password }

class AuthPage extends StatefulWidget {
  const AuthPage({super.key});

  static const String routeName = '/auth';

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  static final RegExp _chinaPhoneRegExp = RegExp(r'^1[3-9]\d{9}$');

  AuthMode _mode = AuthMode.phone;
  int _modeDirection = 1;
  bool _agreed = true;
  bool _isSubmitting = false;
  bool _isSendingCode = false;
  int _codeCooldownSeconds = 0;
  Timer? _codeCooldownTimer;

  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _codeController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  bool get _isPhoneValid {
    return _chinaPhoneRegExp.hasMatch(_phoneController.text.trim());
  }

  @override
  void dispose() {
    _codeCooldownTimer?.cancel();
    _phoneController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  bool get _canSubmit {
    if (!_agreed || !_isPhoneValid || _isSubmitting) {
      return false;
    }

    switch (_mode) {
      case AuthMode.phone:
        return _codeController.text.trim().length == 6;
      case AuthMode.password:
        return _passwordController.text.trim().isNotEmpty;
    }
  }

  void _refresh() {
    setState(() {});
  }

  void _changeMode(AuthMode mode) {
    if (_mode == mode) {
      return;
    }

    setState(() {
      _modeDirection = mode.index > _mode.index ? 1 : -1;
      _mode = mode;
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

  Future<void> _submit() async {
    if (!_canSubmit) {
      final message = !_agreed
          ? '请先勾选用户协议与隐私政策'
          : !_isPhoneValid
          ? '请输入正确的中国大陆手机号'
          : _mode == AuthMode.phone
          ? '请输入 6 位短信验证码'
          : '请输入手机号和密码';

      _showSnackBar(message);
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    try {
      if (_mode == AuthMode.phone) {
        final session = await AuthApi.phoneLogin(
          phone: _phoneController.text.trim(),
          code: _codeController.text.trim(),
        );
        _showSnackBar(session.isNewUser ? '首次登录成功，已为你创建账号' : '登录成功');
      } else {
        await AuthApi.passwordLogin(
          account: _phoneController.text.trim(),
          password: _passwordController.text.trim(),
        );
        _showSnackBar('登录成功');
      }

      if (!mounted) {
        return;
      }

      Navigator.of(
        context,
      ).pushReplacement(MaterialPageRoute(builder: (_) => const MainTabPage()));
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

  Future<void> _sendCode() async {
    if (!_isPhoneValid || _isSendingCode || _codeCooldownSeconds > 0) {
      if (!_isPhoneValid) {
        _showSnackBar('请输入正确的中国大陆手机号');
      }
      return;
    }

    setState(() {
      _isSendingCode = true;
    });

    try {
      final result = await AuthApi.sendSmsCode(_phoneController.text.trim());
      _startCodeCooldown(result.resendAfterSeconds);
      final debugCodeHint =
          kDebugMode && (result.debugCode?.isNotEmpty ?? false)
          ? '，测试验证码：${result.debugCode}'
          : '';
      _showSnackBar('验证码已发送，请注意查收$debugCodeHint');
    } on ApiException catch (error) {
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('验证码发送失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isSendingCode = false;
        });
      }
    }
  }

  void _startCodeCooldown(int seconds) {
    _codeCooldownTimer?.cancel();

    setState(() {
      _codeCooldownSeconds = seconds;
    });

    _codeCooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }

      if (_codeCooldownSeconds <= 1) {
        timer.cancel();
        setState(() {
          _codeCooldownSeconds = 0;
        });
        return;
      }

      setState(() {
        _codeCooldownSeconds -= 1;
      });
    });
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
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
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
                            SizedBox(height: 34 * scale),
                            _AuthTabs(
                              scale: scale,
                              mode: _mode,
                              onChanged: _changeMode,
                            ),
                            SizedBox(height: 26 * scale),
                            _AuthForm(
                              scale: scale,
                              mode: _mode,
                              modeDirection: _modeDirection,
                              phoneController: _phoneController,
                              codeController: _codeController,
                              passwordController: _passwordController,
                              onChanged: (_) => _refresh(),
                              canSendCode:
                                  _isPhoneValid &&
                                  !_isSendingCode &&
                                  _codeCooldownSeconds == 0,
                              sendCodeLabel: _isSendingCode
                                  ? '发送中...'
                                  : _codeCooldownSeconds > 0
                                  ? '${_codeCooldownSeconds}s'
                                  : '获取验证码',
                              onSendCode: _sendCode,
                            ),
                            SizedBox(height: 28 * scale),
                            _PrimaryLoginButton(
                              scale: scale,
                              enabled: _canSubmit,
                              loading: _isSubmitting,
                              onTap: _submit,
                            ),
                            SizedBox(height: 42 * scale),
                            _OrDivider(scale: scale),
                            SizedBox(height: 28 * scale),
                            _WeChatLogin(
                              scale: scale,
                              onTap: () => _showSnackBar('微信登录暂未接入'),
                            ),
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
          '欢迎使用天之灵',
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

class _AuthTabs extends StatelessWidget {
  const _AuthTabs({
    required this.scale,
    required this.mode,
    required this.onChanged,
  });

  final double scale;
  final AuthMode mode;
  final ValueChanged<AuthMode> onChanged;

  @override
  Widget build(BuildContext context) {
    const phoneTitle = '手机号登陆/注册';
    const passwordTitle = '密码登陆';
    final gap = 32 * scale;
    final phoneActiveWidth = _measureTabWidth(
      context,
      phoneTitle,
      scale,
      active: true,
    );
    final phoneInactiveWidth = _measureTabWidth(
      context,
      phoneTitle,
      scale,
      active: false,
    );
    final passwordActiveWidth = _measureTabWidth(
      context,
      passwordTitle,
      scale,
      active: true,
    );
    final passwordInactiveWidth = _measureTabWidth(
      context,
      passwordTitle,
      scale,
      active: false,
    );
    final phoneSlotWidth = phoneActiveWidth > phoneInactiveWidth
        ? phoneActiveWidth
        : phoneInactiveWidth;
    final passwordSlotWidth = passwordActiveWidth > passwordInactiveWidth
        ? passwordActiveWidth
        : passwordInactiveWidth;
    final indicatorLeft = mode == AuthMode.phone ? 0.0 : phoneSlotWidth + gap;
    final indicatorWidth = mode == AuthMode.phone
        ? phoneActiveWidth
        : passwordActiveWidth;

    return Align(
      alignment: Alignment.centerLeft,
      child: SizedBox(
        width: phoneSlotWidth + gap + passwordSlotWidth,
        height: 36 * scale,
        child: Stack(
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: phoneSlotWidth,
                  child: _AuthTabItem(
                    scale: scale,
                    title: phoneTitle,
                    active: mode == AuthMode.phone,
                    onTap: () => onChanged(AuthMode.phone),
                  ),
                ),
                SizedBox(width: gap),
                SizedBox(
                  width: passwordSlotWidth,
                  child: _AuthTabItem(
                    scale: scale,
                    title: passwordTitle,
                    active: mode == AuthMode.password,
                    onTap: () => onChanged(AuthMode.password),
                  ),
                ),
              ],
            ),
            AnimatedPositioned(
              duration: const Duration(milliseconds: 360),
              curve: Curves.easeInOutCubicEmphasized,
              left: indicatorLeft,
              bottom: 0,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 360),
                curve: Curves.easeInOutCubicEmphasized,
                width: indicatorWidth,
                height: 4 * scale,
                decoration: BoxDecoration(
                  color: _AuthColors.accent,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  double _measureTabWidth(
    BuildContext context,
    String text,
    double scale, {
    required bool active,
  }) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontSize: 18 * scale,
          fontWeight: active ? FontWeight.w600 : FontWeight.w500,
        ),
      ),
      maxLines: 1,
      textDirection: Directionality.of(context),
    )..layout();

    return painter.width;
  }
}

class _AuthTabItem extends StatelessWidget {
  const _AuthTabItem({
    required this.scale,
    required this.title,
    required this.active,
    required this.onTap,
  });

  final double scale;
  final String title;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.only(bottom: 14 * scale),
        child: AnimatedDefaultTextStyle(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          style: TextStyle(
            fontSize: 18 * scale,
            fontWeight: active ? FontWeight.w600 : FontWeight.w500,
            color: active ? _AuthColors.textPrimary : const Color(0xFF9CA3AF),
          ),
          child: Text(title),
        ),
      ),
    );
  }
}

class _AuthForm extends StatelessWidget {
  const _AuthForm({
    required this.scale,
    required this.mode,
    required this.modeDirection,
    required this.phoneController,
    required this.codeController,
    required this.passwordController,
    required this.onChanged,
    required this.canSendCode,
    required this.sendCodeLabel,
    required this.onSendCode,
  });

  final double scale;
  final AuthMode mode;
  final int modeDirection;
  final TextEditingController phoneController;
  final TextEditingController codeController;
  final TextEditingController passwordController;
  final ValueChanged<String> onChanged;
  final bool canSendCode;
  final String sendCodeLabel;
  final VoidCallback onSendCode;

  @override
  Widget build(BuildContext context) {
    final activeKey = ValueKey<AuthMode>(mode);

    return Column(
      children: [
        _InputCard(
          scale: scale,
          icon: Icons.phone_android_rounded,
          child: _InlineField(
            controller: phoneController,
            hintText: '请输入手机号',
            keyboardType: TextInputType.phone,
            scale: scale,
            onChanged: onChanged,
          ),
        ),
        SizedBox(height: 16 * scale),
        AnimatedSize(
          duration: const Duration(milliseconds: 420),
          curve: Curves.easeInOutCubicEmphasized,
          alignment: Alignment.topCenter,
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 460),
            reverseDuration: const Duration(milliseconds: 320),
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeInCubic,
            layoutBuilder: (currentChild, previousChildren) {
              return Stack(
                alignment: Alignment.topCenter,
                children: [
                  ...previousChildren,
                  ...?(currentChild != null ? [currentChild] : null),
                ],
              );
            },
            transitionBuilder: (child, animation) {
              final isIncoming = child.key == activeKey;
              final fade = CurvedAnimation(
                parent: animation,
                curve: Curves.easeOutCubic,
              );
              final slide = Tween<Offset>(
                begin: isIncoming
                    ? Offset(modeDirection * 0.18, 0.02)
                    : Offset(-modeDirection * 0.14, -0.01),
                end: Offset.zero,
              ).animate(fade);
              final scaleAnimation = Tween<double>(
                begin: isIncoming ? 0.97 : 0.94,
                end: 1,
              ).animate(fade);

              return ClipRect(
                child: FadeTransition(
                  opacity: fade,
                  child: SlideTransition(
                    position: slide,
                    child: ScaleTransition(scale: scaleAnimation, child: child),
                  ),
                ),
              );
            },
            child: mode == AuthMode.phone
                ? _InputCard(
                    key: const ValueKey(AuthMode.phone),
                    scale: scale,
                    icon: Icons.verified_user_outlined,
                    child: Row(
                      children: [
                        Expanded(
                          child: _InlineField(
                            controller: codeController,
                            hintText: '请输入验证码',
                            keyboardType: TextInputType.number,
                            scale: scale,
                            onChanged: onChanged,
                          ),
                        ),
                        SizedBox(width: 10 * scale),
                        _MiniGradientButton(
                          scale: scale,
                          label: sendCodeLabel,
                          enabled: canSendCode,
                          onTap: onSendCode,
                        ),
                      ],
                    ),
                  )
                : _InputCard(
                    key: const ValueKey(AuthMode.password),
                    scale: scale,
                    icon: Icons.lock_outline_rounded,
                    child: _InlineField(
                      controller: passwordController,
                      hintText: '请输入密码',
                      scale: scale,
                      obscureText: true,
                      onChanged: onChanged,
                    ),
                  ),
          ),
        ),
      ],
    );
  }
}

class _InputCard extends StatelessWidget {
  const _InputCard({
    super.key,
    required this.scale,
    required this.icon,
    required this.child,
  });

  final double scale;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 50,
      padding: EdgeInsets.symmetric(horizontal: 16 * scale),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14 * scale),
        border: Border.all(color: const Color(0xFFF3F4F6)),
        boxShadow: [
          BoxShadow(
            color: const Color(0x14000000),
            blurRadius: 14 * scale,
            offset: Offset(0, 4 * scale),
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(icon, size: 24 * scale, color: const Color(0xFF9CA3AF)),
          SizedBox(width: 12 * scale),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _InlineField extends StatelessWidget {
  const _InlineField({
    required this.controller,
    required this.hintText,
    required this.scale,
    required this.onChanged,
    this.keyboardType,
    this.obscureText = false,
  });

  final TextEditingController controller;
  final String hintText;
  final double scale;
  final ValueChanged<String> onChanged;
  final TextInputType? keyboardType;
  final bool obscureText;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: onChanged,
      keyboardType: keyboardType,
      obscureText: obscureText,
      style: TextStyle(fontSize: 16 * scale, color: _AuthColors.textPrimary),
      decoration: InputDecoration(
        isCollapsed: true,
        border: InputBorder.none,
        hintText: hintText,
        hintStyle: TextStyle(
          fontSize: 16 * scale,
          color: const Color(0xFF9CA3AF),
        ),
      ),
    );
  }
}

class _MiniGradientButton extends StatelessWidget {
  const _MiniGradientButton({
    required this.scale,
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  final double scale;
  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final backgroundGradient = enabled
        ? const [Color(0xFFFC7A4E), Color(0xFFFF603A)]
        : const [Color(0xFFE5E7EB), Color(0xFFD1D5DB)];
    final textColor = enabled ? Colors.white : const Color(0xFF9CA3AF);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        gradient: LinearGradient(colors: backgroundGradient),
        boxShadow: enabled
            ? [
                BoxShadow(
                  color: const Color(0x40FF603A),
                  blurRadius: 12 * scale,
                  offset: Offset(0, 4 * scale),
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            height: 30,
            alignment: Alignment.center,
            padding: EdgeInsets.symmetric(horizontal: 16 * scale),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 14 * scale,
                fontWeight: FontWeight.w500,
                color: textColor,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PrimaryLoginButton extends StatelessWidget {
  const _PrimaryLoginButton({
    required this.scale,
    required this.enabled,
    required this.loading,
    required this.onTap,
  });

  final double scale;
  final bool enabled;
  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = enabled
        ? const [Color(0xFFFC7A4E), Color(0xFFFF603A)]
        : const [Color(0xFFF0A58A), Color(0xFFE99E8E)];

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        gradient: LinearGradient(colors: colors),
        boxShadow: [
          BoxShadow(
            color: const Color(0x40FF603A),
            blurRadius: 12 * scale,
            offset: Offset(0, 4 * scale),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 16 * scale),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: loading
                  ? SizedBox(
                      key: const ValueKey('loading'),
                      width: 22 * scale,
                      height: 22 * scale,
                      child: const CircularProgressIndicator(
                        strokeWidth: 2.4,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : Text(
                      '登陆',
                      key: const ValueKey('label'),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 18 * scale,
                        fontWeight: FontWeight.w500,
                        color: Colors.white,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OrDivider extends StatelessWidget {
  const _OrDivider({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Divider(color: Color(0xFFE5E7EB), thickness: 1)),
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 16 * scale),
          child: Text(
            'or',
            style: TextStyle(
              fontSize: 14 * scale,
              fontWeight: FontWeight.w500,
              color: const Color(0xFF9CA3AF),
            ),
          ),
        ),
        const Expanded(child: Divider(color: Color(0xFFE5E7EB), thickness: 1)),
      ],
    );
  }
}

class _WeChatLogin extends StatelessWidget {
  const _WeChatLogin({required this.scale, required this.onTap});

  final double scale;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        children: [
          GestureDetector(
            onTap: onTap,
            child: Container(
              width: 56 * scale,
              height: 56 * scale,
              decoration: const BoxDecoration(
                color: Color(0xFF07C160),
                shape: BoxShape.circle,
              ),
              child: _WeChatGlyph(scale: scale),
            ),
          ),
          SizedBox(height: 8 * scale),
          Text(
            '微信一键登录',
            style: TextStyle(
              fontSize: 12 * scale,
              color: const Color(0xFF6B7280),
            ),
          ),
        ],
      ),
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
                children: const [
                  TextSpan(text: '我已阅读并同意'),
                  TextSpan(
                    text: '《天之灵用户服务协议》',
                    style: TextStyle(color: Color(0xFF374151)),
                  ),
                  TextSpan(text: '及'),
                  TextSpan(
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
