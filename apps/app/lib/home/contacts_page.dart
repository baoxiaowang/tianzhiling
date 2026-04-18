import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/agent/agent_create_page.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/chat/chat_conversation_page.dart';
import 'package:tianzhiling_app/api/conversation_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/models/agent_models.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';

class ContactsPage extends StatefulWidget {
  const ContactsPage({super.key});

  @override
  State<ContactsPage> createState() => _ContactsPageState();
}

class _ContactsPageState extends State<ContactsPage> {
  bool _isLoading = true;
  String? _errorMessage;
  List<ConversationSummary> _conversations = const [];

  @override
  void initState() {
    super.initState();
    _loadConversations();
  }

  Future<void> _loadConversations({bool showLoading = true}) async {
    if (!mounted) {
      return;
    }

    if (showLoading) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    } else {
      setState(() {
        _errorMessage = null;
      });
    }

    try {
      final conversations = await ConversationApi.getConversations();
      if (!mounted) {
        return;
      }
      setState(() {
        _conversations = conversations;
        _isLoading = false;
      });
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await AuthSessionStore.clear();
        if (!mounted) {
          return;
        }
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
        return;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.message;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMessage = '加载通讯录失败，请稍后重试';
        _isLoading = false;
      });
    }
  }

  Future<void> _openCreatePage() async {
    if (!mounted) {
      return;
    }

    final result = await Navigator.of(
      context,
    ).pushNamed(AgentCreatePage.routeName);

    if (!mounted || result is! AgentSummary) {
      return;
    }

    await _loadConversations(showLoading: false);
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('已创建 Agent：${result.name}'),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 393),
          child: ColoredBox(
            color: Colors.white,
            child: SafeArea(
              bottom: false,
              child: Column(
                children: [
                  _ContactsHeader(onCreateTap: _openCreatePage),
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 14),
                    child: _SearchField(),
                  ),
                  Expanded(
                    child: _ContactsBody(
                      isLoading: _isLoading,
                      errorMessage: _errorMessage,
                      conversations: _conversations,
                      onRetry: _loadConversations,
                      onRefresh: () => _loadConversations(showLoading: false),
                      onConversationClosed: () =>
                          _loadConversations(showLoading: false),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ContactsHeader extends StatelessWidget {
  const _ContactsHeader({required this.onCreateTap});

  final VoidCallback onCreateTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Stack(
          alignment: Alignment.center,
          children: [
            const Center(
              child: Text(
                '通讯录',
                style: TextStyle(
                  color: Color(0xFF111111),
                  fontSize: 18,
                  height: 28 / 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: IconButton(
                onPressed: onCreateTap,
                style: IconButton.styleFrom(
                  minimumSize: const Size(28, 28),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  padding: EdgeInsets.zero,
                ),
                icon: const Icon(
                  CupertinoIcons.person_badge_plus,
                  size: 22,
                  color: Color(0xFF111111),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ContactsBody extends StatelessWidget {
  const _ContactsBody({
    required this.isLoading,
    required this.errorMessage,
    required this.conversations,
    required this.onRetry,
    required this.onRefresh,
    required this.onConversationClosed,
  });

  final bool isLoading;
  final String? errorMessage;
  final List<ConversationSummary> conversations;
  final Future<void> Function({bool showLoading}) onRetry;
  final Future<void> Function() onRefresh;
  final Future<void> Function() onConversationClosed;

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFFFF9B26)),
      );
    }

    if (errorMessage != null) {
      return _ContactsFeedbackState(
        title: errorMessage!,
        actionLabel: '重新加载',
        onActionTap: () => onRetry(),
      );
    }

    if (conversations.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        color: const Color(0xFFFF9B26),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(
            parent: BouncingScrollPhysics(),
          ),
          children: const [
            SizedBox(height: 120),
            _ContactsFeedbackState(
              title: '还没有对话',
              subtitle: '点击右上角加号，先创建一个想纪念的人',
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      color: const Color(0xFFFF9B26),
      child: ListView.separated(
        padding: EdgeInsets.zero,
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        itemCount: conversations.length,
        separatorBuilder: (context, index) => const _ContactDivider(),
        itemBuilder: (context, index) {
          return _ContactListItem(
            conversation: conversations[index],
            onClosed: onConversationClosed,
          );
        },
      ),
    );
  }
}

class _ContactsFeedbackState extends StatelessWidget {
  const _ContactsFeedbackState({
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onActionTap,
  });

  final String title;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onActionTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        children: [
          const Icon(
            CupertinoIcons.chat_bubble_2,
            size: 40,
            color: Color(0xFFB5BDC8),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF344054),
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            Text(
              subtitle!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF98A2B3),
                fontSize: 14,
                height: 20 / 14,
              ),
            ),
          ],
          if (actionLabel != null && onActionTap != null) ...[
            const SizedBox(height: 16),
            TextButton(
              onPressed: onActionTap,
              child: Text(
                actionLabel!,
                style: const TextStyle(
                  color: Color(0xFFFF9B26),
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(8),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: const Row(
        children: [
          Icon(CupertinoIcons.search, size: 16, color: Color(0xFF98A2B3)),
          SizedBox(width: 8),
          Text(
            '搜索对话',
            style: TextStyle(
              color: Color(0xFF99A1AF),
              fontSize: 14,
              height: 20 / 14,
            ),
          ),
        ],
      ),
    );
  }
}

class _ContactListItem extends StatelessWidget {
  const _ContactListItem({required this.conversation, required this.onClosed});

  final ConversationSummary conversation;
  final Future<void> Function() onClosed;

  @override
  Widget build(BuildContext context) {
    final previewText = _buildPreviewText(conversation.preview);

    return InkWell(
      onTap: () async {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ChatConversationPage(conversation: conversation),
          ),
        );
        await onClosed();
      },
      child: SizedBox(
        height: 72,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              _ConversationAvatar(conversation: conversation),
              const SizedBox(width: 12),
              Expanded(
                child: SizedBox(
                  height: 46,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              conversation.agentName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF101828),
                                fontSize: 16,
                                height: 24 / 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          Text(
                            _formatUpdatedAt(conversation.updatedAt),
                            style: const TextStyle(
                              color: Color(0xFF99A1AF),
                              fontSize: 12,
                              height: 16 / 12,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              previewText,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF99A1AF),
                                fontSize: 14,
                                height: 20 / 14,
                                fontWeight: FontWeight.w400,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _formatUpdatedAt(DateTime? value) {
    if (value == null) {
      return '';
    }

    final now = DateTime.now();
    final local = value.toLocal();
    final isSameDay =
        now.year == local.year &&
        now.month == local.month &&
        now.day == local.day;

    if (isSameDay) {
      final hour = local.hour.toString().padLeft(2, '0');
      final minute = local.minute.toString().padLeft(2, '0');
      return '$hour:$minute';
    }

    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    return '$month-$day';
  }

  static String _buildPreviewText(String preview) {
    final segments = preview
        .split('</fenge>')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList();
    final raw = segments.isNotEmpty ? segments.last : preview.trim();

    return raw.replaceAll(RegExp(r'<[^>]+>'), '').trim();
  }
}

class _ConversationAvatar extends StatelessWidget {
  const _ConversationAvatar({required this.conversation});

  final ConversationSummary conversation;

  @override
  Widget build(BuildContext context) {
    final avatarUrl = conversation.agentAvatar.trim();
    if (avatarUrl.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 48,
          height: 48,
          child: Image.network(
            avatarUrl,
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) {
              return _FallbackAvatar(conversation: conversation);
            },
          ),
        ),
      );
    }

    return _FallbackAvatar(conversation: conversation);
  }
}

class _FallbackAvatar extends StatelessWidget {
  const _FallbackAvatar({required this.conversation});

  final ConversationSummary conversation;

  @override
  Widget build(BuildContext context) {
    final isMale = conversation.agentSex == 1;
    final trimmedName = conversation.agentName.trim();
    final title = trimmedName.isEmpty ? 'A' : trimmedName.substring(0, 1);

    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: isMale
              ? const [Color(0xFFB6DBFF), Color(0xFF5D8FFF)]
              : const [Color(0xFFFFD9E5), Color(0xFFFF8DAA)],
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        title,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _ContactDivider extends StatelessWidget {
  const _ContactDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(left: 76),
      child: Divider(height: 1, thickness: 0.5, color: Color(0xFFF0F2F5)),
    );
  }
}
