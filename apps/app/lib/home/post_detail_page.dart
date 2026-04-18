import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/api_exception.dart';
import 'package:tianzhiling_app/api/post_api.dart';
import 'package:tianzhiling_app/home/post_comments_sheet.dart';
import 'package:tianzhiling_app/models/post_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';

class PostDetailPage extends StatefulWidget {
  const PostDetailPage({super.key, required this.postId});

  final String postId;

  @override
  State<PostDetailPage> createState() => _PostDetailPageState();
}

class _PostDetailPageState extends State<PostDetailPage> {
  bool _isLoading = true;
  String? _errorMessage;
  PostItem? _post;

  @override
  void initState() {
    super.initState();
    _loadPost();
    _markRead();
  }

  Future<void> _loadPost({bool showLoading = true}) async {
    if (showLoading) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final post = await PostApi.getPostDetail(widget.postId);
      if (!mounted) {
        return;
      }

      setState(() {
        _post = post;
        _isLoading = false;
        _errorMessage = null;
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

  Future<void> _markRead() async {
    try {
      await PostApi.markCommentNotificationsRead(widget.postId);
    } catch (_) {
      // Ignore mark-read failures so detail page still opens normally.
    }
  }

  Future<void> _openComments({PostCommentItem? replyToComment}) async {
    final post = _post;
    if (post == null) {
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        return PostCommentsSheet(
          post: post,
          replyToComment: replyToComment,
          onCommentCreated: () => _loadPost(showLoading: false),
        );
      },
    );

    await _loadPost(showLoading: false);
  }

  @override
  Widget build(BuildContext context) {
    final post = _post;

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text('动态详情'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
      ),
      body: SafeArea(
        top: false,
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: Color(0xFF00A63E)),
              )
            : _errorMessage != null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _errorMessage!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFF364153),
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: _loadPost,
                        child: const Text(
                          '重新加载',
                          style: TextStyle(
                            color: Color(0xFF00A63E),
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            : post == null
            ? const SizedBox.shrink()
            : RefreshIndicator(
                onRefresh: () => _loadPost(showLoading: false),
                color: const Color(0xFF00A63E),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                  children: [
                    _DetailPostCard(
                      post: post,
                      onCommentTap: () => _openComments(),
                      onReplyTap: (comment) =>
                          _openComments(replyToComment: comment),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _DetailPostCard extends StatelessWidget {
  const _DetailPostCard({
    required this.post,
    required this.onCommentTap,
    required this.onReplyTap,
  });

  final PostItem post;
  final VoidCallback onCommentTap;
  final ValueChanged<PostCommentItem> onReplyTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppAvatar(
            imageUrl: post.authorAvatar,
            size: 42,
            borderRadius: BorderRadius.circular(10),
            iconSize: 18,
            placeholderColor: const Color(0xFFE5E7EB),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  post.authorName.trim().isEmpty ? '天之灵用户' : post.authorName,
                  style: const TextStyle(
                    color: Color(0xFF111111),
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (post.content.trim().isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    post.content,
                    style: const TextStyle(
                      color: Color(0xFF364153),
                      fontSize: 15,
                      height: 22 / 15,
                    ),
                  ),
                ],
                if (post.images.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final image in post.images)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.network(
                            image,
                            width: 104,
                            height: 104,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) {
                              return Container(
                                width: 104,
                                height: 104,
                                color: const Color(0xFFF3F4F6),
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 12),
                Row(
                  children: [
                    Text(
                      _formatRelativeTime(post.updatedAt ?? post.createdAt),
                      style: const TextStyle(
                        color: Color(0xFF6A7282),
                        fontSize: 14,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const Spacer(),
                    const Icon(
                      Icons.mode_comment_outlined,
                      size: 18,
                      color: Color(0xFF667085),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '${post.commentCount}',
                      style: const TextStyle(
                        color: Color(0xFF667085),
                        fontSize: 14,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ],
                ),
                if (post.comments.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF3F4F6),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (
                          var index = 0;
                          index < post.comments.length;
                          index++
                        ) ...[
                          _DetailCommentLine(
                            comment: post.comments[index],
                            onTap: () => onReplyTap(post.comments[index]),
                          ),
                          if (index != post.comments.length - 1)
                            const SizedBox(height: 8),
                        ],
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: TextButton(
                    onPressed: onCommentTap,
                    style: TextButton.styleFrom(
                      foregroundColor: const Color(0xFF00A63E),
                      backgroundColor: const Color(0xFFF0FDF4),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text(
                      '查看并评论',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _formatRelativeTime(DateTime? value) {
    if (value == null) {
      return '';
    }

    final now = DateTime.now();
    final local = value.toLocal();
    final difference = now.difference(local);

    if (difference.inMinutes < 1) {
      return '刚刚';
    }
    if (difference.inHours < 1) {
      return '${difference.inMinutes}分钟前';
    }
    if (difference.inDays < 1) {
      return '${difference.inHours}小时前';
    }
    if (difference.inDays < 30) {
      return '${difference.inDays}天前';
    }

    return '${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
  }
}

class _DetailCommentLine extends StatelessWidget {
  const _DetailCommentLine({required this.comment, required this.onTap});

  final PostCommentItem comment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final authorName = comment.authorName.trim().isEmpty
        ? '天之灵用户'
        : comment.authorName;
    final replyTargetName = comment.replyToUserName.trim();

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: RichText(
        text: TextSpan(
          style: const TextStyle(
            color: Color(0xFF364153),
            fontSize: 14,
            height: 20 / 14,
          ),
          children: [
            TextSpan(
              text: authorName,
              style: const TextStyle(
                color: Color(0xFF111111),
                fontWeight: FontWeight.w600,
              ),
            ),
            if (replyTargetName.isNotEmpty) ...[
              const TextSpan(text: ' 回复 '),
              TextSpan(
                text: replyTargetName,
                style: const TextStyle(
                  color: Color(0xFF111111),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const TextSpan(text: '：'),
            TextSpan(text: comment.content),
          ],
        ),
      ),
    );
  }
}
