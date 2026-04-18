import 'dart:io';
import 'dart:math' as math;

import 'package:extended_image/extended_image.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

class ChatImageEditorPage extends StatefulWidget {
  const ChatImageEditorPage({super.key, required this.source});

  final XFile source;

  static Future<XFile?> edit(BuildContext context, XFile source) {
    return Navigator.of(context).push<XFile>(
      MaterialPageRoute<XFile>(
        builder: (context) => ChatImageEditorPage(source: source),
      ),
    );
  }

  @override
  State<ChatImageEditorPage> createState() => _ChatImageEditorPageState();
}

class _ChatImageEditorPageState extends State<ChatImageEditorPage> {
  final ImageEditorController _editorController = ImageEditorController();
  bool _isSaving = false;

  Future<void> _completeEdit() async {
    if (_isSaving) {
      return;
    }

    final state = _editorController.state;
    final cropRect = _editorController.getCropRect();
    final editAction = _editorController.editActionDetails;

    if (state == null || cropRect == null || editAction == null) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('图片编辑器尚未准备好，请稍后重试')));
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      final bytes = Uint8List.fromList(state.rawImageData);
      final editedBytes = await compute(_applyChatImageEdit, <String, Object>{
        'bytes': bytes,
        'cropLeft': cropRect.left,
        'cropTop': cropRect.top,
        'cropWidth': cropRect.width,
        'cropHeight': cropRect.height,
        'rotateDegrees': editAction.rotateDegrees,
        'flipY': editAction.flipY,
      });

      final file = await _writeEditedImageFile(editedBytes);
      if (!mounted) {
        return;
      }

      Navigator.of(
        context,
      ).pop(XFile(file.path, mimeType: 'image/jpeg', name: widget.source.name));
    } catch (_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('图片编辑失败，请重新选择图片')));
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  Future<File> _writeEditedImageFile(Uint8List bytes) async {
    final file = File(
      '${Directory.systemTemp.path}/chat_image_${DateTime.now().millisecondsSinceEpoch}.jpg',
    );
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        surfaceTintColor: Colors.black,
        leading: IconButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).maybePop(),
          icon: const Icon(Icons.close_rounded, color: Colors.white),
        ),
        title: const Text(
          '编辑图片',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
        actions: [
          TextButton(
            onPressed: _isSaving ? null : _completeEdit,
            child: Text(
              _isSaving ? '处理中' : '完成',
              style: TextStyle(
                color: _isSaving ? Colors.white54 : const Color(0xFF5CE08A),
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: ExtendedImage.file(
                File(widget.source.path),
                fit: BoxFit.contain,
                mode: ExtendedImageMode.editor,
                cacheRawData: true,
                enableLoadState: true,
                initEditorConfigHandler: (state) {
                  return EditorConfig(
                    controller: _editorController,
                    maxScale: 6,
                    cropRectPadding: const EdgeInsets.all(24),
                    hitTestSize: 20,
                    initCropRectType: InitCropRectType.imageRect,
                    cornerColor: Colors.white,
                    lineColor: const Color(0xCCFFFFFF),
                    editorMaskColorHandler: (context, pointerDown) {
                      return pointerDown
                          ? const Color(0xAA000000)
                          : const Color(0xCC000000);
                    },
                  );
                },
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              color: const Color(0xFF111111),
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 18),
              child: Row(
                children: [
                  Expanded(
                    child: _EditorActionButton(
                      label: '左转',
                      icon: Icons.rotate_left_rounded,
                      onTap: _isSaving
                          ? null
                          : () => _editorController.rotate(
                              degree: -90,
                              animation: true,
                            ),
                    ),
                  ),
                  Expanded(
                    child: _EditorActionButton(
                      label: '镜像',
                      icon: Icons.flip_rounded,
                      onTap: _isSaving
                          ? null
                          : () => _editorController.flip(animation: true),
                    ),
                  ),
                  Expanded(
                    child: _EditorActionButton(
                      label: '重置',
                      icon: Icons.refresh_rounded,
                      onTap: _isSaving ? null : _editorController.reset,
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

class _EditorActionButton extends StatelessWidget {
  const _EditorActionButton({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              color: onTap == null ? Colors.white38 : Colors.white,
              size: 24,
            ),
            const SizedBox(height: 6),
            Text(
              label,
              style: TextStyle(
                color: onTap == null ? Colors.white38 : Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Uint8List _applyChatImageEdit(Map<String, Object> payload) {
  final bytes = payload['bytes']! as Uint8List;
  final cropLeft = payload['cropLeft']! as double;
  final cropTop = payload['cropTop']! as double;
  final cropWidth = payload['cropWidth']! as double;
  final cropHeight = payload['cropHeight']! as double;
  final rotateDegrees = payload['rotateDegrees']! as double;
  final flipY = payload['flipY']! as bool;
  final decoded = img.decodeImage(bytes);

  if (decoded == null) {
    throw StateError('failed to decode chat image');
  }

  img.Image image = img.bakeOrientation(decoded);
  final normalizedDegrees = ((rotateDegrees % 360) + 360) % 360;

  if (normalizedDegrees != 0) {
    image = img.copyRotate(image, angle: normalizedDegrees);
  }

  if (flipY) {
    image = img.flip(image, direction: img.FlipDirection.horizontal);
  }

  final left = cropLeft.floor().clamp(0, math.max(image.width - 1, 0)).toInt();
  final top = cropTop.floor().clamp(0, math.max(image.height - 1, 0)).toInt();
  final width = cropWidth
      .round()
      .clamp(1, math.max(image.width - left, 1))
      .toInt();
  final height = cropHeight
      .round()
      .clamp(1, math.max(image.height - top, 1))
      .toInt();

  final cropped = img.copyCrop(
    image,
    x: left,
    y: top,
    width: width,
    height: height,
  );

  return Uint8List.fromList(img.encodeJpg(cropped, quality: 88));
}
