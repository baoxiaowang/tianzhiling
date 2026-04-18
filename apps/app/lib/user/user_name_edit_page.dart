import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';

class UserNameEditPage extends StatefulWidget {
  const UserNameEditPage({super.key});

  static const String routeName = '/user-settings/name';

  @override
  State<UserNameEditPage> createState() => _UserNameEditPageState();
}

class _UserNameEditPageState extends State<UserNameEditPage> {
  late final TextEditingController _controller;
  final FocusNode _focusNode = FocusNode();
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: AuthSessionStore.session.value?.user.name ?? '',
    );
    _controller.addListener(_handleTextChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _requestInputFocus();
      }
    });
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_handleTextChanged)
      ..dispose();
    _focusNode.dispose();
    super.dispose();
  }

  String get _trimmedName => _controller.text.trim();

  String get _initialName =>
      AuthSessionStore.session.value?.user.name.trim() ?? '';

  bool get _canSubmit {
    return !_isSubmitting &&
        _trimmedName.isNotEmpty &&
        _trimmedName != _initialName &&
        _trimmedName.length <= 20;
  }

  void _handleTextChanged() {
    setState(() {});
  }

  Future<void> _requestInputFocus() async {
    FocusScope.of(context).requestFocus(_focusNode);
    await Future<void>.delayed(const Duration(milliseconds: 250));
    if (!mounted) {
      return;
    }
    FocusScope.of(context).requestFocus(_focusNode);
    await SystemChannels.textInput.invokeMethod<void>('TextInput.show');
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
      if (_trimmedName.isEmpty) {
        _showSnackBar('请输入昵称');
      } else if (_trimmedName.length > 20) {
        _showSnackBar('昵称最多 20 个字符');
      }
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    try {
      await AuthApi.updateDisplayName(_trimmedName);

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop(_trimmedName);
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await AuthSessionStore.clear();
        _showSnackBar(error.message);
        await Future<void>.delayed(const Duration(milliseconds: 500));
        if (!mounted) {
          return;
        }
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
        return;
      }
      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('昵称修改失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => FocusScope.of(context).unfocus(),
      child: Scaffold(
        backgroundColor: const Color(0xFFF5F5F5),
        body: SafeArea(
          child: Column(
            children: [
              Container(
                height: 44,
                color: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    GestureDetector(
                      onTap: () => Navigator.of(context).maybePop(),
                      behavior: HitTestBehavior.opaque,
                      child: const Text(
                        '取消',
                        style: TextStyle(
                          color: Color(0xFF333333),
                          fontSize: 16,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                    const Expanded(
                      child: Center(
                        child: Text(
                          '设置名字',
                          style: TextStyle(
                            color: Color(0xFF1A1A1A),
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                    GestureDetector(
                      onTap: _canSubmit ? _submit : null,
                      behavior: HitTestBehavior.opaque,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        height: 28,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          color: _canSubmit
                              ? const Color(0xFF07C160)
                              : const Color(0xFFF5F5F5),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          _isSubmitting ? '提交中' : '完成',
                          style: TextStyle(
                            color: _canSubmit
                                ? Colors.white
                                : const Color(0xFFD0D0D0),
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                margin: const EdgeInsets.only(top: 10),
                color: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        focusNode: _focusNode,
                        autofocus: true,
                        maxLength: 20,
                        keyboardType: TextInputType.name,
                        textInputAction: TextInputAction.done,
                        onSubmitted: (_) => _submit(),
                        decoration: const InputDecoration(
                          border: InputBorder.none,
                          counterText: '',
                        ),
                        style: const TextStyle(
                          color: Color(0xFF333333),
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    if (_controller.text.isNotEmpty)
                      GestureDetector(
                        onTap: () {
                          _controller.clear();
                          _focusNode.requestFocus();
                        },
                        child: const Icon(
                          Icons.cancel,
                          size: 18,
                          color: Color(0xFFC6C6C6),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
