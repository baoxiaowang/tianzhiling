import 'package:flutter/material.dart';
import '../config/brand_config.dart';
import 'package:tianzhiling_app/agent/agent_create_flow_page.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/conversation_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/chat/chat_conversation_page.dart';
import 'package:tianzhiling_app/home/active_conversation_store.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';

class HomeChatPage extends StatefulWidget {
  const HomeChatPage({super.key});

  @override
  State<HomeChatPage> createState() => _HomeChatPageState();
}

class _HomeChatPageState extends State<HomeChatPage> {
  bool _loading = true;
  String? _error;
  ConversationSummary? _conversation;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() { _loading = true; _error = null; });

    try {
      // Use the shared store
      await ActiveConversationStore.load();
      if (!mounted) return;

      final active = ActiveConversationStore.active.value;
      if (active != null) {
        setState(() { _conversation = active; _loading = false; });
        return;
      }

      // Fallback: try loading directly
      final conversations = await ConversationApi.getConversations();
      if (!mounted) return;
      if (conversations.isNotEmpty) {
        ActiveConversationStore.select(conversations.first);
        setState(() { _conversation = conversations.first; _loading = false; });
        return;
      }

      // No conversations in list, try entry endpoint (returns default agent's conversation)
      final entry = await ConversationApi.getEntryConversation();
      if (!mounted) return;
      if (entry != null) {
        ActiveConversationStore.select(entry);
        setState(() { _conversation = entry; _loading = false; });
      } else {
        setState(() { _loading = false; });
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.requiresReLogin) {
        await AuthSessionStore.clear();
        if (!mounted) return;
        Navigator.of(context).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
        return;
      }
      setState(() { _error = e.message; _loading = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _error = '加载失败'; _loading = false; });
    }
  }

  /// Called when returning from other pages to refresh the active conversation.
  void _refreshActive() {
    final active = ActiveConversationStore.active.value;
    if (active != null && active.id != _conversation?.id) {
      setState(() { _conversation = active; });
    }
  }

  @override
  Widget build(BuildContext context) {
    // Check for updates whenever this widget rebuilds
    _refreshActive();

    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!, style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _load, child: const Text('重试')),
          ],
        ),
      );
    }
    if (_conversation != null) {
      return ChatConversationPage(
        key: ValueKey(_conversation!.id),
        conversation: _conversation!,
      );
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.psychology_outlined, size: 80, color: Colors.grey),
            const SizedBox(height: 20),
            const Text('还没有${BrandConfig.name}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            const Text('创建一位你思念的人，和他说说话吧', style: TextStyle(color: Colors.grey, fontSize: 14), textAlign: TextAlign.center),
            const SizedBox(height: 28),
            ElevatedButton.icon(
              onPressed: () {
                Navigator.of(context).pushNamed(AgentCreateFlowPage.routeName).then((_) => _load());
              },
              icon: const Icon(Icons.add),
              label: const Text('创建${BrandConfig.name}'),
              style: ElevatedButton.styleFrom(minimumSize: const Size(200, 48)),
            ),
          ],
        ),
      ),
    );
  }
}
