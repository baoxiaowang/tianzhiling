import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/post_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';
import 'package:tianzhiling_app/models/post_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';

class AgentMomentsPage extends StatefulWidget {
  const AgentMomentsPage({super.key, required this.conversation});

  final ConversationSummary conversation;

  @override
  State<AgentMomentsPage> createState() => _AgentMomentsPageState();
}

class _AgentMomentsPageState extends State<AgentMomentsPage> {
  bool _isLoading = true;
  String? _errorMessage;
  List<PostItem> _posts = const [];

  @override
  void initState() {
    super.initState();
    _loadPosts();
  }

  Future<void> _loadPosts({bool showLoading = true}) async {
    if (!mounted) return;
    if (showLoading) {
      setState(() { _isLoading = true; _errorMessage = null; });
    }

    try {
      final posts = await PostApi.getPosts();
      if (!mounted) return;
      // Filter posts that mention this agent
      final agentId = widget.conversation.agentId;
      final filtered = posts.where((p) => p.remindAgentIds.contains(agentId)).toList();
      setState(() { _posts = filtered; _isLoading = false; });
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
      setState(() { _errorMessage = '加载动态失败'; _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final agentName = widget.conversation.agentName;
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: Text('$agentName的动态', style: const TextStyle(color: Color(0xFF1A1A1A), fontSize: 17, fontWeight: FontWeight.w600)),
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
            ElevatedButton(onPressed: _loadPosts, child: const Text('重试')),
          ],
        ),
      );
    }
    if (_posts.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(CupertinoIcons.photo, size: 56, color: Color(0xFFCCCCCC)),
            SizedBox(height: 12),
            Text('暂无动态', style: TextStyle(color: Color(0xFF999999), fontSize: 15)),
            SizedBox(height: 4),
            Text('在动态广场发布内容时@TA，会显示在这里', style: TextStyle(color: Color(0xFFCCCCCC), fontSize: 13)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => _loadPosts(showLoading: false),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _posts.length,
        itemBuilder: (context, index) {
          final post = _posts[index];
          return Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AppAvatar(imageUrl: post.authorAvatar, size: 32, borderRadius: BorderRadius.circular(8), iconSize: 14),
                    const SizedBox(width: 10),
                    Text(post.authorName, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF1A1A1A))),
                  ],
                ),
                const SizedBox(height: 10),
                Text(post.content, style: const TextStyle(fontSize: 14, height: 1.5, color: Color(0xFF333333))),
                if (post.images.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    height: 80,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: post.images.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, i) => ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.network(post.images[i], width: 80, height: 80, fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => Container(width: 80, height: 80, color: const Color(0xFFF0F0F0)),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}
