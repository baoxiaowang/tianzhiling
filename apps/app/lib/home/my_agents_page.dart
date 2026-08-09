import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/agent/agent_create_flow_page.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/conversation_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/home/active_conversation_store.dart';
import 'package:tianzhiling_app/models/agent_models.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';

class MyAgentsPage extends StatefulWidget {
  const MyAgentsPage({super.key});

  static const String routeName = '/my-agents';

  @override
  State<MyAgentsPage> createState() => _MyAgentsPageState();
}

class _MyAgentsPageState extends State<MyAgentsPage> {
  bool _isLoading = true;
  String? _errorMessage;
  List<ConversationSummary> _conversations = const [];

  @override
  void initState() {
    super.initState();
    _loadConversations();
  }

  Future<void> _loadConversations({bool showLoading = true}) async {
    if (!mounted) return;
    if (showLoading) {
      setState(() { _isLoading = true; _errorMessage = null; });
    }

    try {
      final conversations = await ConversationApi.getConversations();
      if (!mounted) return;
      setState(() { _conversations = conversations; _isLoading = false; });
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await AuthSessionStore.clear();
        if (!mounted) return;
        Navigator.of(context).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
        return;
      }
      if (!mounted) return;
      setState(() { _errorMessage = error.message; _isLoading = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _errorMessage = '加载失败，请稍后重试'; _isLoading = false; });
    }
  }

  void _selectAgent(ConversationSummary conversation) {
    ActiveConversationStore.select(conversation);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('已切换'),
        content: Text('当前聊天对象已切换为「${conversation.agentName}」'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('确定'),
          ),
        ],
      ),
    );
    setState(() {});
  }

  Future<void> _createAgent() async {
    final result = await Navigator.of(context).pushNamed(AgentCreateFlowPage.routeName);
    if (!mounted || result is! AgentSummary) return;
    await _loadConversations(showLoading: false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text('我的天之灵', style: TextStyle(color: Color(0xFF1A1A1A), fontSize: 17, fontWeight: FontWeight.w600)),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFFF9B26)));
    }
    if (_errorMessage != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_errorMessage!, style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _loadConversations, child: const Text('重试')),
          ],
        ),
      );
    }

    final activeId = ActiveConversationStore.active.value?.id;

    return Column(
      children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '共 ${_conversations.length} 位天之灵',
                  style: const TextStyle(color: Color(0xFF999999), fontSize: 13),
                ),
              ),
              GestureDetector(
                onTap: _createAgent,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF9B26),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.add, size: 16, color: Colors.white),
                      SizedBox(width: 4),
                      Text('创建天之灵', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: _conversations.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(CupertinoIcons.person_2, size: 56, color: Color(0xFFCCCCCC)),
                      SizedBox(height: 12),
                      Text('还没有天之灵', style: TextStyle(color: Color(0xFF999999), fontSize: 16)),
                      SizedBox(height: 4),
                      Text('创建一位你思念的人吧', style: TextStyle(color: Color(0xFFCCCCCC), fontSize: 13)),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.only(top: 10),
                  itemCount: _conversations.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 1),
                  itemBuilder: (context, index) {
                    final conv = _conversations[index];
                    final isActive = conv.id == activeId;
                    return _AgentRow(
                      conversation: conv,
                      isActive: isActive,
                      onTap: () => _selectAgent(conv),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _AgentRow extends StatelessWidget {
  const _AgentRow({required this.conversation, required this.isActive, required this.onTap});
  final ConversationSummary conversation;
  final bool isActive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final callMe = conversation.agentCallMe.trim();
    return InkWell(
      onTap: onTap,
      child: Container(
        color: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            AppAvatar(
              imageUrl: conversation.agentAvatar,
              size: 52,
              borderRadius: BorderRadius.circular(12),
              iconSize: 24,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    conversation.agentName,
                    style: const TextStyle(color: Color(0xFF1A1A1A), fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  if (callMe.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      'TA叫你「$callMe」',
                      style: const TextStyle(color: Color(0xFF999999), fontSize: 12),
                    ),
                  ],
                ],
              ),
            ),
            if (isActive)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF3E0),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.check_circle, size: 14, color: Color(0xFFFF9B26)),
                    SizedBox(width: 4),
                    Text('当前', style: TextStyle(color: Color(0xFFFF9B26), fontSize: 12, fontWeight: FontWeight.w600)),
                  ],
                ),
              )
            else
              const Icon(CupertinoIcons.chevron_right, size: 16, color: Color(0xFFCFCFCF)),
          ],
        ),
      ),
    );
  }
}
