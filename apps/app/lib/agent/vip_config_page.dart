import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/vip/vip_center_page.dart';

class VipConfigPage extends StatelessWidget {
  const VipConfigPage({super.key});

  static const String routeName = '/vip-config';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text('VIP与增值配置', style: TextStyle(color: Color(0xFF1A1A1A), fontSize: 17, fontWeight: FontWeight.w600)),
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
                    Icon(CupertinoIcons.star_circle, size: 28, color: Color(0xFFFF9B26)),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text('会员状态', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const _StatusRow(label: '当前套餐', value: '免费体验'),
                const _StatusRow(label: '剩余天数', value: '0 天'),
                const _StatusRow(label: '聊天额度', value: '已用完'),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.of(context).pushNamed(VipCenterPage.routeName);
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFFF9B26),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('升级会员', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
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
                Text('增值服务', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
                SizedBox(height: 16),
                _ConfigItem(icon: CupertinoIcons.person_2_square_stack, title: '亲友共享', subtitle: '让家人也能与TA对话', trailing: '无限期会员专享'),
                _ConfigItem(icon: CupertinoIcons.doc_text, title: '人工访谈', subtitle: '专业访谈师为TA完善记忆', trailing: '无限期会员专享'),
                _ConfigItem(icon: CupertinoIcons.money_dollar_circle, title: '现金券', subtitle: '邀请好友双方各得优惠', trailing: '查看详情'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 14, color: Color(0xFF999999))),
          Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF333333))),
        ],
      ),
    );
  }
}

class _ConfigItem extends StatelessWidget {
  const _ConfigItem({required this.icon, required this.title, required this.subtitle, required this.trailing});
  final IconData icon;
  final String title;
  final String subtitle;
  final String trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          Icon(icon, size: 24, color: const Color(0xFF666666)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: Color(0xFF333333))),
                Text(subtitle, style: const TextStyle(fontSize: 12, color: Color(0xFF999999))),
              ],
            ),
          ),
          Text(trailing, style: const TextStyle(fontSize: 11, color: Color(0xFFFF9B26))),
        ],
      ),
    );
  }
}
