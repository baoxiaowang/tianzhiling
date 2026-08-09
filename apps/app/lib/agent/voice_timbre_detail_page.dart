import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/api/voice_api.dart';


class VoiceTimbreDetailPage extends StatefulWidget {
  final String timbreId;
  const VoiceTimbreDetailPage({super.key, required this.timbreId});
  static const String routeName = '/voice-timbre-detail';

  @override
  State<VoiceTimbreDetailPage> createState() => _VoiceTimbreDetailPageState();
}

class _VoiceTimbreDetailPageState extends State<VoiceTimbreDetailPage> {
  final _api = ApiClient.instance;
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _detail;
  final _player = AudioPlayer();
  String? _playingUrl;

  final _speechCtl = TextEditingController();
  bool _isGenerating = false;
  String? _generatedAudioUrl;

  double _speed = 1.0;
  double _volume = 1.0;
  bool _isSavingParams = false;

  @override
  void initState() {
    super.initState();
    _load();
    _player.playbackEventStream.listen((_) { if (mounted) setState(() {}); });
    _player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed && mounted) {
        setState(() => _playingUrl = null);
      }
    });
  }

  @override
  void dispose() {
    _player.dispose();
    _speechCtl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final d = await _api.get('/api/voice-services/timbres/${widget.timbreId}');
      if (!mounted) return;
      setState(() {
        _detail = d;
        _speed = (d['speechSpeed'] as num?)?.toDouble() ?? 1.0;
        _volume = (d['speechVolume'] as num?)?.toDouble() ?? 1.0;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  Future<void> _playAudio(String? url) async {
    if (url == null || url.isEmpty) return;
    if (_playingUrl == url) {
      await _player.pause();
      setState(() => _playingUrl = null);
      return;
    }
    try {
      setState(() => _playingUrl = url);
      await _player.setAudioSource(AudioSource.uri(Uri.parse(url)));
      await _player.play();
    } catch (e) {
      setState(() => _playingUrl = null);
    }
  }

  Future<void> _rename() async {
    final ctl = TextEditingController(text: _detail?['name'] ?? '');
    if (!mounted) return;
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('修改音色名称'),
        content: TextField(controller: ctl, maxLength: 20, decoration: const InputDecoration(hintText: '例如：妈妈的声音')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(ctx, ctl.text.trim()), child: const Text('保存')),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      final updated = await VoiceApi.renameTimbre(widget.timbreId, name);
      _detail?['name'] = updated.name;
      setState(() {});
      _toast('名称已保存');
    } catch (_) {
      _toast('保存失败');
    }
  }

  Future<void> _generateSpeech() async {
    final text = _speechCtl.text.trim();
    if (text.isEmpty) return;
    setState(() => _isGenerating = true);
    try {
      final result = await _api.post(
        '/api/voice-services/timbres/${widget.timbreId}/speech',
        body: {'text': text},
      );
      if (!mounted) return;
      setState(() {
        _generatedAudioUrl = result['audioUrl'] as String?;
        _isGenerating = false;
        if (result['remainingToday'] != null) {
          _detail?['customSpeechRemainingToday'] = result['remainingToday'];
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _isGenerating = false);
      _toast('语音生成失败');
    }
  }

  Future<void> _saveParams() async {
    setState(() => _isSavingParams = true);
    try {
      await _api.patch(
        '/api/voice-services/timbres/${widget.timbreId}',
        body: {'speechSpeed': _speed, 'speechVolume': _volume},
      );
      _toast('参数已保存');
    } catch (_) {
      _toast('保存失败');
    }
    if (mounted) setState(() => _isSavingParams = false);
  }

  Future<void> _delete() async {
    if (!mounted) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('永久删除这个音色吗？'),
        content: Text('将删除"${_detail?['name'] ?? ''}"的声音模型、训练音频、试听音频和生成语音，并解除已绑定的天之灵。\n\n删除后无法恢复。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), style: TextButton.styleFrom(foregroundColor: Colors.red), child: const Text('永久删除')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await VoiceApi.deleteTimbre(widget.timbreId);
      if (mounted) {
        _toast('已删除');
        Navigator.of(context).pop(true);
      }
    } catch (_) {
      _toast('删除失败');
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6F8),
      appBar: AppBar(
        backgroundColor: Colors.white, elevation: 0.5,
        title: Text(_detail?['name'] ?? '音色详情', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        actions: [
          IconButton(icon: const Icon(Icons.edit_outlined, size: 20), onPressed: _rename, tooltip: '修改名称'),
          IconButton(icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red), onPressed: _delete, tooltip: '删除音色'),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.error_outline, size: 40, color: Color(0xFFBBBBBB)),
                  const SizedBox(height: 12), Text(_error!, style: const TextStyle(color: Color(0xFF999999))),
                  const SizedBox(height: 12),
                  ElevatedButton(onPressed: _load, child: const Text('重试')),
                ]))
              : _buildContent(),
    );
  }

  Widget _buildContent() {
    final d = _detail!;
    final bindings = (d['bindings'] as List?)?.whereType<Map<String, dynamic>>().toList() ?? [];
    final trainingClips = (d['trainingClips'] as List?)?.whereType<Map<String, dynamic>>().toList() ?? [];
    final trainingAudioUrl = d['trainingAudioUrl'] as String?;
    final remainingToday = d['customSpeechRemainingToday'] as int? ?? 0;
    final maxLen = d['customSpeechTextMaxLength'] as int? ?? 100;
    final dailyLimit = d['customSpeechDailyLimit'] as int? ?? 5;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('关联天之灵', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            if (bindings.isEmpty)
              const Text('尚未接入天之灵', style: TextStyle(fontSize: 13, color: Color(0xFF999999)))
            else
              ...bindings.map((b) => ListTile(
                contentPadding: EdgeInsets.zero, dense: true,
                leading: CircleAvatar(radius: 18, child: Text((b['agentName'] as String? ?? '?')[0])),
                title: Text(b['agentName'] as String? ?? '', style: const TextStyle(fontSize: 14)),
              )),
          ]),
        ),
        const SizedBox(height: 16),
        if (trainingClips.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('训练片段', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              ...trainingClips.map((c) => _buildClipItem(c)),
            ]),
          ),
        if (trainingClips.isNotEmpty) const SizedBox(height: 16),
        if (trainingAudioUrl != null) ...[
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
            child: SizedBox(
              width: double.infinity, height: 44,
              child: ElevatedButton.icon(
                onPressed: () => _playAudio(trainingAudioUrl),
                icon: Icon(_playingUrl == trainingAudioUrl ? Icons.stop : Icons.play_arrow, size: 18),
                label: Text(_playingUrl == trainingAudioUrl ? '停止' : '播放训练音频'),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF0EEF5), foregroundColor: const Color(0xFF5F5B68), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: Text('语音参数', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
              TextButton(onPressed: _isSavingParams ? null : _saveParams, child: const Text('保存')),
            ]),
            const SizedBox(height: 8),
            Text('语速 ${_speed.toStringAsFixed(1)}', style: const TextStyle(fontSize: 13, color: Color(0xFF666666))),
            Slider(value: _speed, min: 0.5, max: 2.0, onChanged: (v) => setState(() => _speed = v), activeColor: const Color(0xFF297B69)),
            const SizedBox(height: 8),
            Text('音量 ${_volume.toStringAsFixed(1)}', style: const TextStyle(fontSize: 13, color: Color(0xFF666666))),
            Slider(value: _volume, min: 0.25, max: 2.0, onChanged: (v) => setState(() => _volume = v), activeColor: const Color(0xFF297B69)),
          ]),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: Text('生成语音', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
              Text('今天剩余 $remainingToday / $dailyLimit 次', style: const TextStyle(fontSize: 12, color: Color(0xFF999999))),
            ]),
            const SizedBox(height: 10),
            TextField(
              controller: _speechCtl, maxLength: maxLen, maxLines: 3,
              decoration: InputDecoration(hintText: '输入文字，最多 $maxLen 字', border: const OutlineInputBorder()),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: (_speechCtl.text.trim().isEmpty || _isGenerating || remainingToday <= 0) ? null : _generateSpeech,
                icon: _isGenerating ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.record_voice_over, size: 18),
                label: const Text('生成语音'),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF297B69), foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
              ),
            ),
            if (_generatedAudioUrl != null) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity, height: 44,
                child: ElevatedButton.icon(
                  onPressed: () => _playAudio(_generatedAudioUrl),
                  icon: Icon(_playingUrl == _generatedAudioUrl ? Icons.stop : Icons.play_arrow, size: 18),
                  label: Text(_playingUrl == _generatedAudioUrl ? '停止' : '试听生成语音'),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF0EEF5), foregroundColor: const Color(0xFF5F5B68), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                ),
              ),
            ],
          ]),
        ),
        const SizedBox(height: 80),
      ]),
    );
  }

  Widget _buildClipItem(Map<String, dynamic> c) {
    final name = c['name'] as String? ?? '';
    final audioUrl = c['audioUrl'] as String? ?? '';
    final duration = c['durationSeconds'] as num?;
    final qualityLabel = c['qualityLabel'] as String?;

    return ListTile(
      contentPadding: EdgeInsets.zero, dense: true,
      leading: GestureDetector(
        onTap: () => _playAudio(audioUrl),
        child: Container(
          width: 36, height: 36,
          decoration: BoxDecoration(color: const Color(0xFFF0EEF5), borderRadius: BorderRadius.circular(18)),
          child: Icon(_playingUrl == audioUrl ? Icons.stop : Icons.play_arrow, color: const Color(0xFF5F5B68), size: 18),
        ),
      ),
      title: Text(name, style: const TextStyle(fontSize: 13)),
      subtitle: Text([
        if (duration != null) _formatDuration(duration.toDouble()),
        if (qualityLabel != null) qualityLabel,
      ].join(' · '), style: const TextStyle(fontSize: 11, color: Color(0xFF999999))),
    );
  }

  static String _formatDuration(double s) {
    final sec = s.round();
    final m = sec ~/ 60;
    final rem = sec % 60;
    return m > 0 ? '${m}分${rem}秒' : '${rem}秒';
  }
}
