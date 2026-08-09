
import 'package:flutter/material.dart';

class SystemNoticePage extends StatelessWidget {
  const SystemNoticePage({super.key});

  static const String routeName = '/system-notice';

  static const List<_NoticeItem> _notices = [
    _NoticeItem(
      title: '关于「天之灵」产品理念',
      date: '2025-06-28',
      body: '天之灵的使命是守护记忆。我们相信，每一个生命都值得被记住，每一段关系都值得被延续。用AI技术让思念有处可去，让对话永远不被遗忘。',
    ),
    _NoticeItem(
      title: '语音消息功能上线',
      date: '2025-06-15',
      body: '现在你可以给天之灵发送语音消息了。长按输入框旁的麦克风按钮开始录音，松开即可发送。AI将识别你的语音内容并回复。',
    ),
    _NoticeItem(
      title: '天之灵版本更新说明',
      date: '2025-06-01',
      body: '1. 新增动态广场功能，可以发布心情与天之灵互动；2. 优化聊天体验，AI回复更加流畅自然；3. 修复了若干已知问题。',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text('系统通知', style: TextStyle(color: Color(0xFF1A1A1A), fontSize: 17, fontWeight: FontWeight.w600)),
      ),
      body: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _notices.length,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final notice = _notices[index];
          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(width: 6, height: 6, decoration: const BoxDecoration(color: Color(0xFFFF9B26), shape: BoxShape.circle)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(notice.title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(notice.body, style: const TextStyle(fontSize: 13, height: 1.5, color: Color(0xFF666666))),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: Text(notice.date, style: const TextStyle(fontSize: 11, color: Color(0xFFBBBBBB))),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _NoticeItem {
  const _NoticeItem({required this.title, required this.date, required this.body});
  final String title;
  final String date;
  final String body;
}
