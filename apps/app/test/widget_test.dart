import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tianzhiling_app/chat/chat_conversation_page.dart';
import 'package:tianzhiling_app/main_tab_page.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';

void main() {
  testWidgets('main tab page shows moments tab by default', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: MainTabPage()));
    // 首页动态加载会发起网络请求，推进一帧让测试期请求结束，避免悬挂 timer。
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('朋友圈'), findsOneWidget);
    expect(find.text('通讯录'), findsOneWidget);
    expect(find.text('我'), findsOneWidget);
  });

  testWidgets('chat conversation page renders shell without mock messages', (
    WidgetTester tester,
  ) async {
    const conversation = ConversationSummary(
      id: 'conversation-1',
      agentId: 'agent-1',
      agentName: '妈妈',
      agentAvatar: '',
      agentSex: 0,
      agentCallMe: '儿子',
      iCallAgent: '妈妈',
      preview: '点击开始和 TA 对话',
      createdAt: null,
      updatedAt: null,
    );

    await tester.pumpWidget(
      const MaterialApp(home: ChatConversationPage(conversation: conversation)),
    );
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('妈妈'), findsWidgets);
    expect(find.text('输入消息'), findsOneWidget);
    expect(find.text('昨天 10:23'), findsNothing);
    expect(find.textContaining('通话时长'), findsNothing);
  });

  testWidgets('tapping me tab shows my page content', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: MainTabPage()));

    await tester.tap(find.text('我'));
    // 首页动态加载中有持续动画，不能只等 pumpAndSettle，固定推进一帧即可。
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('妮妮'), findsOneWidget);
    expect(find.text('ID：12345678'), findsOneWidget);
    expect(find.text('VIP 服务'), findsOneWidget);
    expect(find.text('系统消息'), findsOneWidget);
  });
}
