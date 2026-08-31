import 'package:flutter/cupertino.dart';
import '../config/brand_config.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/voice_api.dart';
import 'package:tianzhiling_app/agent/voice_service_page.dart';
import 'package:tianzhiling_app/agent/voice_timbre_detail_page.dart';
import 'package:tianzhiling_app/models/voice_models.dart';

class VoiceLibraryPage extends StatefulWidget {
  const VoiceLibraryPage({super.key});
  static const String routeName = '/voice-library';

  @override
  State<VoiceLibraryPage> createState() => _VoiceLibraryPageState();
}

class _VoiceLibraryPageState extends State<VoiceLibraryPage> {
  bool _isLoading = true;
  String? _error;
  VoiceTimbreLibrary? _library;
  String? _playingId;

  @override
  void initState() { super.initState(); _load(); }

  bool _redirectedToTraining = false;

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final lib = await VoiceApi.getTimbres();
      if (!mounted) return;
      if (lib.items.isEmpty && !_redirectedToTraining) {
        _redirectedToTraining = true;
        Navigator.of(context).pushReplacementNamed(VoiceServicePage.routeName);
        return;
      }
      setState(() { _library = lib; _isLoading = false; });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  void _showRenameDialog(VoiceTimbreRecord item) {
    final ctl = TextEditingController(text: item.name);
    showDialog(context: context, builder: (_) => AlertDialog(
      title: const Text('修改音色名称'),
      content: TextField(controller: ctl, maxLength: 20, decoration: const InputDecoration(hintText: '例如：妈妈的声音')),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('取消')),
        TextButton(onPressed: () async {
          final name = ctl.text.trim();
          if (name.isEmpty) return;
          Navigator.of(context).pop();
          try {
            final updated = await VoiceApi.renameTimbre(item.id, name);
            if (!mounted) return;
            setState(() {
              _library = VoiceTimbreLibrary(
                items: _library!.items.map((t) => t.id == updated.id ? updated : t).toList(),
                retentionPolicy: _library!.retentionPolicy,
              );
            });
            _toast('名称已保存');
          } catch (e) { _toast('保存失败，请重试'); }
        }, child: const Text('保存')),
      ],
    ));
  }

  void _showDeleteDialog(VoiceTimbreRecord item) {
    showDialog(context: context, builder: (_) => AlertDialog(
      title: const Text('永久删除这个音色吗？'),
      content: Text('将删除"${item.name}"的声音模型、训练音频、试听音频和生成语音，并解除已绑定的${BrandConfig.name}。\n\n原始素材和切片仍会保留。删除后无法恢复。'),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('取消')),
        TextButton(onPressed: () async {
          Navigator.of(context).pop();
          try {
            final result = await VoiceApi.deleteTimbre(item.id);
            _toast(result['message'] as String? ?? '已提交删除');
            _load();
          } catch (e) { _toast('删除失败，请重试'); }
        }, style: TextButton.styleFrom(foregroundColor: Colors.red), child: const Text('永久删除')),
      ],
    ));
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating));
  }

  String _formatDate(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inDays < 1) return '今天';
    if (diff.inDays < 2) return '昨天';
    if (diff.inDays < 7) return '${diff.inDays}天前';
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF5F6F8),
    appBar: AppBar(
      backgroundColor: Colors.white, surfaceTintColor: Colors.white, elevation: 0,
      title: const Text('我的音色', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
    ),
    body: _isLoading ? _buildLoading() : _error != null ? _buildError() : _buildContent(),
    bottomNavigationBar: (!_isLoading && _error == null && (_library?.items.isNotEmpty ?? false))
      ? SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 10), child: SizedBox(height: 50, child: ElevatedButton.icon(
          onPressed: () => Navigator.of(context).pushNamed(VoiceServicePage.routeName),
          icon: const Icon(Icons.add, size: 18), label: const Text('训练新音色', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF297B69), foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), elevation: 0),
        ))))
      : null,
  );

  Widget _buildLoading() => const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF77728F))),
    SizedBox(height: 12), Text('正在整理你的音色...', style: TextStyle(fontSize: 14, color: Color(0xFF8A8F98))),
  ]));

  Widget _buildError() => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Icon(CupertinoIcons.wifi_slash, size: 40, color: Color(0xFFBBBBBB)),
    const SizedBox(height: 12),
    const Text('音色仓库暂时没有连接上', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF111111))),
    const SizedBox(height: 4), Text(_error ?? '', style: const TextStyle(fontSize: 14, color: Color(0xFF8A8F98))),
    const SizedBox(height: 16),
    CupertinoButton(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8), color: const Color(0xFF111111), borderRadius: BorderRadius.circular(12), onPressed: _load, child: const Text('重新加载', style: TextStyle(fontSize: 14, color: Colors.white))),
  ]));

  Widget _buildContent() {
    final items = _library?.items ?? [];
    if (items.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(CupertinoIcons.waveform, size: 48, color: Color(0xFFCCCCCC)),
        const SizedBox(height: 16),
        const Text('还没有保存音色', style: TextStyle(fontSize: 16, color: Color(0xFF999999))),
        const SizedBox(height: 4),
        const Text('训练完成后会出现在这里', style: TextStyle(fontSize: 13, color: Color(0xFFCCCCCC))),
        const SizedBox(height: 20),
        ElevatedButton.icon(
          onPressed: () => Navigator.of(context).pushNamed(VoiceServicePage.routeName),
          icon: const Icon(Icons.add, size: 18), label: const Text('训练新音色'),
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF297B69), foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14), elevation: 0),
        ),
      ]));
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        color: Colors.white,
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('已保存 ${items.length} 个音色', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
            const SizedBox(height: 4),
            const Text('选择音色查看训练片段、调整效果或生成语音', style: TextStyle(fontSize: 13, color: Color(0xFF8A8F98))),
          ])),
        ]),
      ),
      Expanded(child: ListView.builder(
        itemCount: items.length,
        itemBuilder: (_, i) => GestureDetector(
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => VoiceTimbreDetailPage(timbreId: items[i].id),
          )),
          child: _buildTimbreCard(items[i]),
        ),
      )),
    ]);
  }

  Widget _buildTimbreCard(VoiceTimbreRecord item) => Container(
    margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Container(width: 32, height: 32, decoration: BoxDecoration(color: const Color(0xFFED776C), borderRadius: BorderRadius.circular(6)), child: const Center(child: Icon(CupertinoIcons.waveform, color: Colors.white, size: 18))),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(item.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
          if (item.createdAt != null) Text('${_formatDate(item.createdAt!)}创建', style: const TextStyle(fontSize: 12, color: Color(0xFF999999))),
        ])),
        if (item.previewAudioUrl != null && item.previewAudioUrl!.isNotEmpty)
          Container(width: 36, height: 36, decoration: BoxDecoration(color: const Color(0xFFF0EEF5), borderRadius: BorderRadius.circular(18)), child: Center(child: Icon(_playingId == item.id ? CupertinoIcons.stop_fill : CupertinoIcons.play_fill, color: const Color(0xFF5F5B68), size: 17)))
        else
          Container(width: 36, height: 36, decoration: BoxDecoration(color: const Color(0xFFF0EEF5), borderRadius: BorderRadius.circular(18)), child: const Icon(CupertinoIcons.play_fill, color: Color(0xFFCCCCCC), size: 17)),
        const SizedBox(width: 8),
        GestureDetector(
          onTap: () => _showManageMenu(item),
          child: Container(width: 36, height: 36, decoration: BoxDecoration(color: const Color(0xFFF0EEF5), borderRadius: BorderRadius.circular(18)), child: const Icon(Icons.more_horiz, color: Color(0xFF5F5B68), size: 18)),
        ),
      ]),
      const SizedBox(height: 12),
      Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        decoration: BoxDecoration(color: const Color(0xFFF8F8FA), borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          Text(item.bindings.isNotEmpty ? '正在用于：${item.bindingNames}' : '尚未接入${BrandConfig.name}', style: const TextStyle(fontSize: 12, color: Color(0xFF888888))),
          const Spacer(),
          Container(width: 6, height: 6, decoration: BoxDecoration(shape: BoxShape.circle, color: item.retentionStatus == 'expiring' ? const Color(0xFFFF8C42) : const Color(0xFF2EAA68))),
          const SizedBox(width: 6),
          Text(item.retentionMessage, style: TextStyle(fontSize: 11, color: item.retentionStatus == 'expiring' ? const Color(0xFFFF8C42) : const Color(0xFF2EAA68))),
        ]),
      ),
    ]),
  );

  void _showManageMenu(VoiceTimbreRecord item) {
    showModalBottomSheet(context: context, builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      ListTile(leading: const Icon(Icons.edit_outlined), title: const Text('修改名称'), onTap: () { Navigator.of(context).pop(); _showRenameDialog(item); }),
      ListTile(leading: const Icon(Icons.delete_outline, color: Colors.red), title: const Text('永久删除', style: TextStyle(color: Colors.red)), onTap: () { Navigator.of(context).pop(); _showDeleteDialog(item); }),
    ])));
  }
}
