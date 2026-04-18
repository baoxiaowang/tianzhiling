import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/coupon/cash_coupon_page.dart';
import 'package:tianzhiling_app/home/my_posts_page.dart';
import 'package:tianzhiling_app/invite/invite_reward_page.dart';
import 'package:tianzhiling_app/notice/vip_success_notice_page.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';
import 'package:tianzhiling_app/user/user_settings_page.dart';

class MyPage extends StatelessWidget {
  const MyPage({super.key});

  static const List<_MenuAction> _primaryActions = [
    _MenuAction(title: '我的动态', routeName: MyPostsPage.routeName),
    _MenuAction(title: '现金券', routeName: CashCouponPage.routeName),
    _MenuAction(title: '订单管理'),
    _MenuAction(title: '我的邀请', routeName: InviteRewardPage.routeName),
    _MenuAction(title: '联系客服', routeName: VipSuccessNoticePage.routeName),
  ];

  static const List<_MenuAction> _secondaryActions = [
    _MenuAction(title: '服务协议'),
    _MenuAction(title: '系统通知'),
  ];

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.of(context).padding.top;

    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 393),
          child: ColoredBox(
            color: const Color(0xFFF7F7F7),
            child: Column(
              children: [
                if (topInset > 0)
                  Container(height: topInset, color: Colors.white),
                Expanded(
                  child: SafeArea(
                    top: false,
                    bottom: false,
                    child: ListView(
                      physics: const BouncingScrollPhysics(),
                      padding: EdgeInsets.zero,
                      children: [
                        ValueListenableBuilder<AuthSessionData?>(
                          valueListenable: AuthSessionStore.session,
                          builder: (context, session, _) {
                            return _ProfileHeader(user: session?.user);
                          },
                        ),
                        const SizedBox(height: 10),
                        const _MenuSection(actions: _primaryActions),
                        const SizedBox(height: 10),
                        const _MenuSection(actions: _secondaryActions),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.user});

  final AuthUser? user;

  @override
  Widget build(BuildContext context) {
    final displayName = (user?.name.trim().isNotEmpty ?? false)
        ? user!.name
        : '妮妮';
    final displayAccount = (user?.account.trim().isNotEmpty ?? false)
        ? user!.account
        : '12345678';

    return Container(
      height: 141,
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          AppAvatar(
            imageUrl: user?.avatar ?? '',
            size: 64,
            borderRadius: BorderRadius.circular(14),
            iconSize: 30,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  displayName,
                  style: const TextStyle(
                    color: Color(0xFF1A1A1A),
                    fontSize: 18,
                    height: 27 / 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'ID：$displayAccount',
                  style: const TextStyle(
                    color: Color(0xFF999999),
                    fontSize: 13,
                    height: 19.5 / 13,
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () {
              Navigator.of(context).pushNamed(UserSettingsPage.routeName);
            },
            icon: const Icon(
              Icons.chevron_right_rounded,
              size: 22,
              color: Color(0xFFCFCFCF),
            ),
            splashRadius: 20,
            tooltip: '用户设置',
          ),
        ],
      ),
    );
  }
}

class _MenuSection extends StatelessWidget {
  const _MenuSection({required this.actions});

  final List<_MenuAction> actions;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: Column(
        children: [
          for (var index = 0; index < actions.length; index++)
            _MenuTile(
              action: actions[index],
              showDivider: index != actions.length - 1,
            ),
        ],
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile({required this.action, required this.showDivider});

  final _MenuAction action;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        if (action.routeName != null) {
          Navigator.of(context).pushNamed(action.routeName!);
          return;
        }

        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: Text('${action.title} 页面待接入'),
              behavior: SnackBarBehavior.floating,
            ),
          );
      },
      child: Column(
        children: [
          SizedBox(
            height: 52,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      action.title,
                      style: const TextStyle(
                        color: Color(0xFF333333),
                        fontSize: 16,
                        height: 24 / 16,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  const Icon(
                    Icons.chevron_right_rounded,
                    size: 18,
                    color: Color(0xFFCFCFCF),
                  ),
                ],
              ),
            ),
          ),
          if (showDivider)
            const Padding(
              padding: EdgeInsets.only(left: 16),
              child: Divider(
                height: 1,
                thickness: 0.5,
                color: Color(0xFFEBEBEB),
              ),
            ),
        ],
      ),
    );
  }
}

class _MenuAction {
  const _MenuAction({required this.title, this.routeName});

  final String title;
  final String? routeName;
}
