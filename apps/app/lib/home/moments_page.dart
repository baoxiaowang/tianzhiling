import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/api_exception.dart';
import 'package:tianzhiling_app/home/moment_post_components.dart';
import 'package:tianzhiling_app/api/post_api.dart';
import 'package:tianzhiling_app/home/post_comment_notification_center.dart';
import 'package:tianzhiling_app/home/post_comments_sheet.dart';
import 'package:tianzhiling_app/home/post_create_page.dart';
import 'package:tianzhiling_app/home/post_detail_page.dart';
import 'package:tianzhiling_app/models/post_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';

class MomentsPage extends StatefulWidget {
  const MomentsPage({super.key});

  @override
  State<MomentsPage> createState() => _MomentsPageState();
}

class _MomentsPageState extends State<MomentsPage> {
  bool _isLoading = true;
  String? _errorMessage;
  List<PostItem> _posts = const [];

  @override
  void initState() {
    super.initState();
    _loadPosts();
  }

  Future<void> _loadPosts({bool showLoading = true}) async {
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
      final posts = await PostApi.getPosts();

      if (!mounted) {
        return;
      }

      setState(() {
        _posts = posts;
        _isLoading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = error.message.isNotEmpty ? error.message : '加载动态失败';
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = '加载动态失败，请稍后重试';
        _isLoading = false;
      });
    }
  }

  Future<void> _openCreatePage() async {
    final created = await Navigator.of(
      context,
    ).push<bool>(MaterialPageRoute(builder: (_) => const PostCreatePage()));

    if (!mounted || created != true) {
      return;
    }

    await _loadPosts(showLoading: false);
    await PostCommentNotificationCenter.instance.refresh();
  }

  Future<void> _openLatestNotification() async {
    final latest =
        PostCommentNotificationCenter.instance.summaryNotifier.value?.latest;
    if (latest == null || latest.postId.trim().isEmpty) {
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PostDetailPage(postId: latest.postId),
      ),
    );

    await _loadPosts(showLoading: false);
    await PostCommentNotificationCenter.instance.refresh();
  }

  Future<void> _openComments(
    PostItem post, {
    PostCommentItem? replyToComment,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return PostCommentsSheet(
          post: post,
          replyToComment: replyToComment,
          onCommentCreated: () async {
            await _loadPosts(showLoading: false);
            await PostCommentNotificationCenter.instance.refresh();
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: ColoredBox(
        color: Colors.white,
        child: SafeArea(
          top: false,
          bottom: false,
          child: Stack(
            children: [
              RefreshIndicator(
                color: const Color(0xFF00A63E),
                onRefresh: () => _loadPosts(showLoading: false),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.only(bottom: 128),
                  children: [
                    const _MomentsBanner(),
                    const _BannerIndicator(),
                    ValueListenableBuilder<PostCommentNotificationSummary?>(
                      valueListenable: PostCommentNotificationCenter
                          .instance
                          .summaryNotifier,
                      builder: (context, summary, _) {
                        if ((summary?.unreadCount ?? 0) > 0 &&
                            summary?.latest != null) {
                          return Column(
                            children: [
                              const SizedBox(height: 12),
                              _NewMessagePill(
                                summary: summary!,
                                onTap: _openLatestNotification,
                              ),
                              const SizedBox(height: 16),
                            ],
                          );
                        }

                        return const SizedBox(height: 12);
                      },
                    ),
                    _MomentsFeed(
                      isLoading: _isLoading,
                      errorMessage: _errorMessage,
                      posts: _posts,
                      onRetry: _loadPosts,
                      onCommentTap: (post) => _openComments(post),
                      onReplyTap: (post, comment) async {
                        await _openComments(post, replyToComment: comment);
                      },
                    ),
                  ],
                ),
              ),
              Positioned(
                right: 24,
                bottom: 96,
                child: _PublishButton(onTap: _openCreatePage),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MomentsBanner extends StatelessWidget {
  const _MomentsBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 216,
      color: Colors.black,
      child: Stack(
        children: [
          const Positioned(left: 42, top: 22, child: _GlowStar()),
          const Positioned(left: 40, top: 48, child: _BannerDust()),
          const Positioned(right: 86, top: 66, child: _BannerDust(size: 4)),
          const Positioned(right: 132, bottom: 74, child: _BannerDust(size: 3)),
          Positioned.fill(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 120, 24, 40),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: const [
                      Text(
                        '快速了解天之灵AI',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          height: 28 / 20,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      SizedBox(width: 8),
                      Icon(
                        Icons.chevron_right_rounded,
                        color: Colors.white,
                        size: 22,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '和另一片星空的人，首视频互动',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      height: 20 / 14,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GlowStar extends StatelessWidget {
  const _GlowStar();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 72,
      height: 72,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: 70,
            height: 70,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Color(0x99FFDF20),
                  blurRadius: 28,
                  spreadRadius: 4,
                ),
              ],
            ),
          ),
          const Icon(Icons.star_rounded, size: 60, color: Color(0xFFFFDF20)),
        ],
      ),
    );
  }
}

class _BannerDust extends StatelessWidget {
  const _BannerDust({this.size = 3});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        color: Colors.white24,
        shape: BoxShape.circle,
      ),
    );
  }
}

class _BannerIndicator extends StatelessWidget {
  const _BannerIndicator();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(top: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _IndicatorDot(color: Color(0xFF155DFC)),
          SizedBox(width: 8),
          _IndicatorDot(color: Color(0xFFD1D5DC)),
        ],
      ),
    );
  }
}

class _IndicatorDot extends StatelessWidget {
  const _IndicatorDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _NewMessagePill extends StatelessWidget {
  const _NewMessagePill({required this.summary, required this.onTap});

  final PostCommentNotificationSummary summary;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final latest = summary.latest;
    if (latest == null) {
      return const SizedBox.shrink();
    }

    return Center(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
            child: Container(
              height: 40,
              padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
              decoration: BoxDecoration(
                color: const Color(0xFF364153),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AppAvatar(
                    imageUrl: latest.actorAvatar,
                    size: 24,
                    borderRadius: BorderRadius.circular(12),
                    iconSize: 12,
                    placeholderColor: const Color(0xFF9CA3AF),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${summary.unreadCount}条新消息',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      height: 20 / 14,
                      fontWeight: FontWeight.w400,
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

class _MomentsFeed extends StatelessWidget {
  const _MomentsFeed({
    required this.isLoading,
    required this.errorMessage,
    required this.posts,
    required this.onRetry,
    required this.onCommentTap,
    required this.onReplyTap,
  });

  final bool isLoading;
  final String? errorMessage;
  final List<PostItem> posts;
  final Future<void> Function({bool showLoading}) onRetry;
  final ValueChanged<PostItem> onCommentTap;
  final Future<void> Function(PostItem post, PostCommentItem comment)
  onReplyTap;

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Padding(
        padding: EdgeInsets.only(top: 120),
        child: Center(
          child: CircularProgressIndicator(color: Color(0xFF00A63E)),
        ),
      );
    }

    if (errorMessage != null && posts.isEmpty) {
      return MomentsFeedbackState(
        title: errorMessage!,
        actionLabel: '重新加载',
        onActionTap: () {
          onRetry();
        },
      );
    }

    if (posts.isEmpty) {
      return const MomentsFeedbackState(
        title: '还没有动态',
        subtitle: '发布第一条内容，让想念留下痕迹',
      );
    }

    return Column(
      children: [
        for (final post in posts) ...[
          MomentPostCard(
            post: post,
            onCommentTap: () => onCommentTap(post),
            onReplyTap: (comment) => onReplyTap(post, comment),
          ),
          const SizedBox(height: 20),
        ],
      ],
    );
  }
}

class _PublishButton extends StatelessWidget {
  const _PublishButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 56,
        height: 56,
        decoration: const BoxDecoration(
          color: Color(0xFF1E2939),
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: Color(0x1A000000),
              blurRadius: 15,
              offset: Offset(0, 10),
            ),
            BoxShadow(
              color: Color(0x1A000000),
              blurRadius: 6,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.photo_camera_outlined, color: Colors.white, size: 22),
            SizedBox(height: 2),
            Text(
              '发布',
              style: TextStyle(
                color: Colors.white,
                fontSize: 12,
                height: 16 / 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
