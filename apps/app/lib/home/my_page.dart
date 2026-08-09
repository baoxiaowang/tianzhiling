import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/home/my_agents_page.dart';
import 'package:tianzhiling_app/home/my_posts_page.dart';
import 'package:tianzhiling_app/notice/system_notice_page.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';
import 'package:tianzhiling_app/user/service_agreement_page.dart';
import 'package:tianzhiling_app/user/user_settings_page.dart';
import 'package:tianzhiling_app/vip/orders_page.dart';
import 'package:tianzhiling_app/vip/vip_center_page.dart';
import 'package:flutter/services.dart';

class MyPage extends StatelessWidget {
  const MyPage({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFEDEDED),
    body: ValueListenableBuilder<AuthSessionData?>(
      valueListenable: AuthSessionStore.session,
      builder: (context, session, _) => ListView(
        padding: EdgeInsets.zero,
        children: [
          _ProfileCard(user: session?.user),
          const SizedBox(height: 8),
          _MenuGroup(actions: const [
            _MenuAction(key: 'contacts', title: '我的联系人', icon: Icons.people_alt_outlined, tone: Color(0xFF5B6F95)),
          ]),
          const SizedBox(height: 8),
          _MenuGroup(actions: const [
            _MenuAction(key: 'vip', title: 'VIP 服务', icon: CupertinoIcons.star_fill, tone: Color(0xFFE9AD3F)),
            _MenuAction(key: 'voice', title: '声音模型', icon: CupertinoIcons.waveform, tone: Color(0xFFED776C)),
            _MenuAction(key: 'service', title: '人工客服', icon: CupertinoIcons.chat_bubble_text, tone: Color(0xFF2EAA68)),
          ]),
          const SizedBox(height: 8),
          _MenuGroup(actions: const [
            _MenuAction(key: 'posts', title: '我的动态', icon: CupertinoIcons.photo, tone: Color(0xFF579ED6)),
            _MenuAction(key: 'orders', title: '我的订单', icon: CupertinoIcons.doc_text, tone: Color(0xFFDF963F)),
          ]),
          const SizedBox(height: 8),
          _MenuGroup(actions: const [
            _MenuAction(key: 'notice', title: '系统消息', icon: CupertinoIcons.bell, tone: Color(0xFFE65B62)),
            _MenuAction(key: 'agreement', title: '服务协议', icon: CupertinoIcons.checkmark_seal, tone: Color(0xFF7B8795)),
          ]),
          const SizedBox(height: 110),
        ],
      ),
    ),
  );
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.user});
  final AuthUser? user;

  @override
  Widget build(BuildContext context) {
    final name = (user?.name.trim().isNotEmpty ?? false) ? user!.name : '妮妮';
    final account = (user?.account.trim().isNotEmpty ?? false) ? user!.account : '12345678';

    return Container(
      height: 120,
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(18, 0, 16, 0),
      child: Row(children: [
        AppAvatar(imageUrl: user?.avatar ?? '', size: 72, borderRadius: BorderRadius.circular(8), iconSize: 32),
        const SizedBox(width: 16),
        Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(mainAxisSize: MainAxisSize.min, children: [
            Flexible(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: Colors.black))),
          ]),
          const SizedBox(height: 10),
          Row(mainAxisSize: MainAxisSize.min, children: [
            Flexible(child: Text('ID：$account', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: Color(0xFF999999)))),
            const SizedBox(width: 4),
            GestureDetector(
              onTap: () { Clipboard.setData(ClipboardData(text: account)); ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(const SnackBar(content: Text('ID已复制'), behavior: SnackBarBehavior.floating, duration: Duration(seconds: 1))); },
              child: Container(width: 28, height: 28, child: const Icon(Icons.copy_rounded, size: 14, color: Color(0xFF999999))),
            ),
          ]),
        ])),
        GestureDetector(
          onTap: () => Navigator.of(context).pushNamed(UserSettingsPage.routeName),
          child: Container(width: 28, height: 28, alignment: Alignment.center, child: const Icon(Icons.chevron_right_rounded, size: 20, color: Color(0xFFCFCFCF))),
        ),
      ]),
    );
  }
}

class _MenuGroup extends StatelessWidget {
  const _MenuGroup({required this.actions});
  final List<_MenuAction> actions;

  void _handleTap(BuildContext context, _MenuAction action) {
    switch (action.key) {
      case 'contacts': Navigator.of(context).pushNamed(MyAgentsPage.routeName); return;
      case 'vip': Navigator.of(context).pushNamed(VipCenterPage.routeName); return;
      case 'voice': Navigator.of(context).pushNamed('/voice-library'); return;
      case 'posts': Navigator.of(context).pushNamed(MyPostsPage.routeName); return;
      case 'orders': Navigator.of(context).pushNamed(OrdersPage.routeName); return;
      case 'notice': Navigator.of(context).pushNamed(SystemNoticePage.routeName); return;
      case 'agreement': Navigator.of(context).pushNamed(ServiceAgreementPage.routeName); return;
      default: ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(content: Text('${action.title} 页面待接入'), behavior: SnackBarBehavior.floating));
    }
  }

  @override
  Widget build(BuildContext context) => Container(
    color: Colors.white,
    child: Column(children: [
      for (var i = 0; i < actions.length; i++) ...[
        InkWell(
          onTap: () => _handleTap(context, actions[i]),
          child: _MenuRow(action: actions[i]),
        ),
        if (i < actions.length - 1)
          const Padding(padding: EdgeInsets.only(left: 58), child: Divider(height: 1, thickness: 0.5, color: Color(0xFFE5E5E5))),
      ],
    ]),
  );
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({required this.action});
  final _MenuAction action;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 56,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(children: [
        Container(width: 28, height: 28, decoration: BoxDecoration(color: action.tone, borderRadius: BorderRadius.circular(5)), child: Center(child: Icon(action.icon, color: Colors.white, size: 18))),
        const SizedBox(width: 14),
        Expanded(child: Text(action.title, style: const TextStyle(fontSize: 16, color: Color(0xFF111111)))),
        const Icon(Icons.chevron_right_rounded, size: 18, color: Color(0xFFCFCFCF)),
      ]),
    ),
  );
}

class _MenuAction {
  final String key;
  final String title;
  final IconData icon;
  final Color tone;
  const _MenuAction({required this.key, required this.title, required this.icon, required this.tone});
}
