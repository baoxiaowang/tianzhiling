/**
 * 人脸识别离线评测：用本地照片目录评估阈值（不连数据库）。
 *
 * 目录结构（每层一个身份）：
 *   <root>/妈妈/1.jpg 2.jpg 3.jpg 4.jpg
 *   <root>/爸爸/...
 *   <root>/_unknown/陌生人1.jpg   （可选：应判为「不认识」的探针）
 *
 * 用法：
 *   node dist/scripts/face-eval.js --dir /path/to/faces \
 *     --sidecar http://tzl_face_sidecar:8899 --register 3 --probe 2
 *
 * 输出：不同「确认距离 × margin」组合下的 确认正确/确认错误/反问/不认识，
 * 明细写入 /tmp/face-eval-report.json。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { extname, join } from 'path';

interface FaceAnalysis {
  faces: Array<{
    quality?: { faceSize?: number; blur?: number };
    embedding?: number[];
  }>;
}
interface GalleryEntry {
  person: string;
  embedding: number[];
}
interface ProbeResult {
  expected: string;
  top1?: string;
  distance?: number;
  margin?: number;
  faceSize?: number;
  error?: string;
}

const EXT = ['.jpg', '.jpeg', '.png', '.webp'];

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const value = argv[i + 1]?.startsWith('--') ? '' : argv[i + 1];
    args[token.slice(2)] = value || 'true';
    if (value) i += 1;
  }
  return args;
}

function listImages(dir: string): string[] {
  return readdirSync(dir)
    .filter(name => EXT.includes(extname(name).toLowerCase()))
    .sort()
    .map(name => join(dir, name));
}

function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

async function analyze(sidecar: string, file: string): Promise<FaceAnalysis> {
  const response = await fetch(`${sidecar.replace(/\/+$/, '')}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: readFileSync(file).toString('base64') }),
  });
  if (!response.ok) throw new Error(`sidecar ${response.status}`);
  return (await response.json()) as FaceAnalysis;
}

function pickLargestFace(result: FaceAnalysis) {
  const faces = (result.faces || []).filter(face => (face.embedding || []).length > 0);
  if (!faces.length) return undefined;
  return [...faces].sort(
    (left, right) => Number(right.quality?.faceSize || 0) - Number(left.quality?.faceSize || 0)
  )[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir;
  if (!dir) {
    console.error('缺少 --dir（照片根目录）');
    process.exit(1);
  }
  const sidecar = args.sidecar || 'http://127.0.0.1:8899';
  const registerCount = Number(args.register || 3);
  const probeCount = Number(args.probe || 2);

  const personDirs = readdirSync(dir).filter(name => {
    return statSync(join(dir, name)).isDirectory() && !name.startsWith('_');
  });

  const gallery: GalleryEntry[] = [];
  const probes: Array<{ file: string; expected: string }> = [];

  for (const person of personDirs) {
    const files = listImages(join(dir, person));
    for (const file of files.slice(0, registerCount)) {
      const face = pickLargestFace(await analyze(sidecar, file).catch(() => ({ faces: [] })));
      if (face?.embedding) gallery.push({ person, embedding: face.embedding });
    }
    for (const file of files.slice(registerCount, registerCount + probeCount)) {
      probes.push({ file, expected: person });
    }
  }

  try {
    for (const file of listImages(join(dir, '_unknown')).slice(0, probeCount * 2)) {
      probes.push({ file, expected: '__unknown__' });
    }
  } catch {
    /* 没有 _unknown 目录则跳过 */
  }

  const results: ProbeResult[] = [];
  for (const probe of probes) {
    try {
      const face = pickLargestFace(await analyze(sidecar, probe.file));
      if (!face?.embedding) {
        results.push({ expected: probe.expected, error: 'no_face' });
        continue;
      }
      const byPerson = new Map<string, number>();
      for (const entry of gallery) {
        const distance = euclidean(face.embedding, entry.embedding);
        const current = byPerson.get(entry.person);
        if (current === undefined || distance < current) byPerson.set(entry.person, distance);
      }
      const ranked = Array.from(byPerson.entries()).sort((a, b) => a[1] - b[1]);
      const top1 = ranked[0];
      const top2 = ranked[1];
      results.push({
        expected: probe.expected,
        top1: top1?.[0],
        distance: top1 ? Number(top1[1].toFixed(4)) : undefined,
        margin: top1 && top2 ? Number((top2[1] - top1[1]).toFixed(4)) : 1,
        faceSize: face.quality?.faceSize,
      });
    } catch (error) {
      results.push({ expected: probe.expected, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const confirm of [0.4, 0.45, 0.5, 0.55]) {
    for (const margin of [0, 0.05, 0.08, 0.12]) {
      let right = 0;
      let wrong = 0;
      let asked = 0;
      let unknown = 0;
      for (const result of results) {
        if (result.error) {
          unknown += 1;
          continue;
        }
        const distance = result.distance ?? Number.POSITIVE_INFINITY;
        const gap = result.margin ?? 0;
        if (distance <= confirm && gap >= margin) {
          if (result.top1 === result.expected) right += 1;
          else wrong += 1;
        } else if (distance <= 0.6) asked += 1;
        else unknown += 1;
      }
      const total = results.length || 1;
      rows.push({
        确认距离: confirm,
        margin,
        确认正确: right,
        确认错误: wrong,
        反问: asked,
        不认识: unknown,
        确认正确率: `${((right / total) * 100).toFixed(1)}%`,
        误认率: `${((wrong / total) * 100).toFixed(1)}%`,
      });
    }
  }

  writeFileSync('/tmp/face-eval-report.json', JSON.stringify({ total: results.length, rows, results }, null, 2));
  console.log(JSON.stringify({ total: results.length, rows }, null, 2));
  console.log('明细已写入 /tmp/face-eval-report.json');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
