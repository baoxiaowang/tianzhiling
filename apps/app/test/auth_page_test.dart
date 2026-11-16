import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/auth/wechat_auth_client.dart';

class _FakeWechatAuthClient implements WechatAuthClient {
  _FakeWechatAuthClient({this.configured = true, this.installed = false});

  final bool configured;
  final bool installed;

  @override
  bool get isConfigured => configured;

  @override
  Future<bool> isWeChatInstalled() async => installed;

  @override
  Future<String> requestAuthCode() async {
    return 'wechat-auth-code';
  }
}

Future<void> _pumpAuthPage(
  WidgetTester tester,
  WechatAuthClient client,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: AuthPage(wechatAuthClient: client),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('登录页只保留微信登录，不展示手机号/密码登录入口', (tester) async {
    await _pumpAuthPage(
      tester,
      _FakeWechatAuthClient(configured: true, installed: false),
    );

    expect(find.text('微信一键登录'), findsOneWidget);
    expect(find.text('微信登录'), findsOneWidget);
    expect(find.text('手机号登陆/注册'), findsNothing);
    expect(find.text('密码登陆'), findsNothing);
    expect(find.text('获取验证码'), findsNothing);
    expect(find.text('请输入手机号'), findsNothing);
    expect(find.text('请输入密码'), findsNothing);
  });

  testWidgets('未安装微信时给出明确提示，且点击登录不会发起微信授权', (tester) async {
    await _pumpAuthPage(
      tester,
      _FakeWechatAuthClient(configured: true, installed: false),
    );

    expect(find.text('未检测到微信，请先安装微信后再登录'), findsOneWidget);

    await tester.tap(find.text('微信登录'));
    await tester.pump();

    expect(find.text('未检测到微信，请先安装微信后再登录'), findsWidgets);
  });

  testWidgets('未注入 WECHAT_APP_ID 时提示未配置', (tester) async {
    await _pumpAuthPage(
      tester,
      _FakeWechatAuthClient(configured: false, installed: false),
    );

    expect(find.text('当前安装包未配置微信登录参数，暂时无法登录'), findsOneWidget);

    await tester.tap(find.text('微信登录'));
    await tester.pump();

    expect(find.text('当前安装包未配置微信登录参数，暂时无法登录'), findsWidgets);
  });
}
