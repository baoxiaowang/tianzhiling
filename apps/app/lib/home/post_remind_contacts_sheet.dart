import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/conversation_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';

class PostRemindContactsSheet extends StatefulWidget {
  const PostRemindContactsSheet({
    super.key,
    required this.initialSelectedAgentIds,
  });

  final Set<String> initialSelectedAgentIds;

  @override
  State<PostRemindContactsSheet> createState() =>
      _PostRemindContactsSheetState();
}

class _PostRemindContactsSheetState extends State<PostRemindContactsSheet> {
  final TextEditingController _searchController = TextEditingController();

  bool _isLoading = true;
  String? _errorMessage;
  List<ConversationSummary> _conversations = const <ConversationSummary>[];
  late Set<String> _selectedAgentIds;

  @override
  void initState() {
    super.initState();
    _selectedAgentIds = <String>{...widget.initialSelectedAgentIds};
    _searchController.addListener(_handleSearchChanged);
    _loadConversations();
  }

  @override
  void dispose() {
    _searchController
      ..removeListener(_handleSearchChanged)
      ..dispose();
    super.dispose();
  }

  void _handleSearchChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _loadConversations() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

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
        _errorMessage = error.message.isNotEmpty ? error.message : '加载通讯录失败';
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

  void _toggleSelection(ConversationSummary conversation) {
    setState(() {
      if (_selectedAgentIds.contains(conversation.agentId)) {
        _selectedAgentIds.remove(conversation.agentId);
      } else {
        _selectedAgentIds.add(conversation.agentId);
      }
    });
  }

  List<ConversationSummary> get _filteredConversations {
    final keyword = _searchController.text.trim().toLowerCase();
    if (keyword.isEmpty) {
      return _conversations;
    }

    return _conversations.where((conversation) {
      final name = conversation.agentName.trim().toLowerCase();
      final iCall = conversation.iCallAgent.trim().toLowerCase();
      final callMe = conversation.agentCallMe.trim().toLowerCase();
      return name.contains(keyword) ||
          iCall.contains(keyword) ||
          callMe.contains(keyword);
    }).toList();
  }

  void _submit() {
    final selected = _conversations
        .where((item) => _selectedAgentIds.contains(item.agentId))
        .toList();
    Navigator.of(context).pop(selected);
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).padding.bottom;

    return FractionallySizedBox(
      heightFactor: 0.92,
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        child: ColoredBox(
          color: Colors.white,
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 5,
                decoration: BoxDecoration(
                  color: const Color(0xFFE5E7EB),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 12, 8),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(
                        CupertinoIcons.xmark,
                        size: 22,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const Expanded(
                      child: Text(
                        '提醒谁看',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Color(0xFF111827),
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: _submit,
                      style: TextButton.styleFrom(
                        foregroundColor: const Color(0xFF00B578),
                      ),
                      child: const Text(
                        '完成',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: _ContactsSearchField(controller: _searchController),
              ),
              Expanded(child: _buildBody()),
              SizedBox(height: bottomInset > 0 ? bottomInset : 12),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF00B578)),
      );
    }

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _errorMessage!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF374151),
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: _loadConversations,
                child: const Text(
                  '重新加载',
                  style: TextStyle(
                    color: Color(0xFF00B578),
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final items = _filteredConversations;
    if (items.isEmpty) {
      return const Center(
        child: Text(
          '没有找到匹配的联系人',
          style: TextStyle(
            color: Color(0xFF9CA3AF),
            fontSize: 14,
            fontWeight: FontWeight.w400,
          ),
        ),
      );
    }

    final grouped = _groupConversations(items);
    final sections = grouped.entries.toList();

    return ListView.builder(
      padding: EdgeInsets.zero,
      physics: const BouncingScrollPhysics(),
      itemCount: sections.length,
      itemBuilder: (context, sectionIndex) {
        final entry = sections[sectionIndex];
        final title = entry.key;
        final conversations = entry.value;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              color: const Color(0xFFF7F8FA),
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
              child: Text(
                title,
                style: const TextStyle(
                  color: Color(0xFF9CA3AF),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            for (var i = 0; i < conversations.length; i++)
              _RemindContactItem(
                conversation: conversations[i],
                selected: _selectedAgentIds.contains(conversations[i].agentId),
                onTap: () => _toggleSelection(conversations[i]),
              ),
          ],
        );
      },
    );
  }

  Map<String, List<ConversationSummary>> _groupConversations(
    List<ConversationSummary> source,
  ) {
    final map = <String, List<ConversationSummary>>{};

    for (final item in source) {
      final tag = _buildSectionTag(item.agentName);
      map.putIfAbsent(tag, () => <ConversationSummary>[]).add(item);
    }

    final sortedKeys = map.keys.toList()
      ..sort((left, right) {
        if (left == '#') {
          return 1;
        }
        if (right == '#') {
          return -1;
        }
        return left.compareTo(right);
      });

    return <String, List<ConversationSummary>>{
      for (final key in sortedKeys) key: map[key]!,
    };
  }

  String _buildSectionTag(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return '#';
    }

    final codeUnit = trimmed.codeUnitAt(0);
    final upper = String.fromCharCode(codeUnit).toUpperCase();
    final matched = RegExp(r'^[A-Z]$').hasMatch(upper);
    return matched ? upper : '#';
  }
}

class _ContactsSearchField extends StatelessWidget {
  const _ContactsSearchField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const SizedBox(width: 12),
          const Icon(CupertinoIcons.search, size: 16, color: Color(0xFF98A2B3)),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: controller,
              textAlignVertical: TextAlignVertical.center,
              decoration: const InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                hintText: '搜索',
                hintStyle: TextStyle(
                  color: Color(0xFF99A1AF),
                  fontSize: 14,
                  fontWeight: FontWeight.w400,
                ),
              ),
              style: const TextStyle(
                color: Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w400,
              ),
            ),
          ),
          if (controller.text.trim().isNotEmpty)
            GestureDetector(
              onTap: controller.clear,
              behavior: HitTestBehavior.opaque,
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 10),
                child: Icon(
                  CupertinoIcons.clear_thick_circled,
                  size: 16,
                  color: Color(0xFFB6BDC7),
                ),
              ),
            )
          else
            const SizedBox(width: 12),
        ],
      ),
    );
  }
}

class _RemindContactItem extends StatelessWidget {
  const _RemindContactItem({
    required this.conversation,
    required this.selected,
    required this.onTap,
  });

  final ConversationSummary conversation;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        height: 72,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            _SelectionIndicator(selected: selected),
            const SizedBox(width: 14),
            AppAvatar(
              imageUrl: conversation.agentAvatar,
              size: 44,
              borderRadius: BorderRadius.circular(10),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                conversation.agentName.trim().isEmpty
                    ? '未命名联系人'
                    : conversation.agentName.trim(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF111827),
                  fontSize: 18,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectionIndicator extends StatelessWidget {
  const _SelectionIndicator({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: selected ? const Color(0xFF00B578) : Colors.white,
        border: Border.all(
          color: selected ? const Color(0xFF00B578) : const Color(0xFFD1D5DB),
          width: 1.2,
        ),
      ),
      alignment: Alignment.center,
      child: selected
          ? const Icon(CupertinoIcons.check_mark, size: 14, color: Colors.white)
          : null,
    );
  }
}
