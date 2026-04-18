import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/agent/agent_create_flow_page.dart';
import 'package:tianzhiling_app/agent/agent_create_page.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/coupon/cash_coupon_page.dart';
import 'package:tianzhiling_app/friend/friend_profile_page.dart';
import 'package:tianzhiling_app/invite/invite_reward_page.dart';
import 'package:tianzhiling_app/main_tab_page.dart';
import 'package:tianzhiling_app/home/my_posts_page.dart';
import 'package:tianzhiling_app/notice/vip_success_notice_page.dart';
import 'package:tianzhiling_app/user/user_name_edit_page.dart';
import 'package:tianzhiling_app/user/user_settings_page.dart';
import 'package:tianzhiling_app/vip/vip_center_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AuthSessionStore.restore();
  runApp(const TianZhiLingApp());
}

class TianZhiLingApp extends StatelessWidget {
  const TianZhiLingApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '天之灵',
      locale: const Locale('zh', 'CN'),
      supportedLocales: const [Locale('zh', 'CN'), Locale('en', 'US')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      theme: ThemeData(
        scaffoldBackgroundColor: const Color(0xFFF3F3F3),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF9B26),
          primary: const Color(0xFFFF9B26),
        ),
        useMaterial3: true,
      ),
      routes: {
        AgentCreateFlowPage.routeName: (_) => const AgentCreateFlowPage(),
        AgentCreatePage.routeName: (_) => const AgentCreatePage(),
        AuthPage.routeName: (_) => const AuthPage(),
        CashCouponPage.routeName: (_) => const CashCouponPage(),
        FriendProfilePage.routeName: (_) => const FriendProfilePage(),
        InviteRewardPage.routeName: (_) => const InviteRewardPage(),
        MainTabPage.routeName: (_) => const MainTabPage(),
        MyPostsPage.routeName: (_) => const MyPostsPage(),
        UserNameEditPage.routeName: (_) => const UserNameEditPage(),
        UserSettingsPage.routeName: (_) => const UserSettingsPage(),
        VipSuccessNoticePage.routeName: (_) => const VipSuccessNoticePage(),
        VipCenterPage.routeName: (_) => const VipCenterPage(),
      },
      initialRoute: AuthSessionStore.session.value == null
          ? AuthPage.routeName
          : MainTabPage.routeName,
    );
  }
}
