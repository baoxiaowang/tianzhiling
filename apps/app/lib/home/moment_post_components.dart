import 'package:flutter/material.dart';
import 'package:tianzhiling_app/models/post_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';

class MomentsFeedbackState extends StatelessWidget {
  const MomentsFeedbackState({
    super.key,
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
      padding: const EdgeInsets.fromLTRB(24, 120, 24, 0),
      child: Column(
        children: [
          const Icon(
            Icons.auto_awesome_outlined,
            size: 36,
            color: Color(0xFFB8C1CC),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF364153),
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 8),
            Text(
              subtitle!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF6A7282),
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
                  color: Color(0xFF00A63E),
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

class MomentPostCard extends StatelessWidget {
  const MomentPostCard({
    super.key,
    required this.post,
    required this.onCommentTap,
    required this.onReplyTap,
  });

  final PostItem post;
  final VoidCallback onCommentTap;
  final ValueChanged<PostCommentItem> onReplyTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PostAvatar(imageUrl: post.authorAvatar),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  post.authorName.trim().isEmpty ? '天之灵用户' : post.authorName,
                  style: const TextStyle(
                    color: Color(0xFF0A0A0A),
                    fontSize: 18,
                    height: 27 / 18,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (post.content.trim().isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    post.content,
                    style: const TextStyle(
                      color: Color(0xFF364153),
                      fontSize: 14,
                      height: 22.75 / 14,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
                if (post.images.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _PostImageGrid(images: post.images),
                ],
                const SizedBox(height: 12),
                Row(
                  children: [
                    Text(
                      formatMomentRelativeTime(
                        post.updatedAt ?? post.createdAt,
                      ),
                      style: const TextStyle(
                        color: Color(0xFF6A7282),
                        fontSize: 14,
                        height: 20 / 14,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const Spacer(),
                    const _PostStat(
                      icon: Icons.favorite_border_rounded,
                      count: '0',
                    ),
                    const SizedBox(width: 16),
                    _PostStat(
                      icon: Icons.mode_comment_outlined,
                      count: '${post.commentCount}',
                      onTap: onCommentTap,
                    ),
                  ],
                ),
                if (post.comments.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _PostCommentSection(
                    comments: post.comments,
                    onCommentTap: onReplyTap,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PostCommentSection extends StatelessWidget {
  const _PostCommentSection({
    required this.comments,
    required this.onCommentTap,
  });

  final List<PostCommentItem> comments;
  final ValueChanged<PostCommentItem> onCommentTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var index = 0; index < comments.length; index++) ...[
            _PostCommentLine(
              comment: comments[index],
              onTap: () => onCommentTap(comments[index]),
            ),
            if (index != comments.length - 1) const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

class _PostCommentLine extends StatelessWidget {
  const _PostCommentLine({required this.comment, required this.onTap});

  final PostCommentItem comment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final authorName = comment.authorName.trim().isEmpty
        ? '天之灵用户'
        : comment.authorName;
    final replyToUserName = comment.replyToUserName.trim();

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
            if (replyToUserName.isNotEmpty) ...[
              const TextSpan(text: ' 回复 '),
              TextSpan(
                text: replyToUserName,
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

class _PostAvatar extends StatelessWidget {
  const _PostAvatar({required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    return AppAvatar(
      imageUrl: imageUrl,
      size: 40,
      borderRadius: BorderRadius.circular(10),
      iconSize: 18,
      placeholderColor: const Color(0xFFE5E7EB),
    );
  }
}

class _PostImageGrid extends StatelessWidget {
  const _PostImageGrid({required this.images});

  final List<String> images;

  @override
  Widget build(BuildContext context) {
    final displayImages = images
        .map((image) => image.trim())
        .where((image) => image.isNotEmpty)
        .take(9)
        .toList();

    if (displayImages.isEmpty) {
      return const SizedBox.shrink();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final geometry = _PostImageGridGeometry.resolve(
          count: displayImages.length,
          maxWidth: constraints.maxWidth,
        );

        return SizedBox(
          width: geometry.gridWidth,
          child: Wrap(
            spacing: geometry.spacing,
            runSpacing: geometry.spacing,
            children: List<Widget>.generate(displayImages.length, (index) {
              final image = displayImages[index];

              return GestureDetector(
                onTap: () {
                  Navigator.of(context).push(
                    PageRouteBuilder<void>(
                      opaque: false,
                      pageBuilder: (context, animation, secondaryAnimation) {
                        return _PostImagePreviewPage(
                          images: displayImages,
                          initialIndex: index,
                        );
                      },
                    ),
                  );
                },
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(geometry.borderRadius),
                  child: _NetworkMomentImage(
                    imageUrl: image,
                    width: geometry.itemWidth,
                    height: geometry.itemHeight,
                  ),
                ),
              );
            }),
          ),
        );
      },
    );
  }
}

class _PostImageGridGeometry {
  const _PostImageGridGeometry({
    required this.itemWidth,
    required this.itemHeight,
    required this.gridWidth,
    required this.spacing,
    required this.borderRadius,
  });

  final double itemWidth;
  final double itemHeight;
  final double gridWidth;
  final double spacing;
  final double borderRadius;

  static _PostImageGridGeometry resolve({
    required int count,
    required double maxWidth,
  }) {
    const spacing = 6.0;
    const singleBorderRadius = 12.0;
    const multiBorderRadius = 8.0;

    if (count <= 1) {
      final width = (maxWidth * 0.68).clamp(180.0, 240.0);
      return _PostImageGridGeometry(
        itemWidth: width,
        itemHeight: width * 0.78,
        gridWidth: width,
        spacing: spacing,
        borderRadius: singleBorderRadius,
      );
    }

    final columns = (count == 2 || count == 4) ? 2 : 3;
    final idealGridWidth = columns == 2 ? 248.0 : 252.0;
    final availableWidth = maxWidth.isFinite ? maxWidth : idealGridWidth;
    final gridWidth = columns == 3
        ? availableWidth
        : idealGridWidth.clamp(0.0, availableWidth);
    final itemWidth = (gridWidth - spacing * (columns - 1)) / columns;

    return _PostImageGridGeometry(
      itemWidth: itemWidth,
      itemHeight: itemWidth,
      gridWidth: gridWidth,
      spacing: spacing,
      borderRadius: multiBorderRadius,
    );
  }
}

class _NetworkMomentImage extends StatelessWidget {
  const _NetworkMomentImage({
    required this.imageUrl,
    required this.width,
    required this.height,
  });

  final String imageUrl;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Image.network(
      imageUrl,
      width: width,
      height: height,
      fit: BoxFit.cover,
      loadingBuilder: (context, child, loadingProgress) {
        if (loadingProgress == null) {
          return child;
        }

        return Container(
          width: width,
          height: height,
          color: const Color(0xFFF1F5F9),
          alignment: Alignment.center,
          child: const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Color(0xFF94A3B8),
            ),
          ),
        );
      },
      errorBuilder: (context, error, stackTrace) {
        return Container(
          width: width,
          height: height,
          color: const Color(0xFFE5E7EB),
          alignment: Alignment.center,
          child: const Icon(
            Icons.broken_image_outlined,
            color: Color(0xFF9CA3AF),
            size: 22,
          ),
        );
      },
    );
  }
}

class _PostImagePreviewPage extends StatefulWidget {
  const _PostImagePreviewPage({
    required this.images,
    required this.initialIndex,
  });

  final List<String> images;
  final int initialIndex;

  @override
  State<_PostImagePreviewPage> createState() => _PostImagePreviewPageState();
}

class _PostImagePreviewPageState extends State<_PostImagePreviewPage> {
  late final PageController _pageController = PageController(
    initialPage: widget.initialIndex,
  );
  late int _currentIndex = widget.initialIndex;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final viewportWidth = MediaQuery.of(context).size.width;

    return Scaffold(
      backgroundColor: const Color(0xE6000000),
      body: SafeArea(
        child: Stack(
          children: [
            GestureDetector(
              onTap: () => Navigator.of(context).pop(),
              child: PageView.builder(
                controller: _pageController,
                itemCount: widget.images.length,
                onPageChanged: (index) {
                  setState(() {
                    _currentIndex = index;
                  });
                },
                itemBuilder: (context, index) {
                  return InteractiveViewer(
                    minScale: 0.9,
                    maxScale: 4,
                    child: Center(
                      child: _NetworkMomentImage(
                        imageUrl: widget.images[index],
                        width: viewportWidth,
                        height: viewportWidth * 1.05,
                      ),
                    ),
                  );
                },
              ),
            ),
            Positioned(
              top: 12,
              right: 16,
              child: IconButton(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(
                  Icons.close_rounded,
                  color: Colors.white,
                  size: 28,
                ),
              ),
            ),
            Positioned(
              bottom: 24,
              left: 0,
              right: 0,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0x66000000),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${_currentIndex + 1}/${widget.images.length}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PostStat extends StatelessWidget {
  const _PostStat({required this.icon, required this.count, this.onTap});

  final IconData icon;
  final String count;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Row(
        children: [
          Icon(icon, size: 18, color: const Color(0xFF6A7282)),
          const SizedBox(width: 4),
          Text(
            count,
            style: const TextStyle(
              color: Color(0xFF6A7282),
              fontSize: 14,
              height: 20 / 14,
              fontWeight: FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }
}

String formatMomentRelativeTime(DateTime? time) {
  if (time == null) {
    return '刚刚';
  }

  final now = DateTime.now();
  final difference = now.difference(time.toLocal());

  if (difference.inSeconds < 60) {
    return '刚刚';
  }

  if (difference.inMinutes < 60) {
    return '${difference.inMinutes}分钟前';
  }

  if (difference.inHours < 24) {
    return '${difference.inHours}小时前';
  }

  if (difference.inDays < 7) {
    return '${difference.inDays}天前';
  }

  return '${time.year}-${time.month.toString().padLeft(2, '0')}-${time.day.toString().padLeft(2, '0')}';
}
