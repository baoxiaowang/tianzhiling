import 'dart:async';
import '../config/brand_config.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/agent_api.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/storage_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/user/avatar_editor_page.dart';
import 'package:image_picker/image_picker.dart';

class AgentCreateFlowPage extends StatefulWidget {
  const AgentCreateFlowPage({super.key});
  static const String routeName = '/agents/create/flow';
  @override
  State<AgentCreateFlowPage> createState() => _AgentCreateFlowPageState();
}

class _AgentCreateFlowPageState extends State<AgentCreateFlowPage> {
  String _step = 'relationToThem';
  final Map<String, dynamic> _draft = {};
  final _inputCtl = TextEditingController();
  final _picker = ImagePicker();

  String _promptText = '';
  String _displayedPrompt = '';
  Timer? _revealTimer;
  bool _isThinking = false;
  bool _isSubmitting = false;
  bool _isUploadingAvatar = false;
  String _avatarPreviewUrl = '';
  String _avatarObjectKey = '';

  static const _steps = ['relationToThem', 'agentName', 'relationToMe', 'avatar'];
  int get _stepNum => _steps.indexOf(_step) + 1;
  bool get _busy => _isThinking || _isSubmitting || _isUploadingAvatar;

  static const _relations = ['妈妈', '爸爸', '奶奶', '爷爷', '外婆', '外公', '爱人', '朋友'];
  static const _calls = ['孩子', '闺女', '儿子', '宝贝', '丫头', '输入小名'];

  String _questionFor(String s) {
    switch (s) {
      case 'relationToThem': return '你好，我可以慢慢记下你想唤醒的那位亲人的信息。首先，你想唤醒谁呢？';
      case 'agentName': return '好的，那在聊天中，你想让TA的名字显示成什么呢？';
      case 'relationToMe': return 'TA以前是怎么叫你的呢？';
      case 'avatar': return '太好了，最后为TA选一张熟悉的照片作为头像吧。';
      default: return '';
    }
  }

  @override
  void initState() {
    super.initState();
    _say(_questionFor('relationToThem'));
  }

  @override
  void dispose() {
    _revealTimer?.cancel();
    _inputCtl.dispose();
    super.dispose();
  }

  void _say(String text) {
    _revealTimer?.cancel();
    _promptText = text;
    _displayedPrompt = '';
    final chars = text.characters.toList();
    int i = 0;
    _revealTimer = Timer.periodic(const Duration(milliseconds: 38), (t) {
      if (!mounted) { t.cancel(); return; }
      i++;
      setState(() => _displayedPrompt = chars.take(i).join());
      if (i >= chars.length) t.cancel();
    });
  }

  void _showThinking() => setState(() => _isThinking = true);

  // ============ Step Logic (local, no interview API) ============
  void _selectRelation(String label) {
    if (_busy) return;
    setState(() { _draft['relationToThem'] = label; _draft['gender'] = label == '爸爸' || label == '爷爷' || label == '外公' ? 'male' : 'female'; });
    _showThinking();
    Future.delayed(const Duration(milliseconds: 600), () {
      if (!mounted) return;
      setState(() { _step = 'agentName'; _isThinking = false; });
      _say(_questionFor('agentName'));
    });
  }

  void _selectNameMode(String mode) {
    if (_busy) return;
    if (mode == 'relation') {
      final rel = _draft['relationToThem']?.toString() ?? '';
      if (rel.isNotEmpty) { _inputCtl.text = rel; }
    } else if (mode == 'realName') {
      _inputCtl.text = '';
    } else {
      _inputCtl.text = '';
    }
  }

  void _selectCall(String label) {
    if (_busy) return;
    if (label == '输入小名') { _inputCtl.text = ''; return; }
    setState(() { _draft['relationToMe'] = label; });
    _showThinking();
    Future.delayed(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      setState(() { _step = 'avatar'; _isThinking = false; });
      _say(_questionFor('avatar'));
    });
  }

  void _submitText() {
    if (_busy) return;
    final input = _inputCtl.text.trim();
    if (input.isEmpty && (_draft[_step] ?? '').toString().isNotEmpty) {
      _advanceStep();
      return;
    }
    if (input.isEmpty) return;
    _draft[_step] = input;
    _inputCtl.clear();
    _advanceStep();
  }

  void _advanceStep() {
    final idx = _steps.indexOf(_step);
    if (idx >= _steps.length - 1) return;
    _showThinking();
    Future.delayed(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      setState(() { _step = _steps[idx + 1]; _isThinking = false; });
      _say(_questionFor(_step));
    });
  }

  void _goBack() {
    if (_busy) return;
    final idx = _steps.indexOf(_step);
    if (idx <= 0) { Navigator.of(context).maybePop(); return; }
    setState(() => _step = _steps[idx - 1]);
    _say(_questionFor(_step));
  }

  void _editStep(String step) {
    if (_busy) return;
    setState(() => _step = step);
    _inputCtl.text = (_draft[step] ?? '').toString();
    _say(_questionFor(step));
  }

  Future<void> _handleAvatar() async {
    if (_busy) return;
    try {
      final sel = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 92, maxWidth: 2048, requestFullMetadata: false);
      if (sel == null || !mounted) return;
      final upload = await AvatarEditorPage.edit(context, sel);
      if (upload == null || !mounted) return;
      setState(() => _isUploadingAvatar = true);
      final result = await StorageApi.uploadImage(XFile(upload.path, mimeType: 'image/jpeg', name: sel.name), folder: 'avatars');
      if (!mounted) return;
      setState(() { _avatarPreviewUrl = result.publicUrl; _avatarObjectKey = result.objectKey; _isUploadingAvatar = false; });
    } on ApiException catch (e) {
      if (e.requiresReLogin) { await AuthSessionStore.clear(); if (mounted) Navigator.of(context).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false); return; }
      setState(() => _isUploadingAvatar = false);
      _toast(e.message);
    } catch (_) {
      setState(() => _isUploadingAvatar = false);
      _toast('头像选择失败');
    }
  }

  Future<void> _finishCreate() async {
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      final name = (_draft['agentName'] ?? _draft['relationToThem'] ?? '') as String;
      final gender = _draft['gender'] as String? ?? '';
      final agent = await AgentApi.createAgent(
        name: name.trim(),
        sex: gender == 'male' ? 1 : 0,
        iCallAgent: (_draft['relationToThem'] ?? '').toString().trim(),
        agentCallMe: (_draft['relationToMe'] ?? '').toString().trim(),
      );
      var agentSummary = agent;
      if (_avatarObjectKey.isNotEmpty) {
        agentSummary = await AgentApi.updateAgentAvatar(agentSummary.id, _avatarObjectKey);
      }
      if (!mounted) return;
      Navigator.of(context).pop(agentSummary);
    } on ApiException catch (e) {
      if (e.requiresReLogin) { await AuthSessionStore.clear(); if (mounted) Navigator.of(context).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false); return; }
      _toast(e.message);
    } catch (_) {
      _toast('唤醒${BrandConfig.name}失败');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating, duration: const Duration(seconds: 2)));
  }

  List<_SumRow> get _summaryRows {
    final rows = <_SumRow>[];
    final rel = _draft['relationToThem']?.toString();
    final nm = _draft['agentName']?.toString();
    final rm = _draft['relationToMe']?.toString();
    if (rel != null && rel.isNotEmpty) rows.add(_SumRow('relationToThem', '你想唤醒', rel));
    if (nm != null && nm.isNotEmpty) rows.add(_SumRow('agentName', '智能体名称', nm));
    if (rm != null && rm.isNotEmpty) rows.add(_SumRow('relationToMe', 'TA对你的称呼', rm));
    return rows.where((r) => r.step != _step).toList();
  }

  bool get _canContinue {
    if (_busy) return false;
    if (_step == 'avatar') return true;
    return _inputCtl.text.trim().isNotEmpty || (_draft[_step] ?? '').toString().isNotEmpty;
  }

  String get _btnLabel {
    if (_step == 'avatar') return '确认唤醒';
    if (_step == 'relationToThem') return '告诉小使者';
    return '继续';
  }

  String get _hintText {
    switch (_step) {
      case 'relationToThem': return '例如：妈妈，也可以一起说他平时怎么称呼你';
      case 'agentName': return '输入聊天列表中显示的名称';
      case 'relationToMe': return '输入他对你的称呼';
      default: return '';
    }
  }

  String get _messengerDesc {
    if (_isThinking) return '小使者正在记下基本信息';
    if (_isSubmitting) return '小使者正在唤醒${BrandConfig.name}';
    return '我来帮你一步步唤醒他';
  }

  // ============ Build ============
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF6F6F8),
    body: SafeArea(bottom: false, child: Column(children: [
      _buildAppBar(),
      Expanded(child: _isSubmitting ? _buildCreating() : _buildBody()),
      if (!_isSubmitting) _buildBottom(),
    ])),
  );

  Widget _buildAppBar() => Container(
    height: 48,
    padding: const EdgeInsets.symmetric(horizontal: 4),
    decoration: const BoxDecoration(color: Colors.white, border: Border(bottom: BorderSide(color: Color(0xFFEEEEF2)))),
    child: Row(children: [
      SizedBox(width: 44, child: IconButton(onPressed: _goBack, icon: const Icon(Icons.chevron_left_rounded, size: 24, color: Color(0xFF24222B)), splashRadius: 18)),
      const Expanded(child: Text('唤醒${BrandConfig.name}', textAlign: TextAlign.center, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF24222B)))),
      const SizedBox(width: 44),
    ]),
  );

  Widget _buildBody() => SingleChildScrollView(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
    child: Column(children: [
      _buildMessenger(),
      const SizedBox(height: 16),
      _buildProgress(),
      const SizedBox(height: 14),
      _buildPrompt(),
      if (_summaryRows.isNotEmpty) ...[const SizedBox(height: 18), _buildSummary()],
      const SizedBox(height: 18),
      _buildStepContent(),
    ]),
  );

  Widget _buildMessenger() => Column(children: [
    const _MessengerCircle(),
    const SizedBox(height: 8),
    const Text('${BrandConfig.name}小使者', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF24222B))),
    const SizedBox(height: 2),
    Text(_messengerDesc, style: const TextStyle(fontSize: 13, color: Color(0xFF8A8791))),
  ]);

  Widget _buildProgress() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text('基本信息 $_stepNum/4', style: const TextStyle(fontSize: 12, color: Color(0xFF77747F))),
    const SizedBox(height: 8),
    Row(children: List.generate(4, (i) => Expanded(child: Container(height: 3, margin: EdgeInsets.only(right: i < 3 ? 6 : 0), decoration: BoxDecoration(borderRadius: BorderRadius.circular(2), color: i < _stepNum ? const Color(0xFF297B69) : const Color(0xFFE2E1E6)))))),
  ]);

  Widget _buildPrompt() {
    final text = _displayedPrompt.isEmpty ? _promptText : _displayedPrompt;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 14),
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0xFFE9E8ED)), bottom: BorderSide(color: Color(0xFFE9E8ED)))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Expanded(child: _isThinking
          ? Row(children: [Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Color(0xFF55515D))), const SizedBox(width: 10), _Dot(), _Dot(), _Dot()])
          : Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Color(0xFF24222B), height: 1.7)),
        ),
        const SizedBox(width: 14),
        Container(width: 42, height: 42, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFF0EEF5)), child: const Icon(CupertinoIcons.waveform, color: Color(0xFF77728F), size: 17)),
      ]),
    );
  }

  Widget _buildSummary() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    const Row(children: [Text('小使者已经记住', style: TextStyle(fontSize: 14, color: Color(0xFF24222B))), Spacer(), Text('点击可修改', style: TextStyle(fontSize: 12, color: Color(0xFF8A8791)))]),
    const SizedBox(height: 8),
    ..._summaryRows.map((r) => GestureDetector(
      onTap: () => _editStep(r.step),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        margin: const EdgeInsets.only(bottom: 6),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: const Color(0xFFEEEBF2))),
        child: Row(children: [Expanded(child: Text('${r.label}：${r.value}', style: const TextStyle(fontSize: 14, color: Color(0xFF24222B)))), const Icon(CupertinoIcons.pencil, size: 13, color: Color(0xFF8A8791))]),
      ),
    )),
  ]);

  Widget _buildStepContent() {
    if (_step == 'relationToThem') return _chipsWithInput('常见关系', _relations, _selectRelation);
    if (_step == 'agentName') return _nameModeStep();
    if (_step == 'relationToMe') return _chipsWithInput('常用称呼', _calls, _selectCall);
    return _buildAvatarStep();
  }

  Widget _chipsWithInput(String title, List<String> options, void Function(String) onTap) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(title, style: const TextStyle(fontSize: 13, color: Color(0xFF8A8791))),
    const SizedBox(height: 10),
    Wrap(spacing: 10, runSpacing: 10, children: options.map((o) => GestureDetector(
      onTap: () => onTap(o),
      child: Container(padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 13), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFDEDCE4))), child: Text(o, style: const TextStyle(fontSize: 15, color: Color(0xFF24222B)))),
    )).toList()),
    const SizedBox(height: 16),
    _buildInputArea(),
  ]);

  Widget _nameModeStep() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    const Text('聊天中的名称', style: TextStyle(fontSize: 13, color: Color(0xFF8A8791))),
    const SizedBox(height: 10),
    Wrap(spacing: 10, runSpacing: 10, children: [
      _modeChip('relation', '就叫"${_draft['relationToThem'] ?? ''}"'),
      _modeChip('wechat', '微信昵称/备注'),
      _modeChip('realName', '真实姓名'),
    ]),
    const SizedBox(height: 16),
    _buildInputArea(),
  ]);

  Widget _modeChip(String mode, String label) => GestureDetector(
    onTap: () => _selectNameMode(mode),
    child: Container(padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 13), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFDEDCE4))), child: Text(label, style: const TextStyle(fontSize: 15, color: Color(0xFF24222B)))),
  );

  Widget _buildInputArea() => Container(
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE9E8ED))),
    padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
    child: Row(children: [
      Expanded(child: TextField(
        controller: _inputCtl, enabled: !_busy, style: const TextStyle(fontSize: 15, color: Color(0xFF24222B)),
        decoration: InputDecoration(hintText: _hintText, hintStyle: const TextStyle(fontSize: 14, color: Color(0xFFB0ADB8)), border: InputBorder.none, isDense: true, contentPadding: EdgeInsets.zero),
        onSubmitted: (_) => _submitText(),
      )),
      const SizedBox(width: 8),
      Container(width: 40, height: 40, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFF0EEF5)), child: const Icon(CupertinoIcons.mic_fill, color: Color(0xFF77728F), size: 19)),
    ]),
  );

  Widget _buildAvatarStep() => Column(children: [
    GestureDetector(
      onTap: _isUploadingAvatar ? null : _handleAvatar,
      child: Container(
        width: 160, height: 160,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: const Color(0xFFE9E8ED))),
        child: _isUploadingAvatar
          ? const Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF297B69))))
          : _avatarPreviewUrl.isNotEmpty
            ? ClipRRect(borderRadius: BorderRadius.circular(20), child: Image.network(_avatarPreviewUrl, fit: BoxFit.cover, errorBuilder: (_, err, st) => const Icon(Icons.photo_camera_outlined, color: Color(0xFF77728F), size: 32)))
            : const Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.photo_camera_outlined, color: Color(0xFF77728F), size: 32), SizedBox(height: 8), Text('选择一张熟悉的照片', style: TextStyle(fontSize: 13, color: Color(0xFF8A8791)))]),
      ),
    ),
    const SizedBox(height: 10),
    TextButton(onPressed: _handleAvatar, child: Text(_avatarPreviewUrl.isNotEmpty ? '重新选择' : '从相册选择', style: const TextStyle(fontSize: 14, color: Color(0xFF8A8791)))),
  ]);

  Widget _buildBottom() => Container(
    padding: EdgeInsets.fromLTRB(16, 10, 16, MediaQuery.of(context).padding.bottom + 8),
    decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0xFFEEEEF2)))),
    child: Row(children: [
      if (_step != 'relationToThem') ...[
        SizedBox(width: 100, child: OutlinedButton(onPressed: _goBack, style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFF77728F), side: const BorderSide(color: Color(0xFFDEDCE4)), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)), padding: const EdgeInsets.symmetric(vertical: 12)), child: const Text('上一步', style: TextStyle(fontSize: 15)))),
        const SizedBox(width: 12),
      ],
      Expanded(child: ElevatedButton(
        onPressed: _canContinue ? (_step == 'avatar' ? _finishCreate : _submitText) : null,
        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF297B69), foregroundColor: Colors.white, disabledBackgroundColor: const Color(0xFFB0ADB8), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)), padding: const EdgeInsets.symmetric(vertical: 14), elevation: 0),
        child: _isThinking ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)) : Text(_btnLabel, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      )),
    ]),
  );

  Widget _buildCreating() => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    const _MessengerCircle(),
    const SizedBox(height: 20),
    Text('正在唤醒${_draft['agentName'] ?? _draft['relationToThem'] ?? 'TA'}的${BrandConfig.name}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Color(0xFF24222B))),
    const SizedBox(height: 8),
    const Text('小使者正在把基本信息轻轻放好', style: TextStyle(fontSize: 14, color: Color(0xFF8A8791))),
  ]));
}

class _MessengerCircle extends StatelessWidget {
  const _MessengerCircle();
  @override
  Widget build(BuildContext context) => SizedBox(width: 82, height: 82, child: Stack(alignment: Alignment.center, children: [
    Positioned.fill(child: Container(decoration: const BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [Color(0x3884A8FF), Color(0x1A9673E7), Colors.transparent], stops: [0, 0.45, 0.72])))),
    Container(width: 82, height: 82, decoration: const BoxDecoration(shape: BoxShape.circle, boxShadow: [BoxShadow(color: Color(0x33647FDC), blurRadius: 18)]), child: ClipOval(child: Container(decoration: const BoxDecoration(gradient: RadialGradient(colors: [Color(0xFFE8D5FF), Color(0xFFA78BFA), Color(0xFF6C5CE7)], stops: [0, 0.45, 1]))))),
  ]));
}

class _Dot extends StatelessWidget {
  const _Dot();
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(right: 5), child: Container(width: 5, height: 5, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF77728F))));
}

class _SumRow {
  final String step, label, value;
  const _SumRow(this.step, this.label, this.value);
}
