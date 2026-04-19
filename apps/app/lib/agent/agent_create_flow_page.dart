import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/agent_api.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/storage_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';
import 'package:tianzhiling_app/user/avatar_editor_page.dart';
import 'package:image_picker/image_picker.dart';

enum _AgentFormStep {
  memorialName,
  gender,
  relationToThem,
  relationToMe,
  avatar,
}

enum _AgentGender { male, female }

class AgentCreateFlowPage extends StatefulWidget {
  const AgentCreateFlowPage({super.key});

  static const String routeName = '/agents/create/flow';
  static const String _backgroundAsset = 'assets/images/agent.png';

  @override
  State<AgentCreateFlowPage> createState() => _AgentCreateFlowPageState();
}

class _AgentCreateFlowPageState extends State<AgentCreateFlowPage> {
  final ImagePicker _imagePicker = ImagePicker();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _relationToThemController =
      TextEditingController();
  final TextEditingController _relationToMeController = TextEditingController();
  final FocusNode _textFocusNode = FocusNode();

  _AgentFormStep _currentStep = _AgentFormStep.memorialName;
  _AgentGender? _gender;
  bool _isSubmitting = false;
  bool _isUploadingAvatar = false;
  String _avatarPreviewUrl = '';
  String _avatarObjectKey = '';

  @override
  void initState() {
    super.initState();
    _syncFocus();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _relationToThemController.dispose();
    _relationToMeController.dispose();
    _textFocusNode.dispose();
    super.dispose();
  }

  String get _currentQuestion {
    switch (_currentStep) {
      case _AgentFormStep.memorialName:
        return '你纪念的人是？';
      case _AgentFormStep.gender:
        return '他的性别是？';
      case _AgentFormStep.relationToThem:
        return '你怎么称呼 TA？';
      case _AgentFormStep.relationToMe:
        return 'TA 怎么称呼你？';
      case _AgentFormStep.avatar:
        return '为 TA 选一张头像吧';
    }
  }

  String get _currentPlaceholder {
    switch (_currentStep) {
      case _AgentFormStep.memorialName:
        return '请输入 TA 的昵称或备注名';
      case _AgentFormStep.relationToThem:
        return '如：爷爷，奶奶';
      case _AgentFormStep.relationToMe:
        return '如：丫头，小宝';
      case _AgentFormStep.gender:
      case _AgentFormStep.avatar:
        return '';
    }
  }

  TextEditingController get _activeController {
    switch (_currentStep) {
      case _AgentFormStep.memorialName:
        return _nameController;
      case _AgentFormStep.relationToThem:
        return _relationToThemController;
      case _AgentFormStep.relationToMe:
        return _relationToMeController;
      case _AgentFormStep.gender:
      case _AgentFormStep.avatar:
        return _nameController;
    }
  }

  bool get _canContinue {
    if (_isSubmitting) {
      return false;
    }

    switch (_currentStep) {
      case _AgentFormStep.memorialName:
        return _nameController.text.trim().isNotEmpty;
      case _AgentFormStep.gender:
        return _gender != null;
      case _AgentFormStep.relationToThem:
        return _relationToThemController.text.trim().isNotEmpty;
      case _AgentFormStep.relationToMe:
        return _relationToMeController.text.trim().isNotEmpty;
      case _AgentFormStep.avatar:
        return !_isUploadingAvatar;
    }
  }

  List<_ChatEntry> get _history {
    final entries = <_ChatEntry>[];

    if (_nameController.text.trim().isNotEmpty) {
      entries.add(
        _ChatEntry(
          step: _AgentFormStep.memorialName,
          question: '你纪念的人是？',
          answer: _nameController.text.trim(),
        ),
      );
    }
    if (_gender != null) {
      entries.add(
        _ChatEntry(
          step: _AgentFormStep.gender,
          question: '他的性别是？',
          answer: _gender == _AgentGender.male ? '男' : '女',
        ),
      );
    }
    if (_relationToThemController.text.trim().isNotEmpty) {
      entries.add(
        _ChatEntry(
          step: _AgentFormStep.relationToThem,
          question: '你怎么称呼 TA？',
          answer: _relationToThemController.text.trim(),
        ),
      );
    }
    if (_relationToMeController.text.trim().isNotEmpty) {
      entries.add(
        _ChatEntry(
          step: _AgentFormStep.relationToMe,
          question: 'TA 怎么称呼你？',
          answer: _relationToMeController.text.trim(),
        ),
      );
    }

    final currentIndex = _AgentFormStep.values.indexOf(_currentStep);
    return entries.take(currentIndex).toList();
  }

  Future<void> _goToNextStep() async {
    if (!_canContinue) {
      return;
    }

    if (_currentStep == _AgentFormStep.avatar) {
      await _submitCreation();
      return;
    }

    setState(() {
      _currentStep = _AgentFormStep.values[_currentStep.index + 1];
    });

    _syncFocus();
  }

  void _goBack() {
    if (_isSubmitting) {
      return;
    }

    if (_currentStep == _AgentFormStep.memorialName) {
      Navigator.of(context).maybePop();
      return;
    }

    setState(() {
      _currentStep = _AgentFormStep.values[_currentStep.index - 1];
    });

    _syncFocus();
  }

  void _selectStep(_AgentFormStep step) {
    if (_isSubmitting || step == _currentStep) {
      return;
    }

    setState(() {
      _currentStep = step;
    });

    _syncFocus();
  }

  Future<void> _selectGender(_AgentGender value) async {
    if (_isSubmitting) {
      return;
    }

    setState(() {
      _gender = value;
    });

    await Future<void>.delayed(const Duration(milliseconds: 120));
    if (!mounted) {
      return;
    }
    await _goToNextStep();
  }

  Future<void> _submitCreation() async {
    if (_isSubmitting || _isUploadingAvatar) {
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    try {
      var agent = await AgentApi.createAgent(
        name: _nameController.text.trim(),
        sex: _gender == _AgentGender.male ? 1 : 0,
        iCallAgent: _relationToThemController.text.trim(),
        agentCallMe: _relationToMeController.text.trim(),
      );

      if (_avatarObjectKey.trim().isNotEmpty) {
        agent = await AgentApi.updateAgentAvatar(agent.id, _avatarObjectKey);
      }

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop(agent);
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await AuthSessionStore.clear();
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
      _showSnackBar('创建 Agent 失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
      );
  }

  void _syncFocus() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }

      if (_currentStep == _AgentFormStep.gender ||
          _currentStep == _AgentFormStep.avatar ||
          _isSubmitting ||
          _isUploadingAvatar) {
        FocusScope.of(context).unfocus();
        return;
      }

      FocusScope.of(context).requestFocus(_textFocusNode);
    });
  }

  Future<void> _handleAvatarTap() async {
    if (_isSubmitting || _isUploadingAvatar) {
      return;
    }

    try {
      final selected = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 92,
        maxWidth: 2048,
        requestFullMetadata: false,
      );

      if (selected == null || !mounted) {
        return;
      }

      final uploadSource = await AvatarEditorPage.edit(context, selected);

      if (uploadSource == null || !mounted) {
        return;
      }

      setState(() {
        _isUploadingAvatar = true;
      });

      final upload = await StorageApi.uploadImage(
        XFile(
          uploadSource.path,
          mimeType: 'image/jpeg',
          name: _buildAvatarFileName(selected),
        ),
        folder: 'avatars',
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _avatarPreviewUrl = upload.publicUrl;
        _avatarObjectKey = upload.objectKey;
      });
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await AuthSessionStore.clear();
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
      _showSnackBar('头像上传失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isUploadingAvatar = false;
        });
      }
    }
  }

  String _buildAvatarFileName(XFile selected) {
    final name = selected.name.trim();

    if (name.isNotEmpty) {
      return name;
    }

    return 'agent_avatar_${DateTime.now().millisecondsSinceEpoch}.jpg';
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final bottomInset = mediaQuery.viewInsets.bottom;
    final bottomSafeArea = mediaQuery.padding.bottom;

    return GestureDetector(
      onTap: () => FocusScope.of(context).unfocus(),
      child: Scaffold(
        backgroundColor: const Color(0xFF090D1A),
        resizeToAvoidBottomInset: false,
        body: LayoutBuilder(
          builder: (context, constraints) {
            return Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 393),
                child: SizedBox(
                  width: double.infinity,
                  height: constraints.maxHeight,
                  child: Stack(
                    children: [
                      const Positioned.fill(child: _FlowBackground()),
                      Positioned.fill(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.black.withValues(alpha: 0.12),
                                Colors.black.withValues(alpha: 0),
                                Colors.black.withValues(alpha: 0.12),
                              ],
                            ),
                          ),
                        ),
                      ),
                      SafeArea(
                        bottom: false,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: Column(
                            children: [
                              _FlowHeader(onBack: _goBack),
                              Expanded(
                                child: AnimatedSwitcher(
                                  duration: const Duration(milliseconds: 260),
                                  switchInCurve: Curves.easeOutCubic,
                                  switchOutCurve: Curves.easeInCubic,
                                  child: _currentStep == _AgentFormStep.avatar
                                      ? _AvatarStepView(
                                          key: ValueKey(
                                            '${_currentStep.name}-$bottomInset',
                                          ),
                                          history: _history,
                                          currentQuestion: _currentQuestion,
                                          avatarUrl: _avatarPreviewUrl,
                                          isUploading: _isUploadingAvatar,
                                          onSelectStep: _selectStep,
                                          onAvatarTap: _handleAvatarTap,
                                        )
                                      : _ConversationView(
                                          key: ValueKey(
                                            '${_currentStep.name}-$bottomInset',
                                          ),
                                          history: _history,
                                          currentQuestion: _currentQuestion,
                                          onSelectStep: _selectStep,
                                        ),
                                ),
                              ),
                              AnimatedPadding(
                                duration: const Duration(milliseconds: 220),
                                curve: Curves.easeOut,
                                padding: EdgeInsets.only(
                                  bottom: bottomInset > 0
                                      ? bottomInset + 12
                                      : bottomSafeArea + 24,
                                ),
                                child: _CurrentAnswerPanel(
                                  step: _currentStep,
                                  controller: _activeController,
                                  focusNode: _textFocusNode,
                                  placeholder: _currentPlaceholder,
                                  selectedGender: _gender,
                                  canContinue: _canContinue,
                                  isSubmitting:
                                      _isSubmitting || _isUploadingAvatar,
                                  avatarUrl: _avatarPreviewUrl,
                                  onGenderChanged: _selectGender,
                                  onChanged: () => setState(() {}),
                                  onAvatarTap: _handleAvatarTap,
                                  onContinue: _goToNextStep,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _FlowBackground extends StatelessWidget {
  const _FlowBackground();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      AgentCreateFlowPage._backgroundAsset,
      fit: BoxFit.cover,
      alignment: Alignment.topCenter,
      errorBuilder: (context, error, stackTrace) {
        return const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF050814), Color(0xFF071222), Color(0xFF030406)],
            ),
          ),
        );
      },
    );
  }
}

class _FlowHeader extends StatelessWidget {
  const _FlowHeader({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(left: 2),
          child: IconButton(
            onPressed: onBack,
            icon: const Icon(
              Icons.chevron_left_rounded,
              color: Colors.white,
              size: 28,
            ),
            splashRadius: 20,
          ),
        ),
      ),
    );
  }
}

class _ConversationView extends StatelessWidget {
  const _ConversationView({
    super.key,
    required this.history,
    required this.currentQuestion,
    required this.onSelectStep,
  });

  final List<_ChatEntry> history;
  final String currentQuestion;
  final ValueChanged<_AgentFormStep> onSelectStep;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.bottomLeft,
      child: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        reverse: true,
        padding: const EdgeInsets.only(bottom: 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            for (final entry in history) ...[
              _QuestionBubble(
                text: entry.question,
                onTap: () => onSelectStep(entry.step),
              ),
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerRight,
                child: _AnswerBubble(text: entry.answer),
              ),
              const SizedBox(height: 18),
            ],
            _QuestionBubble(text: currentQuestion),
          ],
        ),
      ),
    );
  }
}

class _AvatarStepView extends StatelessWidget {
  const _AvatarStepView({
    super.key,
    required this.history,
    required this.currentQuestion,
    required this.avatarUrl,
    required this.isUploading,
    required this.onSelectStep,
    required this.onAvatarTap,
  });

  final List<_ChatEntry> history;
  final String currentQuestion;
  final String avatarUrl;
  final bool isUploading;
  final ValueChanged<_AgentFormStep> onSelectStep;
  final Future<void> Function() onAvatarTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            reverse: true,
            padding: const EdgeInsets.only(top: 24, bottom: 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final entry in history) ...[
                  _QuestionBubble(
                    text: entry.question,
                    onTap: () => onSelectStep(entry.step),
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: _AnswerBubble(text: entry.answer),
                  ),
                  const SizedBox(height: 18),
                ],
                _QuestionBubble(text: currentQuestion),
              ],
            ),
          ),
        ),
        Expanded(
          child: Center(
            child: _AvatarUploadCard(
              avatarUrl: avatarUrl,
              isUploading: isUploading,
              onTap: onAvatarTap,
            ),
          ),
        ),
      ],
    );
  }
}

class _QuestionBubble extends StatelessWidget {
  const _QuestionBubble({required this.text, this.onTap});

  final String text;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 180),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.42),
          borderRadius: BorderRadius.circular(88),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: Text(
          text,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            height: 20 / 16,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _AnswerBubble extends StatelessWidget {
  const _AnswerBubble({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 220),
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(88),
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Text(
        text,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 15,
          height: 20 / 15,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _CurrentAnswerPanel extends StatelessWidget {
  const _CurrentAnswerPanel({
    required this.step,
    required this.controller,
    required this.focusNode,
    required this.placeholder,
    required this.selectedGender,
    required this.canContinue,
    required this.isSubmitting,
    required this.avatarUrl,
    required this.onGenderChanged,
    required this.onChanged,
    required this.onAvatarTap,
    required this.onContinue,
  });

  final _AgentFormStep step;
  final TextEditingController controller;
  final FocusNode focusNode;
  final String placeholder;
  final _AgentGender? selectedGender;
  final bool canContinue;
  final bool isSubmitting;
  final String avatarUrl;
  final ValueChanged<_AgentGender> onGenderChanged;
  final VoidCallback onChanged;
  final Future<void> Function() onAvatarTap;
  final Future<void> Function() onContinue;

  Widget _buildStepChild() {
    switch (step) {
      case _AgentFormStep.gender:
        return _GenderPanel(
          key: const ValueKey('gender'),
          selectedGender: selectedGender,
          onChanged: onGenderChanged,
        );
      case _AgentFormStep.avatar:
        return _AvatarActionPanel(
          key: const ValueKey('avatar'),
          canContinue: canContinue,
          isSubmitting: isSubmitting,
          hasAvatar: avatarUrl.trim().isNotEmpty,
          onAvatarTap: onAvatarTap,
          onContinue: onContinue,
        );
      case _AgentFormStep.memorialName:
      case _AgentFormStep.relationToThem:
      case _AgentFormStep.relationToMe:
        return _TextAnswerPanel(
          key: ValueKey(step.name),
          controller: controller,
          focusNode: focusNode,
          placeholder: placeholder,
          canContinue: canContinue,
          isSubmitting: isSubmitting,
          onChanged: onChanged,
          onContinue: onContinue,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      ignoring: isSubmitting,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 240),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        child: _buildStepChild(),
      ),
    );
  }
}

class _TextAnswerPanel extends StatelessWidget {
  const _TextAnswerPanel({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.placeholder,
    required this.canContinue,
    required this.isSubmitting,
    required this.onChanged,
    required this.onContinue,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final String placeholder;
  final bool canContinue;
  final bool isSubmitting;
  final VoidCallback onChanged;
  final Future<void> Function() onContinue;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 6, 8, 6),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              autofocus: true,
              textInputAction: TextInputAction.done,
              onChanged: (_) => onChanged(),
              onSubmitted: (_) => onContinue(),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
              decoration: InputDecoration(
                hintText: placeholder,
                hintStyle: TextStyle(
                  color: Colors.white.withValues(alpha: 0.6),
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
                border: InputBorder.none,
              ),
            ),
          ),
          _ContinueButton(
            enabled: canContinue,
            isLoading: isSubmitting,
            onTap: onContinue,
          ),
        ],
      ),
    );
  }
}

class _GenderPanel extends StatelessWidget {
  const _GenderPanel({
    super.key,
    required this.selectedGender,
    required this.onChanged,
  });

  final _AgentGender? selectedGender;
  final ValueChanged<_AgentGender> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _GenderOption(
            label: '男',
            isSelected: selectedGender == _AgentGender.male,
            onTap: () => onChanged(_AgentGender.male),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _GenderOption(
            label: '女',
            isSelected: selectedGender == _AgentGender.female,
            onTap: () => onChanged(_AgentGender.female),
          ),
        ),
      ],
    );
  }
}

class _GenderOption extends StatelessWidget {
  const _GenderOption({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        height: 56,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isSelected
              ? const Color(0x33A7D2FF)
              : Colors.black.withValues(alpha: 0.38),
          borderRadius: BorderRadius.circular(88),
          border: Border.all(
            color: isSelected
                ? Colors.white.withValues(alpha: 0.44)
                : Colors.white.withValues(alpha: 0.08),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: isSelected ? 1 : 0.88),
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _ContinueButton extends StatelessWidget {
  const _ContinueButton({
    required this.enabled,
    required this.isLoading,
    required this.onTap,
  });

  final bool enabled;
  final bool isLoading;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: enabled
              ? Colors.white.withValues(alpha: 0.18)
              : Colors.white.withValues(alpha: 0.08),
        ),
        child: isLoading
            ? const Padding(
                padding: EdgeInsets.all(12),
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                ),
              )
            : Icon(
                Icons.arrow_forward_rounded,
                color: Colors.white.withValues(alpha: enabled ? 1 : 0.45),
                size: 22,
              ),
      ),
    );
  }
}

class _AvatarUploadCard extends StatelessWidget {
  const _AvatarUploadCard({
    required this.avatarUrl,
    required this.isUploading,
    required this.onTap,
  });

  final String avatarUrl;
  final bool isUploading;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isUploading ? null : onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        width: 160,
        height: 160,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.38),
          borderRadius: BorderRadius.circular(28),
          border: Border.all(
            color: Colors.white.withValues(
              alpha: avatarUrl.trim().isNotEmpty ? 0.24 : 0.1,
            ),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.18),
              blurRadius: 28,
              offset: const Offset(0, 20),
            ),
          ],
        ),
        child: Center(
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (avatarUrl.trim().isNotEmpty)
                AppAvatar(
                  imageUrl: avatarUrl,
                  size: 92,
                  borderRadius: BorderRadius.circular(28),
                  placeholderColor: Colors.white.withValues(alpha: 0.1),
                )
              else
                Container(
                  width: 92,
                  height: 92,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(28),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.12),
                    ),
                  ),
                  child: Icon(
                    Icons.add_a_photo_outlined,
                    color: Colors.white.withValues(alpha: 0.92),
                    size: 30,
                  ),
                ),
              if (isUploading)
                Container(
                  width: 92,
                  height: 92,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.36),
                    borderRadius: BorderRadius.circular(28),
                  ),
                  child: const Center(
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AvatarActionPanel extends StatelessWidget {
  const _AvatarActionPanel({
    super.key,
    required this.canContinue,
    required this.isSubmitting,
    required this.hasAvatar,
    required this.onAvatarTap,
    required this.onContinue,
  });

  final bool canContinue;
  final bool isSubmitting;
  final bool hasAvatar;
  final Future<void> Function() onAvatarTap;
  final Future<void> Function() onContinue;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextButton(
          onPressed: isSubmitting ? null : onAvatarTap,
          style: TextButton.styleFrom(
            foregroundColor: Colors.white.withValues(alpha: 0.84),
            padding: const EdgeInsets.symmetric(vertical: 2),
            minimumSize: const Size.fromHeight(28),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          child: Text(hasAvatar ? '重新选择头像' : '从相册选择头像'),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 52,
          child: ElevatedButton(
            onPressed: canContinue ? onContinue : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: const Color(0xFF10131E),
              disabledBackgroundColor: Colors.white.withValues(alpha: 0.38),
              disabledForegroundColor: const Color(
                0xFF10131E,
              ).withValues(alpha: 0.4),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
              ),
            ),
            child: isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.2,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        Color(0xFF10131E),
                      ),
                    ),
                  )
                : const Text(
                    '完成创建',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
          ),
        ),
      ],
    );
  }
}

class _ChatEntry {
  const _ChatEntry({
    required this.step,
    required this.question,
    required this.answer,
  });

  final _AgentFormStep step;
  final String question;
  final String answer;
}
