import 'dart:async';
import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/post_api.dart';
import 'package:tianzhiling_app/api/storage_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/home/post_remind_contacts_sheet.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';
import 'package:image_picker/image_picker.dart';

class PostCreatePage extends StatefulWidget {
  const PostCreatePage({super.key});

  @override
  State<PostCreatePage> createState() => _PostCreatePageState();
}

class _PostCreatePageState extends State<PostCreatePage> {
  final TextEditingController _contentController = TextEditingController();
  final FocusNode _contentFocusNode = FocusNode();
  final ImagePicker _imagePicker = ImagePicker();
  final List<_DraftImageItem> _images = <_DraftImageItem>[];
  List<ConversationSummary> _remindTargets = const <ConversationSummary>[];

  bool _isSubmitting = false;
  bool get _hasPendingImages => _images.any((item) => !item.isUploaded);
  List<String> get _imageObjectKeys => <String>[
    for (final item in _images)
      if (item.objectKey != null && item.objectKey!.isNotEmpty) item.objectKey!,
  ];
  List<String> get _remindAgentIds => <String>[
    for (final item in _remindTargets)
      if (item.agentId.trim().isNotEmpty) item.agentId.trim(),
  ];

  bool get _canPublish =>
      !_isSubmitting &&
      !_hasPendingImages &&
      (_contentController.text.trim().isNotEmpty ||
          _imageObjectKeys.isNotEmpty);

  @override
  void initState() {
    super.initState();
    _contentController.addListener(_handleDraftChanged);
  }

  @override
  void dispose() {
    _contentController
      ..removeListener(_handleDraftChanged)
      ..dispose();
    _contentFocusNode.dispose();
    super.dispose();
  }

  void _handleDraftChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _submit() async {
    if (_hasPendingImages) {
      _showSnackBar('请先等待图片上传完成');
      return;
    }

    if (!_canPublish) {
      return;
    }

    setState(() {
      _isSubmitting = true;
    });

    try {
      await PostApi.createPost(
        content: _contentController.text.trim(),
        images: List<String>.from(_imageObjectKeys),
        remindAgentIds: List<String>.from(_remindAgentIds),
      );

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop(true);
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

      _showSnackBar(error.message.isNotEmpty ? error.message : '发布失败，请稍后重试');
    } catch (_) {
      _showSnackBar('发布失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  Future<void> _pickImages() async {
    if (_images.length >= 9) {
      _showSnackBar('最多添加 9 张图片');
      return;
    }

    final remaining = 9 - _images.length;
    final pickedFiles = await _imagePicker.pickMultiImage(
      imageQuality: 88,
      maxWidth: 2048,
    );

    if (!mounted || pickedFiles.isEmpty) {
      return;
    }

    final selectedFiles = pickedFiles.take(remaining).toList();

    if (pickedFiles.length > remaining) {
      _showSnackBar('最多添加 9 张图片，已为你保留前 $remaining 张');
    }

    final draftItems = selectedFiles
        .map((file) => _DraftImageItem.uploading(file: file))
        .toList();

    setState(() {
      _images.addAll(draftItems);
    });

    for (final item in draftItems) {
      unawaited(_uploadImage(item));
    }
  }

  Future<void> _uploadImage(_DraftImageItem item) async {
    try {
      final uploadedImage = await StorageApi.uploadImage(item.file);

      if (!mounted) {
        return;
      }

      _updateImage(item.id, (current) {
        return current.copyWith(
          objectKey: uploadedImage.objectKey,
          remoteUrl: uploadedImage.publicUrl,
          isUploading: false,
          hasError: false,
        );
      });
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await _redirectToAuthPage();
        return;
      }

      if (!mounted) {
        return;
      }

      _updateImage(item.id, (current) {
        return current.copyWith(isUploading: false, hasError: true);
      });
      _showSnackBar(error.message.isNotEmpty ? error.message : '图片上传失败');
    } catch (_) {
      if (!mounted) {
        return;
      }

      _updateImage(item.id, (current) {
        return current.copyWith(isUploading: false, hasError: true);
      });
      _showSnackBar('图片上传失败，请稍后重试');
    }
  }

  Future<void> _retryImage(String id) async {
    final index = _images.indexWhere((element) => element.id == id);

    if (index < 0) {
      return;
    }

    final item = _images[index];

    _updateImage(id, (current) {
      return current.copyWith(isUploading: true, hasError: false);
    });

    await _uploadImage(item);
  }

  Future<void> _redirectToAuthPage() async {
    await AuthSessionStore.clear();
    if (!mounted) {
      return;
    }
    Navigator.of(
      context,
    ).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
  }

  void _removeImageAt(int index) {
    setState(() {
      _images.removeAt(index);
    });
  }

  Future<void> _openRemindContactsSheet() async {
    final selected = await showModalBottomSheet<List<ConversationSummary>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return PostRemindContactsSheet(
          initialSelectedAgentIds: <String>{
            for (final item in _remindTargets) item.agentId,
          },
        );
      },
    );

    if (selected == null || !mounted) {
      return;
    }

    setState(() {
      _remindTargets = selected;
    });
  }

  String? get _remindTrailingText {
    if (_remindTargets.isEmpty) {
      return null;
    }

    if (_remindTargets.length == 1) {
      return _remindTargets.first.agentName.trim();
    }

    if (_remindTargets.length == 2) {
      return _remindTargets.map((item) => item.agentName.trim()).join('、');
    }

    return '已选 ${_remindTargets.length} 人';
  }

  void _updateImage(
    String id,
    _DraftImageItem Function(_DraftImageItem current) transform,
  ) {
    final index = _images.indexWhere((item) => item.id == id);

    if (index < 0 || !mounted) {
      return;
    }

    setState(() {
      _images[index] = transform(_images[index]);
    });
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
      );
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final keyboardInset = mediaQuery.viewInsets.bottom;
    final bottomSafeArea = mediaQuery.padding.bottom;

    return GestureDetector(
      onTap: () => FocusScope.of(context).unfocus(),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _CreatePostNavBar(
                canPublish: _canPublish,
                isSubmitting: _isSubmitting,
                onCancel: () => Navigator.of(context).maybePop(),
                onPublish: _submit,
              ),
              Expanded(
                child: SingleChildScrollView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: EdgeInsets.fromLTRB(
                    16,
                    8,
                    16,
                    keyboardInset > 0 ? 24 : bottomSafeArea + 24,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: _contentController,
                        focusNode: _contentFocusNode,
                        minLines: 6,
                        maxLines: 12,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: const InputDecoration(
                          hintText: '这一刻的想法...',
                          hintStyle: TextStyle(
                            color: Color(0xFFC0C4CC),
                            fontSize: 22,
                            fontWeight: FontWeight.w400,
                          ),
                          border: InputBorder.none,
                        ),
                        style: const TextStyle(
                          color: Color(0xFF111111),
                          fontSize: 22,
                          height: 30 / 22,
                        ),
                      ),
                      const SizedBox(height: 8),
                      _ImageGrid(
                        images: _images,
                        onAddTap: _pickImages,
                        onRemoveTap: _removeImageAt,
                        onRetryTap: _retryImage,
                      ),
                      const SizedBox(height: 32),
                      const Divider(height: 1, color: Color(0xFFF0F0F0)),
                      const _ActionRow(
                        icon: CupertinoIcons.location,
                        title: '所在位置',
                      ),
                      const Divider(height: 1, color: Color(0xFFF0F0F0)),
                      _ActionRow(
                        icon: CupertinoIcons.at,
                        title: '提醒谁看',
                        trailing: _remindTrailingText,
                        onTap: _openRemindContactsSheet,
                      ),
                      const Divider(height: 1, color: Color(0xFFF0F0F0)),
                      const _ActionRow(
                        icon: CupertinoIcons.person_2,
                        title: '谁可以看',
                        trailing: '公开',
                      ),
                      const Divider(height: 1, color: Color(0xFFF0F0F0)),
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
}

class _CreatePostNavBar extends StatelessWidget {
  const _CreatePostNavBar({
    required this.canPublish,
    required this.isSubmitting,
    required this.onCancel,
    required this.onPublish,
  });

  final bool canPublish;
  final bool isSubmitting;
  final VoidCallback onCancel;
  final Future<void> Function() onPublish;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            GestureDetector(
              onTap: onCancel,
              behavior: HitTestBehavior.opaque,
              child: const Text(
                '取消',
                style: TextStyle(
                  color: Color(0xFF111111),
                  fontSize: 18,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
            const Spacer(),
            GestureDetector(
              onTap: canPublish ? onPublish : null,
              behavior: HitTestBehavior.opaque,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                height: 34,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: canPublish
                      ? const Color(0xFF1AAD19)
                      : const Color(0xFFB7E7BE),
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: isSubmitting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        '发表',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
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

class _ImageGrid extends StatelessWidget {
  const _ImageGrid({
    required this.images,
    required this.onAddTap,
    required this.onRemoveTap,
    required this.onRetryTap,
  });

  final List<_DraftImageItem> images;
  final VoidCallback onAddTap;
  final ValueChanged<int> onRemoveTap;
  final ValueChanged<String> onRetryTap;

  @override
  Widget build(BuildContext context) {
    final itemCount = images.length < 9 ? images.length + 1 : 9;

    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: List<Widget>.generate(itemCount, (index) {
        if (index == images.length && images.length < 9) {
          return _AddImageTile(onTap: onAddTap);
        }

        return _PreviewImageTile(
          image: images[index],
          onRemoveTap: () => onRemoveTap(index),
          onRetryTap: () => onRetryTap(images[index].id),
        );
      }),
    );
  }
}

class _AddImageTile extends StatelessWidget {
  const _AddImageTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 96,
        height: 96,
        color: const Color(0xFFF7F7F7),
        alignment: Alignment.center,
        child: const Icon(
          CupertinoIcons.add,
          size: 34,
          color: Color(0xFF7A7A7A),
        ),
      ),
    );
  }
}

class _PreviewImageTile extends StatelessWidget {
  const _PreviewImageTile({
    required this.image,
    required this.onRemoveTap,
    required this.onRetryTap,
  });

  final _DraftImageItem image;
  final VoidCallback onRemoveTap;
  final VoidCallback onRetryTap;

  @override
  Widget build(BuildContext context) {
    final imageWidget = Image.file(
      File(image.file.path),
      width: 96,
      height: 96,
      fit: BoxFit.cover,
      errorBuilder: (context, error, stackTrace) {
        return Container(
          width: 96,
          height: 96,
          color: const Color(0xFFF3F4F6),
          padding: const EdgeInsets.all(12),
          alignment: Alignment.center,
          child: const Text(
            '图片读取失败',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF9CA3AF),
              fontSize: 12,
              height: 16 / 12,
            ),
          ),
        );
      },
    );

    return Stack(
      clipBehavior: Clip.none,
      children: [
        GestureDetector(
          onTap: image.hasError ? onRetryTap : null,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Stack(
              children: [
                imageWidget,
                if (image.isUploading || image.hasError)
                  Positioned.fill(
                    child: ColoredBox(
                      color: Colors.black38,
                      child: Center(
                        child: image.isUploading
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.2,
                                  color: Colors.white,
                                ),
                              )
                            : const Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    CupertinoIcons.refresh,
                                    color: Colors.white,
                                    size: 20,
                                  ),
                                  SizedBox(height: 6),
                                  Text(
                                    '上传失败\n点击重试',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 12,
                                      height: 16 / 12,
                                    ),
                                  ),
                                ],
                              ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        Positioned(
          top: -8,
          right: -8,
          child: GestureDetector(
            onTap: onRemoveTap,
            child: Container(
              width: 24,
              height: 24,
              decoration: const BoxDecoration(
                color: Colors.black54,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: const Icon(
                CupertinoIcons.xmark,
                color: Colors.white,
                size: 14,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _DraftImageItem {
  const _DraftImageItem({
    required this.id,
    required this.file,
    required this.isUploading,
    required this.hasError,
    this.objectKey,
    this.remoteUrl,
  });

  factory _DraftImageItem.uploading({required XFile file}) {
    return _DraftImageItem(
      id: '${DateTime.now().microsecondsSinceEpoch}-${file.path}',
      file: file,
      isUploading: true,
      hasError: false,
    );
  }

  final String id;
  final XFile file;
  final bool isUploading;
  final bool hasError;
  final String? objectKey;
  final String? remoteUrl;

  bool get isUploaded =>
      !isUploading && !hasError && objectKey != null && objectKey!.isNotEmpty;

  _DraftImageItem copyWith({
    bool? isUploading,
    bool? hasError,
    String? objectKey,
    String? remoteUrl,
  }) {
    return _DraftImageItem(
      id: id,
      file: file,
      isUploading: isUploading ?? this.isUploading,
      hasError: hasError ?? this.hasError,
      objectKey: objectKey ?? this.objectKey,
      remoteUrl: remoteUrl ?? this.remoteUrl,
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.icon,
    required this.title,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        height: 56,
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFF4B5563), size: 22),
            const SizedBox(width: 16),
            Text(
              title,
              style: const TextStyle(
                color: Color(0xFF222222),
                fontSize: 18,
                fontWeight: FontWeight.w400,
              ),
            ),
            Expanded(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (trailing != null)
                    Flexible(
                      child: Text(
                        trailing!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          color: Color(0xFF4B5563),
                          fontSize: 16,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                  const SizedBox(width: 10),
                  const Icon(
                    CupertinoIcons.chevron_right,
                    size: 18,
                    color: Color(0xFFC7C7CC),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
