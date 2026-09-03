import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class ImportChatRecordsPage extends StatefulWidget {
  const ImportChatRecordsPage({super.key});

  static const String routeName = '/import-chat-records';

  @override
  State<ImportChatRecordsPage> createState() => _ImportChatRecordsPageState();
}

class _ImportChatRecordsPageState extends State<ImportChatRecordsPage> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text('导入聊天记录', style: TextStyle(color: Color(0xFF1A1A1A), fontSize: 17, fontWeight: FontWeight.w600)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(CupertinoIcons.doc_on_clipboard, size: 28, color: Color(0xFFFF9B26)),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text('导入微信聊天记录', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const Text(
                  '上传你和TA的微信聊天截图，AI会自动提取聊天内容、学习TA的语言风格，并生成记忆。',
                  style: TextStyle(fontSize: 14, height: 1.6, color: Color(0xFF666666)),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: OutlinedButton.icon(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('图片选择功能待接入'), behavior: SnackBarBehavior.floating),
                      );
                    },
                    icon: const Icon(CupertinoIcons.photo_on_rectangle, size: 20),
                    label: const Text('选择聊天截图', style: TextStyle(fontSize: 15)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFFF9B26),
                      side: const BorderSide(color: Color(0xFFFF9B26)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('导入说明', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
                SizedBox(height: 14),
                _TipRow(num: '1', text: '截图需包含微信聊天界面的完整信息（头像、昵称、时间、消息内容）'),
                _TipRow(num: '2', text: '多张截图如有重叠区域会自动去重，按时间顺序排列'),
                _TipRow(num: '3', text: '导入的聊天记录不占用聊天额度'),
                _TipRow(num: '4', text: 'AI会提取记忆并学习TA的说话方式（语气词、句子长度等）'),
                _TipRow(num: '5', text: '导入完成后可校对提取的内容，确认后生成记忆'),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF8F0),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFFFE0C0)),
            ),
            child: const Row(
              children: [
                Icon(CupertinoIcons.lightbulb, size: 20, color: Color(0xFFFF9B26)),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '小提示：手机截图后可直接粘贴到此处上传，建议每次上传5-10张以内以获得最佳识别效果。',
                    style: TextStyle(fontSize: 12, height: 1.5, color: Color(0xFF996633)),
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

class _TipRow extends StatelessWidget {
  const _TipRow({required this.num, required this.text});
  final String num;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              color: const Color(0xFFFFF0E0),
              borderRadius: BorderRadius.circular(6),
            ),
            alignment: Alignment.center,
            child: Text(num, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFFFF9B26))),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: const TextStyle(fontSize: 13, height: 1.5, color: Color(0xFF666666))),
          ),
        ],
      ),
    );
  }
}
