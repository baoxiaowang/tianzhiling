"""用公开合成人像（randomuser.me，AI 生成、不含真人隐私）做阈值标定。

用法：
  1. 下载 24 张人像到 /tmp/face-eval/raw/（命名形如 men_1.jpg）
  2. 在 sidecar 容器内执行：python3 /app/tools/threshold_eval.py
  （或 docker cp 进容器后执行；脚本只依赖 face_recognition + PIL + numpy）

注意：合成数据只能给出「下限」参考——真人不同年代/光线/角度下的同人距离通常更大，
最终阈值仍需用业务真实照片复标。

流程：
1. 每张人像生成 3 个「同人变体」（缩放/亮度/裁剪/翻转），模拟不同照片；
2. 计算 128 维向量；
3. 统计两类距离分布：同人（genuine） vs 不同人（impostor）；
4. 阈值扫描：FAR（误接受率）/ FRR（误拒绝率），选出「确认」「反问」两档建议；
5. 用 8 人小库做 top1/margin 决策模拟，统计确认正确/确认错误/反问/不认识。
"""
import itertools
import json
import os

import numpy as np
import face_recognition
from PIL import Image, ImageEnhance

RAW = os.environ.get('FACE_EVAL_RAW', '/tmp/face-eval/raw')
VAR = os.environ.get('FACE_EVAL_VARIANTS', '/tmp/face-eval/variants')
os.makedirs(VAR, exist_ok=True)


def variants_for(path, image_id):
    img = Image.open(path).convert('RGB').resize((256, 256))
    out = {}
    out['base'] = img
    out['resize85'] = img.resize((218, 218)).resize((256, 256))
    out['bright110'] = ImageEnhance.Brightness(img).enhance(1.15)
    w, h = img.size
    out['crop'] = img.crop((10, 8, w - 8, h - 10)).resize((256, 256))
    out['flip'] = img.transpose(Image.FLIP_LEFT_RIGHT)
    saved = {}
    for name, variant in out.items():
        dest = os.path.join(VAR, f'{image_id}__{name}.jpg')
        variant.save(dest, quality=92)
        saved[name] = dest
    return saved


def embed(path):
    img = face_recognition.load_image_file(path)
    locs = face_recognition.face_locations(img, number_of_times_to_upsample=1)
    if not locs:
        return None
    # 取最大的一张脸
    locs.sort(key=lambda b: (b[2] - b[0]) * (b[1] - b[3]), reverse=True)
    encs = face_recognition.face_encodings(img, [locs[0]])
    return encs[0] if encs else None


def main():
    files = sorted(f for f in os.listdir(RAW) if f.endswith('.jpg'))
    people = {}
    for name in files:
        pid = name.rsplit('.', 1)[0]
        saved = variants_for(os.path.join(RAW, name), pid)
        embeddings = {}
        for variant_name, path in saved.items():
            enc = embed(path)
            if enc is not None:
                embeddings[variant_name] = enc
        if 'base' in embeddings:
            people[pid] = embeddings

    ids = sorted(people.keys())
    genuine, impostor = [], []
    for pid in ids:
        base = people[pid]['base']
        for name, enc in people[pid].items():
            if name != 'base':
                genuine.append(float(np.linalg.norm(base - enc)))
    for a, b in itertools.combinations(ids, 2):
        impostor.append(float(np.linalg.norm(people[a]['base'] - people[b]['base'])))

    genuine = np.array(genuine, dtype=np.float32)
    impostor = np.array(impostor, dtype=np.float32)

    sweep = []
    for t in np.round(np.arange(0.30, 0.71, 0.02), 2):
        far = float((impostor <= t).mean() * 100)
        frr = float((genuine > t).mean() * 100)
        sweep.append({'threshold': float(t), 'FAR%': round(far, 2), 'FRR%': round(frr, 2)})

    def pick(target_far):
        best = None
        for row in sweep:
            if row['FAR%'] <= target_far:
                best = row
        return best

    confirm = pick(0.5)  # 误接受率 <= 0.5%
    ask = pick(5.0)      # 误接受率 <= 5%（宽松档，用于「反问」）

    # 小库（8 人）决策模拟：gallery = base，probe = 变体
    gallery_ids = ids[: int(os.environ.get('FACE_EVAL_GALLERY', '8'))]
    gallery = {pid: people[pid]['base'] for pid in gallery_ids}
    decisions = {'confirmed_right': 0, 'confirmed_wrong': 0, 'ask': 0, 'unknown': 0, 'probes': 0}
    confirm_t = float(os.environ.get('FACE_EVAL_CONFIRM_T') or (confirm['threshold'] if confirm else 0.45))
    ask_t = float(os.environ.get('FACE_EVAL_ASK_T') or (ask['threshold'] if ask else 0.6))
    margin_t = float(os.environ.get('FACE_EVAL_MARGIN', '0.08'))
    for pid in ids:
        for name, enc in people[pid].items():
            if name == 'base':
                continue
            ranked = sorted(
                ((dist, gid) for gid, base in gallery.items()
                 for dist in [float(np.linalg.norm(enc - base))]),
                key=lambda item: item[0],
            )
            top1 = ranked[0]
            top2 = ranked[1] if len(ranked) > 1 else None
            margin = (top2[0] - top1[0]) if top2 else 1.0
            decisions['probes'] += 1
            if top1[0] <= confirm_t and margin >= margin_t:
                if top1[1] == pid:
                    decisions['confirmed_right'] += 1
                else:
                    decisions['confirmed_wrong'] += 1
            elif top1[0] <= ask_t:
                decisions['ask'] += 1
            else:
                decisions['unknown'] += 1

    report = {
        'dataset': os.environ.get('FACE_EVAL_DATASET', 'randomuser.me 公开合成人像（AI 生成，不含真人隐私）'),
        'people': len(ids),
        'variants_per_person': {pid: len(people[pid]) for pid in ids},
        'genuine_pairs': len(genuine),
        'impostor_pairs': len(impostor),
        'genuine_mean': round(float(genuine.mean()), 4),
        'genuine_p95': round(float(np.percentile(genuine, 95)), 4),
        'genuine_max': round(float(genuine.max()), 4),
        'impostor_mean': round(float(impostor.mean()), 4),
        'impostor_p5': round(float(np.percentile(impostor, 5)), 4),
        'impostor_min': round(float(impostor.min()), 4),
        'suggest_confirm_threshold': confirm_t,
        'suggest_ask_threshold': ask_t,
        'sweep': sweep,
        'gallery_simulation': decisions,
        'gallery_params': {'confirm_t': confirm_t, 'ask_t': ask_t, 'margin': margin_t},
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
