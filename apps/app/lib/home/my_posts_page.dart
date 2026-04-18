import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/post_api.dart';
import 'package:tianzhiling_app/home/moment_post_components.dart';
import 'package:tianzhiling_app/home/post_comments_sheet.dart';
import 'package:tianzhiling_app/models/post_models.dart';

class MyPostsPage extends StatefulWidget {
  const MyPostsPage({super.key});

  static const String routeName = '/my-posts';

  @override
  State<MyPostsPage> createState() => _MyPostsPageState();
}

class _MyPostsPageState extends State<MyPostsPage> {
  bool _isLoading = true;
  String? _errorMessage;
  List<PostItem> _posts = const [];

  String get _currentUserId =>
      AuthSessionStore.session.value?.user.id.trim() ?? '';

  @override
  void initState() {
    super.initState();
    _loadMyPosts();
  }

  Future<void> _loadMyPosts({bool showLoading = true}) async {
    final userId = _currentUserId;
    if (userId.isEmpty) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
        _errorMessage = null;
        _posts = const [];
      });
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
      final posts = await PostApi.getPosts();
      if (!mounted) {
        return;
      }

      final myPosts =
          posts.where((post) => post.userId.trim() == userId).toList()
            ..sort((a, b) => _postTimeOf(b).compareTo(_postTimeOf(a)));

      setState(() {
        _posts = myPosts;
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

  DateTime _postTimeOf(PostItem post) {
    return post.updatedAt ??
        post.createdAt ??
        DateTime.fromMillisecondsSinceEpoch(0);
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
          onCommentCreated: () => _loadMyPosts(showLoading: false),
        );
      },
    );

    if (!mounted) {
      return;
    }
    await _loadMyPosts(showLoading: false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text('我的动态'),
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
                        onPressed: _loadMyPosts,
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
            : _posts.isEmpty
            ? const MomentsFeedbackState(
                title: '还没有动态',
                subtitle: '发布第一条内容，让想念留下痕迹',
              )
            : RefreshIndicator(
                onRefresh: () => _loadMyPosts(showLoading: false),
                color: const Color(0xFF00A63E),
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                  children: [
                    for (final post in _posts) ...[
                      MomentPostCard(
                        post: post,
                        onCommentTap: () => _openComments(post),
                        onReplyTap: (comment) =>
                            _openComments(post, replyToComment: comment),
                      ),
                      const SizedBox(height: 20),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}
