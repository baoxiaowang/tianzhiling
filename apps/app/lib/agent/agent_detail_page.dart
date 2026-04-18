import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/agent/agent_profile_page.dart';
import 'package:tianzhiling_app/api/agent_api.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/models/agent_models.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';

class AgentDetailPage extends StatefulWidget {
  const AgentDetailPage({super.key, required this.conversation});

  final ConversationSummary conversation;

  static Future<void> open(
    BuildContext context,
    ConversationSummary conversation,
  ) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => AgentDetailPage(conversation: conversation),
      ),
    );
  }

  @override
  State<AgentDetailPage> createState() => _AgentDetailPageState();
}

class _AgentDetailPageState extends State<AgentDetailPage> {
  AgentSummary? _agent;

  @override
  void initState() {
    super.initState();
    _loadAgentDetail();
  }

  Future<void> _loadAgentDetail() async {
    try {
      final agent = await AgentApi.getAgentDetail(widget.conversation.agentId);

      if (!mounted) {
        return;
      }

      setState(() {
        _agent = agent;
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
      }
    } catch (_) {
      // Keep the original conversation snapshot when detail refresh fails.
    }
  }

  Future<void> _openAgentProfile() async {
    await AgentProfilePage.open(context, widget.conversation);

    if (!mounted) {
      return;
    }

    await _loadAgentDetail();
  }

  @override
  Widget build(BuildContext context) {
    final conversation = widget.conversation;
    final title = _agent?.name.trim().isNotEmpty == true
        ? _agent!.name.trim()
        : conversation.agentName.trim().isEmpty
        ? '未命名智能体'
        : conversation.agentName;
    final avatarUrl = _agent?.avatar.trim().isNotEmpty == true
        ? _agent!.avatar.trim()
        : conversation.agentAvatar;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(
            CupertinoIcons.back,
            size: 22,
            color: Color(0xFF111111),
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            _AgentProfileHeader(title: title, avatarUrl: avatarUrl),
            const SizedBox(height: 8),
            _SectionCard(
              child: _ActionTile(
                title: '朋友资料',
                subtitle: _buildProfileDescription(conversation, _agent),
                onTap: _openAgentProfile,
              ),
            ),
            const SizedBox(height: 8),
            const _SectionCard(
              child: Column(
                children: [
                  _ActionTile(title: '声音模型'),
                  _MenuDivider(),
                  _ActionTile(title: 'VIP与增值配置'),
                  _MenuDivider(),
                  _ActionTile(title: '导入聊天记录'),
                ],
              ),
            ),
            const SizedBox(height: 8),
            _SectionCard(child: _FriendMomentsTile(avatarUrl: avatarUrl)),
            const SizedBox(height: 8),
            _SectionCard(
              child: _BottomActionButton(
                icon: CupertinoIcons.chat_bubble,
                title: '发消息',
                onTap: () => Navigator.of(context).maybePop(),
              ),
            ),
            const _SectionHairline(),
            _SectionCard(
              child: _BottomActionButton(
                icon: CupertinoIcons.phone,
                title: '音视频通话',
                onTap: () {},
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _buildProfileDescription(
    ConversationSummary conversation,
    AgentSummary? agent,
  ) {
    final createdAt = agent?.createdAt ?? conversation.createdAt;
    final year = createdAt?.year;
    final relation = (agent?.iCallAgent ?? conversation.iCallAgent).trim();
    final callMe = (agent?.agentCallMe ?? conversation.agentCallMe).trim();
    final description = (agent?.description ?? '').trim();
    final preview = description.isNotEmpty
        ? description
        : conversation.preview.trim();
    final sexLabel = (agent?.sex ?? conversation.agentSex) == 1 ? '他' : '她';

    if (preview.isNotEmpty) {
      return preview;
    }

    final buffer = StringBuffer();

    if (year != null) {
      buffer.write('$year年，');
    }

    if (relation.isNotEmpty) {
      buffer.write('你称呼$sexLabel为“$relation”，');
    } else {
      buffer.write('$sexLabel是你正在纪念的重要存在，');
    }

    if (callMe.isNotEmpty) {
      buffer.write('$sexLabel会叫你“$callMe”，');
    }

    buffer.write('这里先保留一段专属简介，待你后面告诉我详情字段后，我再把它补成正式版本。');

    return buffer.toString();
  }
}

class _AgentProfileHeader extends StatelessWidget {
  const _AgentProfileHeader({required this.title, required this.avatarUrl});

  final String title;
  final String avatarUrl;

  @override
  Widget build(BuildContext context) {
    return _SectionCard(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 16, 28),
        child: Row(
          children: [
            AppAvatar(
              imageUrl: avatarUrl,
              size: 60,
              borderRadius: BorderRadius.circular(14),
              iconSize: 24,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  color: Color(0xFF222222),
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFD9DADD), width: 1),
              ),
              alignment: Alignment.center,
              child: const Icon(
                CupertinoIcons.ellipsis,
                size: 16,
                color: Color(0xFF9A9CA3),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(color: Colors.white, child: child);
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.title, this.subtitle, this.onTap});

  final String title;
  final String? subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final hasSubtitle = subtitle != null && subtitle!.trim().isNotEmpty;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          hasSubtitle ? 14 : 0,
          16,
          hasSubtitle ? 14 : 0,
        ),
        child: SizedBox(
          height: hasSubtitle ? null : 60,
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisAlignment: hasSubtitle
                      ? MainAxisAlignment.center
                      : MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Color(0xFF111111),
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    if (hasSubtitle) ...[
                      const SizedBox(height: 6),
                      Text(
                        subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF8A8F98),
                          fontSize: 13,
                          height: 18 / 13,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const Icon(
                CupertinoIcons.chevron_right,
                size: 16,
                color: Color(0xFF8F939A),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenuDivider extends StatelessWidget {
  const _MenuDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(left: 16),
      child: Divider(height: 1, thickness: 0.5, color: Color(0xFFEAECEF)),
    );
  }
}

class _SectionHairline extends StatelessWidget {
  const _SectionHairline();

  @override
  Widget build(BuildContext context) {
    return Container(height: 0.5, color: const Color(0xFFEAECEF));
  }
}

class _FriendMomentsTile extends StatelessWidget {
  const _FriendMomentsTile({required this.avatarUrl});

  final String avatarUrl;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {},
      child: SizedBox(
        height: 72,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              const Text(
                '好友动态',
                style: TextStyle(
                  color: Color(0xFF111111),
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 14),
              _MomentThumb(imageUrl: avatarUrl),
              const SizedBox(width: 4),
              _MomentThumb(imageUrl: avatarUrl),
              const Spacer(),
              const Icon(
                CupertinoIcons.chevron_right,
                size: 16,
                color: Color(0xFF8F939A),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MomentThumb extends StatelessWidget {
  const _MomentThumb({required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(2),
      child: SizedBox(
        width: 38,
        height: 38,
        child: imageUrl.trim().isEmpty
            ? Container(color: const Color(0xFFF2F3F5))
            : Image.network(
                imageUrl,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) {
                  return Container(color: const Color(0xFFF2F3F5));
                },
              ),
      ),
    );
  }
}

class _BottomActionButton extends StatelessWidget {
  const _BottomActionButton({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        height: 56,
        alignment: Alignment.center,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 19, color: const Color(0xFF637897)),
            const SizedBox(width: 8),
            Text(
              title,
              style: const TextStyle(
                color: Color(0xFF637897),
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
