import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:tianzhiling_app/api/agent_api.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/storage_api.dart';
import 'package:tianzhiling_app/user/avatar_editor_page.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/models/agent_models.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';
import 'package:image_picker/image_picker.dart';

class AgentProfilePage extends StatefulWidget {
  const AgentProfilePage({super.key, required this.conversation});

  final ConversationSummary conversation;

  static Future<void> open(
    BuildContext context,
    ConversationSummary conversation,
  ) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => AgentProfilePage(conversation: conversation),
      ),
    );
  }

  @override
  State<AgentProfilePage> createState() => _AgentProfilePageState();
}

class _AgentProfilePageState extends State<AgentProfilePage> {
  final ImagePicker _imagePicker = ImagePicker();
  AgentSummary? _agent;
  bool _isLoading = true;
  bool _isUpdatingAvatar = false;
  bool _isSavingProfile = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadAgent();
  }

  Future<void> _loadAgent() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final agent = await AgentApi.getAgentDetail(widget.conversation.agentId);

      if (!mounted) {
        return;
      }

      setState(() {
        _agent = agent;
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

      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.message;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = '资料加载失败，请稍后重试';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _handleAvatarEditTap() async {
    if (_isUpdatingAvatar) {
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
        _isUpdatingAvatar = true;
      });

      final upload = await StorageApi.uploadImage(
        XFile(
          uploadSource.path,
          mimeType: 'image/jpeg',
          name: _buildAvatarFileName(selected),
        ),
        folder: 'avatars',
      );

      final updatedAgent = await AgentApi.updateAgentAvatar(
        widget.conversation.agentId,
        upload.objectKey,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _agent = updatedAgent;
      });

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('头像已更新'),
            behavior: SnackBarBehavior.floating,
          ),
        );
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

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(error.message),
            behavior: SnackBarBehavior.floating,
          ),
        );
    } catch (_) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('头像上传失败，请稍后重试'),
            behavior: SnackBarBehavior.floating,
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          _isUpdatingAvatar = false;
        });
      }
    }
  }

  Future<void> _handleInfoRowTap(_EditableAgentField field) async {
    if (_isSavingProfile || _isUpdatingAvatar) {
      return;
    }

    switch (field) {
      case _EditableAgentField.name:
        return _editTextField(
          title: '修改姓名',
          initialValue: _agent?.name ?? widget.conversation.agentName,
          placeholder: '请输入姓名',
          maxLength: 30,
          fieldKey: 'name',
          successMessage: '姓名已更新',
        );
      case _EditableAgentField.sex:
        return _editSexField();
      case _EditableAgentField.iCallAgent:
        return _editTextField(
          title: '修改你对TA的称呼',
          initialValue: _agent?.iCallAgent ?? widget.conversation.iCallAgent,
          placeholder: '如：奶奶、爷爷',
          maxLength: 20,
          fieldKey: 'iCallAgent',
          successMessage: '称呼已更新',
        );
      case _EditableAgentField.agentCallMe:
        return _editTextField(
          title: '修改TA对你的称呼',
          initialValue: _agent?.agentCallMe ?? widget.conversation.agentCallMe,
          placeholder: '如：小宝、丫头',
          maxLength: 20,
          fieldKey: 'agentCallMe',
          successMessage: '称呼已更新',
        );
      case _EditableAgentField.birthday:
        return _editDateField(
          title: '修改生日',
          currentValue: _agent?.birthday,
          fieldKey: 'birthday',
          successMessage: '生日已更新',
        );
      case _EditableAgentField.deathDate:
        return _editDateField(
          title: '修改离开日期',
          currentValue: _agent?.deathDate,
          fieldKey: 'deathDate',
          successMessage: '离开日期已更新',
        );
      case _EditableAgentField.description:
        return _editTextField(
          title: '修改简介',
          initialValue: _agent?.description ?? '',
          placeholder: '写下一段对外展示的资料简介',
          maxLength: 1000,
          maxLines: 5,
          fieldKey: 'description',
          successMessage: '简介已更新',
          allowEmpty: true,
        );
    }
  }

  Future<void> _editTextField({
    required String title,
    required String initialValue,
    required String placeholder,
    required int maxLength,
    required String fieldKey,
    required String successMessage,
    int maxLines = 1,
    bool allowEmpty = false,
  }) async {
    final nextValue = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return _AgentTextFieldSheet(
          title: title,
          initialValue: initialValue,
          placeholder: placeholder,
          maxLength: maxLength,
          maxLines: maxLines,
          allowEmpty: allowEmpty,
        );
      },
    );

    if (nextValue == null) {
      return;
    }

    await _saveProfileField(<String, dynamic>{
      fieldKey: nextValue,
    }, successMessage);
  }

  Future<void> _editSexField() async {
    final result = await showCupertinoModalPopup<int>(
      context: context,
      builder: (context) {
        return CupertinoActionSheet(
          title: const Text('选择性别'),
          actions: [
            CupertinoActionSheetAction(
              onPressed: () => Navigator.of(context).pop(1),
              child: const Text('男'),
            ),
            CupertinoActionSheetAction(
              onPressed: () => Navigator.of(context).pop(0),
              child: const Text('女'),
            ),
          ],
          cancelButton: CupertinoActionSheetAction(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('取消'),
          ),
        );
      },
    );

    if (result == null) {
      return;
    }

    await _saveProfileField(<String, dynamic>{'sex': result}, '性别已更新');
  }

  Future<void> _editDateField({
    required String title,
    required DateTime? currentValue,
    required String fieldKey,
    required String successMessage,
  }) async {
    final result = await showCupertinoModalPopup<_DateEditResult>(
      context: context,
      builder: (context) {
        return _AgentDatePickerSheet(title: title, initialDate: currentValue);
      },
    );

    if (result == null) {
      return;
    }

    await _saveProfileField(<String, dynamic>{
      fieldKey: result.value == null ? '' : result.value!.toIso8601String(),
    }, successMessage);
  }

  Future<void> _saveProfileField(
    Map<String, dynamic> body,
    String successMessage,
  ) async {
    setState(() {
      _isSavingProfile = true;
    });

    try {
      final updated = await AgentApi.updateAgentProfile(
        widget.conversation.agentId,
        body: body,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _agent = updated;
      });

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(successMessage),
            behavior: SnackBarBehavior.floating,
          ),
        );
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

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(error.message),
            behavior: SnackBarBehavior.floating,
          ),
        );
    } catch (_) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('资料更新失败，请稍后重试'),
            behavior: SnackBarBehavior.floating,
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingProfile = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final fallbackConversation = widget.conversation;
    final agent = _agent;
    final title = agent?.name.trim().isNotEmpty == true
        ? agent!.name.trim()
        : fallbackConversation.agentName.trim().isNotEmpty
        ? fallbackConversation.agentName.trim()
        : '未命名智能体';
    final avatarUrl = agent?.avatar.trim().isNotEmpty == true
        ? agent!.avatar.trim()
        : fallbackConversation.agentAvatar.trim();

    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        titleSpacing: 0,
        leading: IconButton(
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(
            CupertinoIcons.back,
            size: 22,
            color: Color(0xFF111111),
          ),
        ),
        title: const Text(
          '朋友资料',
          style: TextStyle(
            color: Color(0xFF111111),
            fontSize: 17,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      body: _buildBody(title, avatarUrl, fallbackConversation),
    );
  }

  Widget _buildBody(
    String title,
    String avatarUrl,
    ConversationSummary fallbackConversation,
  ) {
    if (_isLoading && _agent == null) {
      return const Center(child: CupertinoActivityIndicator(radius: 12));
    }

    if (_errorMessage != null && _agent == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '资料暂时加载失败',
                style: TextStyle(
                  color: Color(0xFF111111),
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _errorMessage!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF8A8F98),
                  fontSize: 14,
                  height: 20 / 14,
                ),
              ),
              const SizedBox(height: 16),
              CupertinoButton(
                padding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 8,
                ),
                color: const Color(0xFF111111),
                borderRadius: BorderRadius.circular(12),
                onPressed: _loadAgent,
                child: const Text('重试'),
              ),
            ],
          ),
        ),
      );
    }

    final agent = _agent;
    final description = _resolveDescription(agent, fallbackConversation);
    final infoRows = <_EditableInfoRowData>[
      _EditableInfoRowData(
        label: '姓名',
        value: title,
        field: _EditableAgentField.name,
      ),
      _EditableInfoRowData(
        label: '性别',
        value: _resolveSexLabel(agent?.sex ?? fallbackConversation.agentSex),
        field: _EditableAgentField.sex,
      ),
      _EditableInfoRowData(
        label: '你对TA的称呼',
        value: _resolveValue(
          agent?.iCallAgent,
          fallbackConversation.iCallAgent,
          empty: '去设置',
        ),
        field: _EditableAgentField.iCallAgent,
        isPlaceholder: _resolveValue(
          agent?.iCallAgent,
          fallbackConversation.iCallAgent,
        ).isEmpty,
      ),
      _EditableInfoRowData(
        label: 'TA对你的称呼',
        value: _resolveValue(
          agent?.agentCallMe,
          fallbackConversation.agentCallMe,
          empty: '去设置',
        ),
        field: _EditableAgentField.agentCallMe,
        isPlaceholder: _resolveValue(
          agent?.agentCallMe,
          fallbackConversation.agentCallMe,
        ).isEmpty,
      ),
      _EditableInfoRowData(
        label: '生日',
        value: _formatDate(agent?.birthday, empty: '去设置'),
        field: _EditableAgentField.birthday,
        isPlaceholder: agent?.birthday == null,
      ),
      _EditableInfoRowData(
        label: '离开日期',
        value: _formatDate(agent?.deathDate, empty: '去设置'),
        field: _EditableAgentField.deathDate,
        isPlaceholder: agent?.deathDate == null,
      ),
      _EditableInfoRowData(
        label: '简介',
        value: description.isEmpty ? '去设置' : description,
        field: _EditableAgentField.description,
        isPlaceholder: description.isEmpty,
      ),
    ];

    return RefreshIndicator(
      onRefresh: _loadAgent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(0, 0, 0, 24),
        children: [
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
            child: Row(
              children: [
                _EditableAgentAvatar(
                  imageUrl: avatarUrl,
                  isUpdating: _isUpdatingAvatar,
                  onTap: _handleAvatarEditTap,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          color: Color(0xFF111111),
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _MetaPill(
                            label:
                                '你称呼TA ${_resolveValue(agent?.iCallAgent, fallbackConversation.iCallAgent, empty: '未设置')}',
                          ),
                          _MetaPill(
                            label:
                                'TA称呼你 ${_resolveValue(agent?.agentCallMe, fallbackConversation.agentCallMe, empty: '未设置')}',
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          _ProfileSection(
            title: '资料信息',
            child: Column(
              children: [
                for (var index = 0; index < infoRows.length; index++) ...[
                  _EditableInfoRow(
                    item: infoRows[index],
                    isSaving: _isSavingProfile,
                    onTap: () => _handleInfoRowTap(infoRows[index].field),
                  ),
                  if (index != infoRows.length - 1) const _InfoDivider(),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _resolveDescription(
    AgentSummary? agent,
    ConversationSummary fallbackConversation,
  ) {
    final description = agent?.description.trim() ?? '';
    if (description.isNotEmpty) {
      return description;
    }

    final preview = fallbackConversation.preview.trim();
    if (preview.isNotEmpty) {
      return preview;
    }

    return '这里会展示这位智能体对外公开的资料简介。';
  }

  String _resolveSexLabel(int sex) {
    return sex == 1 ? '男' : '女';
  }

  String _resolveValue(String? primary, String? fallback, {String empty = ''}) {
    final first = primary?.trim() ?? '';
    if (first.isNotEmpty) {
      return first;
    }

    final second = fallback?.trim() ?? '';
    if (second.isNotEmpty) {
      return second;
    }

    return empty;
  }

  String _formatDate(DateTime? date, {String empty = ''}) {
    if (date == null) {
      return empty;
    }

    return '${date.year}年${date.month}月${date.day}日';
  }

  String _buildAvatarFileName(XFile source) {
    final extension = () {
      final path = source.path.trim();
      final dotIndex = path.lastIndexOf('.');
      if (dotIndex == -1 || dotIndex == path.length - 1) {
        return '.jpg';
      }

      return path.substring(dotIndex);
    }();

    return 'agent_avatar_${DateTime.now().millisecondsSinceEpoch}$extension';
  }
}

class _EditableAgentAvatar extends StatelessWidget {
  const _EditableAgentAvatar({
    required this.imageUrl,
    required this.isUpdating,
    required this.onTap,
  });

  final String imageUrl;
  final bool isUpdating;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        AppAvatar(
          imageUrl: imageUrl,
          size: 76,
          borderRadius: BorderRadius.circular(18),
          iconSize: 28,
        ),
        Positioned(
          right: 4,
          bottom: 4,
          child: GestureDetector(
            onTap: isUpdating ? null : onTap,
            child: Padding(
              padding: const EdgeInsets.all(2),
              child: isUpdating
                  ? const CupertinoActivityIndicator(
                      radius: 6,
                      color: Color(0xFF475569),
                    )
                  : const Icon(
                      CupertinoIcons.pencil_circle_fill,
                      size: 18,
                      color: Color(0xFF334155),
                    ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ProfileSection extends StatelessWidget {
  const _ProfileSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Text(
              title,
              style: const TextStyle(
                color: Color(0xFF111111),
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

class _MetaPill extends StatelessWidget {
  const _MetaPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F6F8),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF6A707A),
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

enum _EditableAgentField {
  name,
  sex,
  iCallAgent,
  agentCallMe,
  birthday,
  deathDate,
  description,
}

class _EditableInfoRowData {
  const _EditableInfoRowData({
    required this.label,
    required this.value,
    required this.field,
    this.isPlaceholder = false,
  });

  final String label;
  final String value;
  final _EditableAgentField field;
  final bool isPlaceholder;
}

class _EditableInfoRow extends StatelessWidget {
  const _EditableInfoRow({
    required this.item,
    required this.isSaving,
    required this.onTap,
  });

  final _EditableInfoRowData item;
  final bool isSaving;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: isSaving ? null : onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 15, 16, 15),
        child: Row(
          children: [
            const SizedBox(width: 2),
            Text(
              item.label,
              style: const TextStyle(color: Color(0xFF111111), fontSize: 15),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                item.value,
                textAlign: TextAlign.right,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: item.isPlaceholder
                      ? const Color(0xFFB2B7BF)
                      : const Color(0xFF666C75),
                  fontSize: 14,
                  height: 20 / 14,
                ),
              ),
            ),
            const SizedBox(width: 8),
            isSaving
                ? const CupertinoActivityIndicator(radius: 8)
                : const Icon(
                    CupertinoIcons.chevron_right,
                    size: 15,
                    color: Color(0xFFC0C4CC),
                  ),
          ],
        ),
      ),
    );
  }
}

class _AgentTextFieldSheet extends StatefulWidget {
  const _AgentTextFieldSheet({
    required this.title,
    required this.initialValue,
    required this.placeholder,
    required this.maxLength,
    required this.maxLines,
    required this.allowEmpty,
  });

  final String title;
  final String initialValue;
  final String placeholder;
  final int maxLength;
  final int maxLines;
  final bool allowEmpty;

  @override
  State<_AgentTextFieldSheet> createState() => _AgentTextFieldSheetState();
}

class _AgentTextFieldSheetState extends State<_AgentTextFieldSheet> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initialValue,
  );

  @override
  void initState() {
    super.initState();
    _controller.addListener(_handleChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_handleChanged);
    _controller.dispose();
    super.dispose();
  }

  void _handleChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final canSubmit = widget.allowEmpty || _controller.text.trim().isNotEmpty;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('取消'),
                  ),
                  Expanded(
                    child: Text(
                      widget.title,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Color(0xFF111111),
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: canSubmit
                        ? () =>
                              Navigator.of(context).pop(_controller.text.trim())
                        : null,
                    child: const Text('保存'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _controller,
                autofocus: true,
                maxLines: widget.maxLines,
                minLines: widget.maxLines > 1 ? widget.maxLines : 1,
                maxLength: widget.maxLength,
                decoration: InputDecoration(
                  hintText: widget.placeholder,
                  filled: true,
                  fillColor: const Color(0xFFF6F7F9),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 14,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
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

class _DateEditResult {
  const _DateEditResult(this.value);

  final DateTime? value;
}

class _AgentDatePickerSheet extends StatefulWidget {
  const _AgentDatePickerSheet({required this.title, required this.initialDate});

  final String title;
  final DateTime? initialDate;

  @override
  State<_AgentDatePickerSheet> createState() => _AgentDatePickerSheetState();
}

class _AgentDatePickerSheetState extends State<_AgentDatePickerSheet> {
  late DateTime _selectedDate = widget.initialDate ?? DateTime(2000, 1, 1);

  @override
  Widget build(BuildContext context) {
    return Localizations.override(
      context: context,
      locale: const Locale('zh', 'CN'),
      delegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      child: Container(
        height: 320,
        padding: const EdgeInsets.only(top: 10),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('取消'),
                    ),
                    Expanded(
                      child: Text(
                        widget.title,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFF111111),
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: () {
                        Navigator.of(
                          context,
                        ).pop(_DateEditResult(_selectedDate));
                      },
                      child: const Text('保存'),
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: () =>
                    Navigator.of(context).pop(const _DateEditResult(null)),
                child: const Text('清空日期'),
              ),
              Expanded(
                child: CupertinoDatePicker(
                  mode: CupertinoDatePickerMode.date,
                  initialDateTime: _selectedDate,
                  maximumDate: DateTime.now(),
                  dateOrder: DatePickerDateOrder.ymd,
                  onDateTimeChanged: (value) {
                    _selectedDate = value;
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoDivider extends StatelessWidget {
  const _InfoDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(left: 16),
      child: Divider(height: 1, thickness: 0.5, color: Color(0xFFEAECEF)),
    );
  }
}
