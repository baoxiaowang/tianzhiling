import 'package:flutter_localizations/flutter_localizations.dart';
import 'config/brand_config.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/agent/agent_create_flow_page.dart';
import 'package:tianzhiling_app/agent/voice_library_page.dart';
import 'package:tianzhiling_app/agent/voice_service_page.dart';
import 'package:tianzhiling_app/agent/voice_timbre_detail_page.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/friend/friend_profile_page.dart';
import 'package:tianzhiling_app/main_tab_page.dart';
import 'package:tianzhiling_app/home/my_posts_page.dart';
import 'package:tianzhiling_app/user/user_name_edit_page.dart';
import 'package:tianzhiling_app/user/user_settings_page.dart';
import 'package:tianzhiling_app/vip/vip_center_page.dart';
import 'package:tianzhiling_app/vip/orders_page.dart';
import 'package:tianzhiling_app/user/service_agreement_page.dart';
import 'package:tianzhiling_app/notice/system_notice_page.dart';
import 'package:tianzhiling_app/home/my_agents_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AuthSessionStore.restore();
  runApp(const TianZhiLingApp());
}

class TianZhiLingApp extends StatelessWidget {
  const TianZhiLingApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthSessionData?>(
      valueListenable: AuthSessionStore.session,
      builder: (context, session, _) {
        return MaterialApp(
          key: ValueKey<String>(session == null ? 'auth-root' : 'app-root'),
          debugShowCheckedModeBanner: false,
          title: BrandConfig.name,
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
            AuthPage.routeName: (_) => const AuthPage(),
            VoiceLibraryPage.routeName: (_) => const VoiceLibraryPage(),
            VoiceServicePage.routeName: (_) => const VoiceServicePage(),
            FriendProfilePage.routeName: (_) => const FriendProfilePage(),
            MainTabPage.routeName: (_) => const MainTabPage(),
            MyAgentsPage.routeName: (_) => const MyAgentsPage(),
            MyPostsPage.routeName: (_) => const MyPostsPage(),
            OrdersPage.routeName: (_) => const OrdersPage(),
            ServiceAgreementPage.routeName: (_) => const ServiceAgreementPage(),
            SystemNoticePage.routeName: (_) => const SystemNoticePage(),
            UserNameEditPage.routeName: (_) => const UserNameEditPage(),
            UserSettingsPage.routeName: (_) => const UserSettingsPage(),
            VipCenterPage.routeName: (_) => const VipCenterPage(),
          },
          onGenerateRoute: (settings) {
            if (settings.name == VoiceTimbreDetailPage.routeName) {
              final timbreId = settings.arguments as String? ?? '';
              return MaterialPageRoute(builder: (_) => VoiceTimbreDetailPage(timbreId: timbreId));
            }
            return null;
          },
          home: session == null ? const AuthPage() : const MainTabPage(),
        );
      },
    );
  }
}
