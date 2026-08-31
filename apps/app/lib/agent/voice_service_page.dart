import 'dart:async';
import '../config/brand_config.dart';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:tianzhiling_app/api/voice_api.dart';
import 'package:tianzhiling_app/models/voice_models.dart';
import 'package:tianzhiling_app/agent/voice_library_page.dart';

// ===== Helpers =====

String _fmtDuration(double s) {
  final sec = s.round();
  final m = sec ~/ 60;
  final rem = sec % 60;
  return m > 0 ? '${m}分${rem}秒' : '${rem}秒';
}

// ===== Main Page =====

class VoiceServicePage extends StatefulWidget {
  final String? agentId;
  const VoiceServicePage({super.key, this.agentId});
  static const String routeName = '/voice-service';

  @override
  State<VoiceServicePage> createState() => _VoiceServicePageState();
}

class _VoiceServicePageState extends State<VoiceServicePage> {
  static const _primary = Color(0xFF297B69);
  static const _bg = Color(0xFFF5F6F8);
  static const _pollInterval = Duration(seconds: 8);

  // Session
  VoiceServiceSession? _session;
  bool _isLoading = true;
  bool _isCheckingAuth = true;
  String? _loadError;

  // Flags
  bool _isUploading = false;
  bool _isSubmitting = false;
  bool _isSending = false;
  bool _isTraining = false;
  bool _isReviewing = false;
  bool _isReturningToMaterials = false;
  bool _isReturningToReview = false;
  bool _isSelectingAgent = false;
  bool _isDeletingData = false;
  bool _isSubmittingRecut = false;
  bool _isLoadingAgents = false;

  // Uploads
  final List<_LocalItem> _localUploads = [];
  int _uploadGen = 0;

  // Agents
  List<AgentSummary> _agents = [];
  int _completedTimbreCount = 0;

  // Messenger
  final _inputCtl = TextEditingController();
  int _refreshGen = 0;

  // Audio
  final _player = AudioPlayer();
  String? _playingUrl;

  // Recut
  final _recutCtl = TextEditingController();

  // Polling
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _player.playbackEventStream.listen((_) { if (mounted) setState(() {}); });
    _player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed && mounted) {
        setState(() => _playingUrl = null);
      }
    });
    _prepare();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _inputCtl.dispose();
    _recutCtl.dispose();
    _player.dispose();
    super.dispose();
  }

  // ===== Data =====

  Future<void> _prepare() async {
    setState(() { _isCheckingAuth = true; _isLoading = true; });
    await Future.wait([
      _refreshSession(showResumePrompt: true, start: true),
      _loadTimbreCount(),
    ]);
    if (mounted) setState(() => _isCheckingAuth = false);
  }

  Future<void> _refreshSession({bool silent = false, bool showResumePrompt = false, bool start = false}) async {
    if (_isLoading && !silent) return;
    final gen = ++_refreshGen;
    if (!silent) setState(() { _isLoading = true; _loadError = null; });
    try {
      final next = start ? await VoiceApi.startSession(agentId: widget.agentId) : await VoiceApi.getCurrentSession();
      if (gen != _refreshGen || !mounted) return;
      setState(() { _session = next; _isLoading = false; });
      await _onSessionChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() { _loadError = e.toString(); _isLoading = false; });
    }
  }

  Future<void> _loadTimbreCount() async {
    try {
      final lib = await VoiceApi.getTimbres();
      if (mounted) setState(() => _completedTimbreCount = lib.items.length);
    } catch (_) {}
  }

  Future<void> _onSessionChanged() async {
    final s = _session?.status;
    if (s == 'preview_ready' || s == 'completed') await _loadAgents();
    final recutCount = (_session?.reviewClips ?? []).where((c) => c.isRecutActive).length;
    if (s == 'analyzing' || s == 'training' || recutCount > 0) {
      _startPolling();
    } else {
      _stopPolling();
    }
  }

  void _startPolling() { _stopPolling(); _pollTimer = Timer.periodic(_pollInterval, (_) => _refreshSession(silent: true)); }
  void _stopPolling() { _pollTimer?.cancel(); _pollTimer = null; }

  Future<void> _loadAgents() async {
    if (_isLoadingAgents || _agents.isNotEmpty) return;
    setState(() => _isLoadingAgents = true);
    try { _agents = await VoiceApi.getAgents(); } catch (_) {}
    if (mounted) setState(() => _isLoadingAgents = false);
  }

  // ===== Materials =====

  Future<void> _handleAddMaterials() async {
    if (_isSubmitting || _isDeletingData) return;
    final mode = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.chat_bubble_outline), title: const Text('从微信聊天选择文件'), onTap: () => Navigator.pop(ctx, 'wechat')),
        ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('从手机相册选择'), onTap: () => Navigator.pop(ctx, 'album')),
      ])),
    );
    if (mode == null || !mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('添加声音素材'),
        content: const Text('请确认你有权使用这些声音素材。素材只用于声音整理、剪辑确认和声音模型训练。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('暂不添加')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('我已确认')),
        ],
      ),
    );
    if (ok != true) return;
    _showToast('请从微信或相册选择声音素材文件');
  }

  void _removeLocal(String id) { _localUploads.removeWhere((i) => i.id == id); setState(() {}); }

  void _retryLocal(String id) {
    final idx = _localUploads.indexWhere((i) => i.id == id);
    if (idx >= 0) { _localUploads[idx] = _localUploads[idx].copyWith(status: _Ls.queued, error: ''); setState(() {}); _processQueue(); }
  }

  Future<void> _processQueue() async {
    if (_isUploading) return;
    _isUploading = true; final gen = ++_uploadGen;
    try {
      while (true) {
        final pending = _localUploads.where((i) => i.status == _Ls.queued).toList();
        if (pending.isEmpty) break;
        for (final item in pending) { await _uploadOne(item, gen); if (gen != _uploadGen) return; }
      }
    } finally {
      _isUploading = false;
      if (_localUploads.any((i) => i.status == _Ls.queued)) _processQueue();
    }
  }

  Future<void> _uploadOne(_LocalItem item, int gen) async {
    final idx = _localUploads.indexWhere((i) => i.id == item.id);
    if (idx < 0) return;
    _localUploads[idx] = item.copyWith(status: _Ls.uploading); setState(() {});
    try {
      final key = 'voice-training-materials/${DateTime.now().millisecondsSinceEpoch}_${item.name}';
      if (gen != _uploadGen) return;
      final s = await VoiceApi.addMaterials([{'name': item.name, 'objectKey': key, 'publicUrl': ''}]);
      if (!mounted) return;
      setState(() { _session = s; _localUploads.removeWhere((i) => i.id == item.id); });
    } catch (_) {
      if (!mounted) return;
      final i = _localUploads.indexWhere((i2) => i2.id == item.id);
      if (i >= 0) { _localUploads[i] = item.copyWith(status: _Ls.failed, error: '上传失败，请重试'); setState(() {}); }
    }
  }

  Future<void> _removeRemote(String materialId) async {
    if (_session == null) return;
    try { final s = await VoiceApi.removeMaterial(_session!.id, materialId); if (mounted) setState(() => _session = s); }
    catch (_) { _showToast('删除失败，请重试'); }
  }

  // ===== Submit =====

  Future<void> _handleSubmit(String mode) async {
    if (_session == null || _isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      final s = await VoiceApi.submitMaterials(_session!.id, mode);
      if (mounted) { setState(() { _session = s; _isSubmitting = false; }); _onSessionChanged(); }
    } catch (_) { if (mounted) { setState(() => _isSubmitting = false); _showToast('提交失败，请重试'); } }
  }

  // ===== Review =====

  Future<void> _reviewClip(String clipId, String status, {String? reason}) async {
    if (_session == null || _isReviewing) return;
    setState(() => _isReviewing = true);
    try {
      final s = await VoiceApi.reviewClip(_session!.id, clipId, status, rejectionReason: reason);
      if (mounted) setState(() { _session = s; _isReviewing = false; });
    } catch (_) { if (mounted) { setState(() => _isReviewing = false); _showToast('操作失败'); } }
  }

  void _openRecut(String clipId, double? dur) {
    _recutCtl.clear();
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('这一段要怎么剪？'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('请写清要去掉或保留的时间', style: TextStyle(fontSize: 13, color: Color(0xFF888888))),
        const SizedBox(height: 8),
        TextField(controller: _recutCtl, maxLength: 120, maxLines: 3, decoration: const InputDecoration(hintText: '例如：去掉开头 2 秒；只保留 3 秒到 8 秒', border: OutlineInputBorder())),
        if (dur != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('当前片段 ${_fmtDuration(dur)}', style: const TextStyle(fontSize: 12, color: Color(0xFFAAAAAA)))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
        TextButton(onPressed: () { final t = _recutCtl.text.trim(); if (t.isEmpty) return; Navigator.pop(ctx); _submitRecut(clipId, t); }, child: const Text('开始重新剪辑')),
      ],
    ));
  }

  Future<void> _submitRecut(String clipId, String instruction) async {
    if (_session == null || _isSubmittingRecut) return;
    setState(() => _isSubmittingRecut = true);
    try {
      final s = await VoiceApi.recutClip(_session!.id, clipId, instruction);
      if (mounted) { setState(() { _session = s; _isSubmittingRecut = false; }); _onSessionChanged(); }
    } catch (_) { if (mounted) { setState(() => _isSubmittingRecut = false); _showToast('重新剪辑失败'); } }
  }

  // ===== Training =====

  Future<void> _startTraining() async {
    if (_session == null || _isTraining) return;
    if (_session!.acceptedClipCount == 0) { _showToast('请至少选择一个可以使用的声音片段'); return; }
    setState(() => _isTraining = true);
    try {
      final s = await VoiceApi.startTraining(_session!.id);
      if (mounted) { setState(() { _session = s; _isTraining = false; }); _onSessionChanged(); }
    } catch (_) { if (mounted) { setState(() => _isTraining = false); _showToast('训练启动失败'); } }
  }

  // ===== Agent =====

  Future<void> _selectAgent(String agentId) async {
    if (_session == null || _isSelectingAgent) return;
    setState(() => _isSelectingAgent = true);
    try {
      final s = await VoiceApi.selectAgent(_session!.id, agentId);
      if (mounted) setState(() { _session = s; _isSelectingAgent = false; });
    } catch (_) { if (mounted) { setState(() => _isSelectingAgent = false); _showToast('选择失败'); } }
  }

  // ===== Navigation =====

  Future<void> _backToMaterials() async {
    if (_session == null || _isReturningToMaterials) return;
    setState(() => _isReturningToMaterials = true);
    try { final s = await VoiceApi.returnToMaterials(_session!.id); if (mounted) setState(() { _session = s; _isReturningToMaterials = false; }); }
    catch (_) { if (mounted) setState(() => _isReturningToMaterials = false); }
  }

  Future<void> _backToReview() async {
    if (_session == null || _isReturningToReview) return;
    setState(() => _isReturningToReview = true);
    try { final s = await VoiceApi.returnToReview(_session!.id); if (mounted) setState(() { _session = s; _isReturningToReview = false; }); }
    catch (_) { if (mounted) setState(() => _isReturningToReview = false); }
  }

  // ===== Delete =====

  Future<void> _deleteAll() async {
    if (_session == null || _isDeletingData || !mounted) return;
    final ok = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('删除全部声音数据'),
      content: const Text('将删除原始素材、切片、训练音频和声音模型，并解除已选${BrandConfig.name}的声音绑定。'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), style: TextButton.styleFrom(foregroundColor: Colors.red), child: const Text('确认删除')),
      ],
    ));
    if (ok != true) return;
    setState(() => _isDeletingData = true);
    try {
      final s = await VoiceApi.deleteAllVoiceData(_session!.id);
      if (mounted) { setState(() { _session = s; _isDeletingData = false; }); _showToast('已提交删除'); }
    } catch (_) { if (mounted) { setState(() => _isDeletingData = false); _showToast('删除失败'); } }
  }

  // ===== Messenger =====

  Future<void> _sendMessage() async {
    final text = _inputCtl.text.trim();
    if (text.isEmpty || _session == null || _isSending) return;
    setState(() => _isSending = true); _inputCtl.clear();
    try {
      final s = await VoiceApi.sendMessage(_session!.id, text);
      if (mounted) setState(() { _session = s; _isSending = false; });
    } catch (_) { if (mounted) setState(() => _isSending = false); }
  }

  // ===== Audio =====

  Future<void> _playAudio(String? url) async {
    if (url == null || url.isEmpty) return;
    if (_playingUrl == url) { await _player.pause(); setState(() => _playingUrl = null); return; }
    try {
      setState(() => _playingUrl = url);
      await _player.setAudioSource(AudioSource.uri(Uri.parse(url)));
      await _player.play();
    } catch (_) { setState(() => _playingUrl = null); }
  }

  // ===== UI Helpers =====

  void _showToast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating, duration: const Duration(seconds: 2)));
  }

  String get _prompt {
    final msgs = _session?.messages ?? [];
    for (int i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role == 'assistant' && msgs[i].text.isNotEmpty) return msgs[i].text; }
    return '各种留有他声音的素材，你发给我就行。音频、视频都可以，不用提前剪辑或整理，我会帮你处理好。';
  }

  String get _statusText {
    final n = (_session?.reviewClips ?? []).where((c) => c.isRecutActive).length;
    if (n > 0) return '正在重新剪辑 $n 段声音';
    switch (_session?.status) {
      case 'collecting': return '准备素材中';
      case 'analyzing': return '正在识别与剪辑';
      case 'reviewing': return '等待试听确认';
      case 'training': return '正在生成声音';
      case 'preview_ready': return '声音已生成';
      case 'completed': return '训练完成';
      case 'failed': return _session?.failureStage == 'training' ? '训练失败' : '剪辑失败';
      default: return '';
    }
  }

  // ===== Build =====

  @override
  Widget build(BuildContext context) {
    if (_isCheckingAuth) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: Colors.white, elevation: 0.5,
        title: const Text('声音训练', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
        leading: IconButton(icon: const Icon(Icons.arrow_back_ios, size: 20), onPressed: () => Navigator.of(context).maybePop()),
        actions: [
          if (_completedTimbreCount > 0)
            TextButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const VoiceLibraryPage())), child: Text('我的音色 ($_completedTimbreCount)', style: const TextStyle(fontSize: 13, color: Color(0xFF77728F)))),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading && _session == null) return const Center(child: CircularProgressIndicator());
    if (_loadError != null && _session == null) return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.wifi_off, size: 48, color: Color(0xFFBBBBBB)), const SizedBox(height: 12),
      const Text('声音服务加载失败', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)), const SizedBox(height: 8),
      Text(_loadError!, style: const TextStyle(fontSize: 13, color: Color(0xFF999999))), const SizedBox(height: 16),
      ElevatedButton(onPressed: _prepare, child: const Text('重新加载')),
    ]));
    final status = _session?.status ?? 'collecting';
    return SingleChildScrollView(padding: const EdgeInsets.all(16), child: Column(children: [
      _msgCard(), const SizedBox(height: 16),
      _stageCard(status), const SizedBox(height: 16),
      _questionCard(),
      if (_session?.hasData == true) ...[const SizedBox(height: 16), _deleteCard()],
      const SizedBox(height: 80),
    ]));
  }

  // ===== Messenger Card =====

  Widget _msgCard() => Container(
    padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(width: 40, height: 40, decoration: const BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [Color(0xFFE8D5FF), Color(0xFFA78BFA), Color(0xFF6C5CE7)], stops: [0, 0.45, 1]), boxShadow: [BoxShadow(color: Color(0x33647FDC), blurRadius: 12)]), child: const Icon(Icons.auto_awesome, color: Colors.white, size: 20)),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('${BrandConfig.name}小使者', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF24222B))), const SizedBox(height: 4),
        Text(_prompt, style: const TextStyle(fontSize: 14, color: Color(0xFF5F5B68), height: 1.6)), const SizedBox(height: 4),
        Text(_statusText, style: const TextStyle(fontSize: 12, color: Color(0xFFBBBBBB))),
      ])),
    ]),
  );

  // ===== Stage =====

  Widget _stageCard(String status) {
    switch (status) {
      case 'collecting': return _collecting();
      case 'analyzing': return _analyzing();
      case 'reviewing': return _reviewing();
      case 'training': return _training();
      case 'preview_ready': case 'completed': return _previewDone();
      case 'failed': return _failed();
      default: return const SizedBox.shrink();
    }
  }

  // -- Collecting --

  Widget _collecting() {
    final has = (_session?.materials ?? []).isNotEmpty || _localUploads.isNotEmpty;
    return Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(children: [
      if (has) ...[
        const Row(children: [Text('声音素材', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))]),
        const SizedBox(height: 12),
        ..._session!.materials.map((m) => _matItem(m)),
        ..._localUploads.map((m) => _localItem(m)),
        const SizedBox(height: 16),
      ],
      _btn('添加声音素材', Icons.add, _handleAddMaterials, loading: _isUploading || _isSubmitting),
      if (has) ...[
        const SizedBox(height: 10),
        _btn('智能识别与剪辑', Icons.auto_awesome, () => _handleSubmit('assisted'), loading: _isSubmitting, primary: true),
        const SizedBox(height: 10),
        _btn('素材已经剪好，直接使用', Icons.check_circle_outline, () => _handleSubmit('ready_to_use'), loading: _isSubmitting),
      ],
    ]));
  }

  Widget _matItem(VoiceServiceMaterial m) => Container(
    margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: const Color(0xFFF8F8FA), borderRadius: BorderRadius.circular(10)),
    child: Row(children: [
      Container(width: 36, height: 36, decoration: BoxDecoration(color: const Color(0xFFED776C).withOpacity(0.12), borderRadius: BorderRadius.circular(8)), child: const Icon(Icons.audio_file, color: Color(0xFFED776C), size: 18)),
      const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(m.name, style: const TextStyle(fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
        if (m.durationSeconds != null && m.durationSeconds! > 0) Text(_fmtDuration(m.durationSeconds!), style: const TextStyle(fontSize: 12, color: Color(0xFF999999))),
      ])),
      GestureDetector(onTap: () => _removeRemote(m.id), child: const Icon(Icons.close, size: 18, color: Color(0xFFBBBBBB))),
    ]),
  );

  Widget _localItem(_LocalItem item) {
    final busy = item.status == _Ls.uploading || item.status == _Ls.saving;
    final err = item.status == _Ls.failed || item.status == _Ls.oversized;
    return Container(
      margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: err ? const Color(0xFFFFF5F5) : const Color(0xFFF8F8FA), borderRadius: BorderRadius.circular(10), border: err ? Border.all(color: const Color(0xFFFFCDD2)) : null),
      child: Row(children: [
        Container(width: 36, height: 36, decoration: BoxDecoration(color: (err ? const Color(0xFFE57373) : const Color(0xFFED776C)).withOpacity(0.12), borderRadius: BorderRadius.circular(8)), child: Icon(Icons.audio_file, color: err ? const Color(0xFFE57373) : const Color(0xFFED776C), size: 18)),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(item.name, style: const TextStyle(fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
          if (busy) ...[const SizedBox(height: 4), const LinearProgressIndicator(minHeight: 3)],
          if (item.error?.isNotEmpty == true) Text(item.error!, style: const TextStyle(fontSize: 12, color: Color(0xFFE57373))),
          if (item.status == _Ls.failed) GestureDetector(onTap: () => _retryLocal(item.id), child: const Text('点击重试', style: TextStyle(fontSize: 12, color: Color(0xFF297B69), decoration: TextDecoration.underline))),
        ])),
        if (!busy) GestureDetector(onTap: () => _removeLocal(item.id), child: const Icon(Icons.close, size: 18, color: Color(0xFFBBBBBB))),
      ]),
    );
  }

  Widget _btn(String label, IconData icon, VoidCallback fn, {bool loading = false, bool primary = false}) => SizedBox(
    width: double.infinity, height: 48,
    child: ElevatedButton.icon(
      onPressed: loading ? null : fn,
      icon: loading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Icon(icon, size: 18),
      label: Text(loading ? '处理中...' : label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
      style: ElevatedButton.styleFrom(backgroundColor: primary ? _primary : const Color(0xFFF0EEF5), foregroundColor: primary ? Colors.white : const Color(0xFF5F5B68), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
    ),
  );

  // -- Analyzing --

  Widget _analyzing() {
    final direct = _session?.processingMode == 'ready_to_use';
    return Container(padding: const EdgeInsets.all(24), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(children: [
      const SizedBox(height: 16), const SizedBox(width: 48, height: 48, child: CircularProgressIndicator(strokeWidth: 3, color: _primary)),
      const SizedBox(height: 20),
      Text(direct ? '正在整理声音格式' : '正在智能识别与剪辑', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      Text(direct ? '我正在把你剪好的声音整理成训练需要的格式。完成后，会请你试听确认。' : '我正在认真听这些素材，区分不同说话人，并把完整的话整理出来。大约需要两到三分钟，你可以先去忙一会儿。', textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: Color(0xFF8A8791), height: 1.6)),
      const SizedBox(height: 20), _link('返回上一步', _backToMaterials, loading: _isReturningToMaterials),
    ]));
  }

  // -- Reviewing --

  Widget _reviewing() {
    final clips = _session?.reviewClips ?? [];
    final filtered = _session?.filteredClips ?? [];
    final ac = _session?.acceptedClipCount ?? 0;
    final rc = _session?.reviewedClipCount ?? 0;
    final allDone = rc == clips.length && clips.isNotEmpty;
    return Column(children: [
      Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(children: [
        if (clips.isNotEmpty) ...[
          Row(children: [const Text('选择可用片段', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)), const Spacer(), Text('$rc/${clips.length}', style: const TextStyle(fontSize: 13, color: Color(0xFF999999)))]),
          const SizedBox(height: 8),
          ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: clips.isEmpty ? 0 : (ac / clips.length).clamp(0.0, 1.0), backgroundColor: const Color(0xFFEEEEEE), valueColor: const AlwaysStoppedAnimation<Color>(_primary), minHeight: 6)),
          const SizedBox(height: 4),
          Text('已选 ${_fmtDuration(_session?.acceptedDurationSeconds ?? 0)} / 最多${VoiceServiceSession.maxTrainingSeconds}秒', style: const TextStyle(fontSize: 12, color: Color(0xFF999999))),
          const SizedBox(height: 12),
          ...clips.map((c) => _clipCard(c)),
        ],
        if (clips.isEmpty && filtered.isNotEmpty) ...[const Icon(Icons.info_outline, size: 32, color: Color(0xFFBBBBBB)), const SizedBox(height: 8), const Text('没有可用的声音片段', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)), const SizedBox(height: 4), const Text('可以继续添加其他声音素材', style: TextStyle(fontSize: 13, color: Color(0xFF999999)))],
        if (allDone) ...[const SizedBox(height: 16), if (ac > 0) _btn('开始训练 ($ac 段)', Icons.rocket_launch, _startTraining, loading: _isTraining, primary: true) else const Text('请至少选择一个可以使用的片段', style: TextStyle(fontSize: 13, color: Color(0xFF999999)))],
      ])),
      if (filtered.isNotEmpty) ...[const SizedBox(height: 16), Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('已排除的片段', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)), const SizedBox(height: 8), ...filtered.map((f) => _filtCard(f))]))],
    ]);
  }

  Widget _clipCard(VoiceServiceReviewClip clip) {
    final acc = clip.reviewStatus == 'accepted';
    final rej = clip.reviewStatus == 'rejected';
    final ra = clip.isRecutActive;
    return Container(
      margin: const EdgeInsets.only(bottom: 10), padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: acc ? const Color(0xFFF0F9F6) : rej ? const Color(0xFFFFF5F5) : Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: acc ? const Color(0xFFC8E6C9) : rej ? const Color(0xFFFFCDD2) : const Color(0xFFEEEEF2))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          GestureDetector(onTap: () => _playAudio(clip.publicUrl), child: Container(width: 36, height: 36, decoration: BoxDecoration(color: const Color(0xFFF0EEF5), borderRadius: BorderRadius.circular(18)), child: Icon(_playingUrl == clip.publicUrl ? Icons.stop : Icons.play_arrow, color: const Color(0xFF5F5B68), size: 20))),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(clip.metaText.isNotEmpty ? clip.metaText : '声音片段 ${clip.id.substring(0, 8)}', style: const TextStyle(fontSize: 13), maxLines: 2, overflow: TextOverflow.ellipsis), if (clip.sourceLabel.isNotEmpty) Text(clip.sourceLabel, style: const TextStyle(fontSize: 11, color: Color(0xFF999999)))])),
        ]),
        if (clip.qualityIssues.isNotEmpty) ...[const SizedBox(height: 8), ...clip.qualityIssues.map((q) => Container(margin: const EdgeInsets.only(top: 4), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), decoration: BoxDecoration(color: q.severity == 'rejected' ? const Color(0xFFFFF3E0) : const Color(0xFFFFF8E1), borderRadius: BorderRadius.circular(6)), child: Text(q.message, style: TextStyle(fontSize: 11, color: q.severity == 'rejected' ? const Color(0xFFE65100) : const Color(0xFFF57F17)))))],
        if (ra) ...[const SizedBox(height: 8), Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: const Color(0xFFF0F7FF), borderRadius: BorderRadius.circular(8)), child: Row(children: [const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: _primary)), const SizedBox(width: 8), Expanded(child: Text('重新剪辑中：${clip.recutInstruction ?? ""}', style: const TextStyle(fontSize: 12, color: Color(0xFF555555))))]))],
        if (clip.recutStatus == 'completed') Container(margin: const EdgeInsets.only(top: 8), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), decoration: BoxDecoration(color: const Color(0xFFE8F5E9), borderRadius: BorderRadius.circular(6)), child: const Text('已重新剪辑，请重新试听', style: TextStyle(fontSize: 11, color: Color(0xFF2E7D32)))),
        if (clip.recutStatus == 'failed') Container(margin: const EdgeInsets.only(top: 8), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4), decoration: BoxDecoration(color: const Color(0xFFFFF3E0), borderRadius: BorderRadius.circular(6)), child: Text(clip.recutFailureReason ?? '这次没有剪好，请重新填写剪法', style: const TextStyle(fontSize: 11, color: Color(0xFFE65100)))),
        if (!ra) ...[const SizedBox(height: 10), Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
          _chip('可以使用', acc, () => _reviewClip(clip.id, 'accepted')),
          _chip('再剪一下', rej && clip.rejectionReason == 'recut_requested', () => _openRecut(clip.id, clip.durationSeconds)),
          _chip('不使用', rej && clip.rejectionReason == 'unusable', () => _reviewClip(clip.id, 'rejected', reason: 'unusable')),
        ])],
      ]),
    );
  }

  Widget _chip(String label, bool sel, VoidCallback fn) => GestureDetector(onTap: fn, child: Container(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), decoration: BoxDecoration(color: sel ? _primary : const Color(0xFFF0EEF5), borderRadius: BorderRadius.circular(20)), child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: sel ? Colors.white : const Color(0xFF5F5B68)))));

  Widget _filtCard(VoiceServiceFilteredClip f) => Container(margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: const Color(0xFFFFF3E0), borderRadius: BorderRadius.circular(10)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(f.sourceName ?? '未知素材', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFFE65100))), if (f.qualityIssues.isNotEmpty) ...[const SizedBox(height: 4), ...f.qualityIssues.map((q) => Text(q.message, style: const TextStyle(fontSize: 11, color: Color(0xFFBF360C))))]]));

  // -- Training --

  Widget _training() => Container(padding: const EdgeInsets.all(24), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(children: [
    const SizedBox(height: 16), const SizedBox(width: 48, height: 48, child: CircularProgressIndicator(strokeWidth: 3, color: _primary)),
    const SizedBox(height: 20), const Text('正在生成声音模型', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
    const SizedBox(height: 8), const Text('我正在把你确认的声音片段整理到一起，并生成声音模型。完成后，会先请你试听效果。', textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: Color(0xFF8A8791), height: 1.6)),
    const SizedBox(height: 20), _link('返回上一步', _backToReview, loading: _isReturningToReview),
  ]));

  // -- Preview / Completed --

  Widget _previewDone() {
    final s = _session!;
    final done = s.status == 'completed';
    return Column(children: [
      Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(children: [
        const Text('声音已经生成', style: TextStyle(fontSize: 13, color: _primary, fontWeight: FontWeight.w600)), const SizedBox(height: 8),
        const Text('现在方便听一听吗？', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)), const SizedBox(height: 4),
        const Text('先试听确认熟悉的感觉，再选择要使用这个声音的${BrandConfig.name}。', style: TextStyle(fontSize: 14, color: Color(0xFF8A8791), height: 1.6)), const SizedBox(height: 8),
        Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: const Color(0xFFFFF8E1), borderRadius: BorderRadius.circular(8)), child: const Text('受大模型厂家限制，生成的音色暂存 7 天；7 天内未使用，厂家会自动清理。', style: TextStyle(fontSize: 12, color: Color(0xFFF57F17)))),
        const SizedBox(height: 16),
        if (s.previewAudioUrl?.isNotEmpty == true) SizedBox(width: double.infinity, height: 48, child: ElevatedButton.icon(onPressed: () => _playAudio(s.previewAudioUrl), icon: Icon(_playingUrl == s.previewAudioUrl ? Icons.stop : Icons.play_arrow, size: 18), label: Text(_playingUrl == s.previewAudioUrl ? '停止试听' : '播放试听'), style: ElevatedButton.styleFrom(backgroundColor: _primary, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))))),
        if (!done) Padding(padding: const EdgeInsets.only(top: 12), child: _link('返回上一步', _backToReview, loading: _isReturningToReview)),
      ])),
      const SizedBox(height: 16),
      Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [Expanded(child: Text('选择${BrandConfig.name}', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)))]), const SizedBox(height: 4),
        Text(s.voiceAccessEligible ? '已有声音权益，选择后直接接入' : '选择使用对象，开通声音权益后自动接入', style: const TextStyle(fontSize: 12, color: Color(0xFF999999))), const SizedBox(height: 12),
        if (_isLoadingAgents) const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator()))
        else if (_agents.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(20), child: Text('还没有${BrandConfig.name}，可以先创建一个再回来选择。', style: TextStyle(fontSize: 13, color: Color(0xFF999999)))))
        else ..._agents.map((a) => _agentTile(a)),
      ])),
    ]);
  }

  Widget _agentTile(AgentSummary a) {
    final sel = _session?.selectedAgentId == a.id;
    final bs = _session?.voiceBindingStatus;
    String hint = '选择他';
    if (sel) { if (bs == 'bound') hint = '声音已接入'; else if (bs == 'existing_voice_preserved') hint = '已保留原有声音'; else hint = '已选择，等待接入'; }
    return ListTile(leading: CircleAvatar(radius: 20, backgroundImage: a.avatar?.isNotEmpty == true ? NetworkImage(a.avatar!) : null, child: a.avatar?.isEmpty != false ? Text(a.name.isNotEmpty ? a.name[0] : '?') : null), title: Text(a.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500)), subtitle: Text(hint, style: TextStyle(fontSize: 12, color: sel ? _primary : const Color(0xFF999999))), trailing: sel ? const Icon(Icons.check_circle, color: _primary) : null, onTap: () => _selectAgent(a.id));
  }

  // -- Failed --

  Widget _failed() {
    final tr = _session?.failureStage == 'training';
    return Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(children: [
      Icon(Icons.error_outline, size: 40, color: tr ? const Color(0xFFFF8C42) : const Color(0xFFE57373)), const SizedBox(height: 12),
      Text(tr ? '这次没有生成成功' : '这次没有整理成功', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)), const SizedBox(height: 8),
      Text(_session?.failureReason ?? '可能是素材格式或声音质量的问题，可以继续添加其他素材。', textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: Color(0xFF8A8791))), const SizedBox(height: 20),
      if (tr)
        _btn('重新生成声音', Icons.refresh, _startTraining, loading: _isTraining, primary: true)
      else ...[
        _btn('重新识别与剪辑', Icons.refresh, () => _handleSubmit('assisted'), loading: _isSubmitting, primary: true),
        const SizedBox(height: 10),
        _btn('添加其他素材', Icons.add, _handleAddMaterials, loading: _isUploading || _isSubmitting),
        const SizedBox(height: 10), _link('返回上一步', _backToMaterials, loading: _isReturningToMaterials),
      ],
    ]));
  }

  Widget _link(String label, VoidCallback fn, {bool loading = false}) => GestureDetector(onTap: loading ? null : fn, child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
    if (loading) const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF77728F))),
    const SizedBox(width: 4), Text(loading ? '处理中...' : label, style: const TextStyle(fontSize: 13, color: Color(0xFF77728F))),
  ]));

  // ===== Question =====

  Widget _questionCard() => Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(children: [
    const Text('有疑问，直接问小使者', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
    const SizedBox(height: 10),
    TextField(controller: _inputCtl, maxLines: 3, decoration: const InputDecoration(hintText: '也可以告诉我你手里的素材情况', hintStyle: TextStyle(fontSize: 13, color: Color(0xFFBBBBBB)), border: OutlineInputBorder(), contentPadding: EdgeInsets.all(12))),
    const SizedBox(height: 10),
    Align(alignment: Alignment.centerRight, child: ElevatedButton.icon(onPressed: (_inputCtl.text.trim().isEmpty || _isSending) ? null : _sendMessage, icon: _isSending ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send, size: 16), label: const Text('发送问题'), style: ElevatedButton.styleFrom(backgroundColor: _primary, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))))),
  ]));

  // ===== Delete =====

  Widget _deleteCard() {
    final ds = _session!.dataDeletionStatus;
    return Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('删除声音数据', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)), const SizedBox(height: 4),
      const Text('将删除原始素材、切片、训练音频和声音模型，并解除已选${BrandConfig.name}的声音绑定。', style: TextStyle(fontSize: 12, color: Color(0xFF999999))),
      if (ds == 'partial_failed') Padding(padding: const EdgeInsets.only(top: 4), child: Text(_session!.dataDeletionFailureReason ?? '仍有部分数据未删除', style: const TextStyle(fontSize: 12, color: Color(0xFFE57373)))),
      const SizedBox(height: 10),
      SizedBox(width: double.infinity, child: OutlinedButton.icon(onPressed: (_isDeletingData || _isUploading || _isSubmitting || _isTraining) ? null : _deleteAll, icon: const Icon(Icons.delete_outline, size: 16, color: Color(0xFFE57373)), label: Text(ds == 'partial_failed' ? '重试删除' : '删除全部声音数据', style: const TextStyle(color: Color(0xFFE57373))), style: OutlinedButton.styleFrom(side: const BorderSide(color: Color(0xFFFFCDD2)), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))))),
    ]));
  }
}

// ===== Local Upload Types =====

enum _Ls { queued, uploading, saving, failed, oversized }

class _LocalItem {
  final String id, name, path;
  final int sizeBytes;
  final _Ls status;
  final String? error;
  const _LocalItem({required this.id, required this.name, required this.path, required this.sizeBytes, this.status = _Ls.queued, this.error});
  _LocalItem copyWith({_Ls? status, String? error}) => _LocalItem(id: id, name: name, path: path, sizeBytes: sizeBytes, status: status ?? this.status, error: error);
}
