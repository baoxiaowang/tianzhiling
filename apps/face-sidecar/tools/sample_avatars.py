"""从生产库抽样用户头像，供阈值标定使用（需显式授权后执行）。

用法（在服务器上、仓库根目录）：
  python3 apps/face-sidecar/tools/sample_avatars.py --limit 30 --out /tmp/face-eval/raw

行为：
  1. 用 mongosh 抽样 limit 个「有头像」的用户，输出 userId + avatar 地址；
  2. 逐个下载到 --out（文件名 <userId>.jpg，每位用户一张）；
  3. 打印清单，不删除任何数据；照片只落在本地临时目录，跑完请手动 `rm -rf`。

安全约束：
  - 只读，不写库；
  - 不做人脸识别，不外传；
  - 默认只抽样，不打印手机号/昵称等无关字段。
"""
import argparse
import json
import os
import subprocess

MONGO_CMD = [
    'docker', 'exec', 'tzl_mongo', 'mongosh', '--quiet',
    '-u', 'admin', '-p', 'qwerasdf', '--authenticationDatabase', 'admin',
    '--eval',
]


def sample(limit: int):
    script = f'''
    const d = db.getSiblingDB("tzl");
    const rows = d.user.aggregate([
      {{ $match: {{ avatar: {{ $nin: [null, ""] }} }} }},
      {{ $sample: {{ size: {limit} }} }},
      {{ $project: {{ _id: 1, avatar: 1 }} }}
    ]).toArray();
    print(JSON.stringify(rows.map(r => ({{ id: String(r._id), avatar: r.avatar }}))));
    '''
    output = subprocess.check_output(MONGO_CMD + [script], universal_newlines=True).strip()
    # mongosh 可能带前缀日志，取最后一行 JSON
    line = [l for l in output.splitlines() if l.strip().startswith('[')][-1]
    return json.loads(line)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=30)
    parser.add_argument('--out', default='/tmp/face-eval/raw')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    rows = sample(args.limit)
    print('[sample] %d users with avatar' % len(rows))
    if args.dry_run:
        for row in rows[:5]:
            print('  -', row['id'])
        print('  ... (dry-run, not downloaded)')
        return

    os.makedirs(args.out, exist_ok=True)
    ok = 0
    for row in rows:
        url = row['avatar']
        if not url.startswith('http'):
            continue
        dest = os.path.join(args.out, f"{row['id']}.jpg")
        code = subprocess.call(['curl', '-s', '-m', '20', '-o', dest, url])
        if code == 0 and os.path.getsize(dest) > 1024:
            ok += 1
        else:
            if os.path.exists(dest):
                os.remove(dest)
    print('[download] %d/%d saved to %s' % (ok, len(rows), args.out))
    print('[next] docker cp /tmp/face-eval tzl_face_sidecar:/tmp/face-eval')
    print('       docker exec tzl_face_sidecar python3 /app/tools/threshold_eval.py')
    print('[cleanup] rm -rf %s  (delete after evaluation)' % args.out)


if __name__ == '__main__':
    main()
