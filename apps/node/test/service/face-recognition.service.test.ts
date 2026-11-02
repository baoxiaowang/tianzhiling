import { FaceRecognitionService } from '../../src/service/face-recognition.service';
import {
  FaceRecognitionDecision,
  UserKnownPersonStatus,
} from '@tzl/entities';

const USER_ID = '665000000000000000000901';
const AGENT_ID = '665000000000000000000902';
const PERSON_ID = '665000000000000000000903';

function embeddingAt(dim: number, value: number): number[] {
  return Array.from({ length: dim }, () => value);
}

function createService(options?: {
  templateEmbedding?: number[];
  faceEmbedding?: number[];
  quality?: Record<string, number>;
}) {
  const service = new FaceRecognitionService();
  service.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
  service.config = {
    enabled: true,
    sidecarUrl: 'http://sidecar',
    timeoutMs: 3000,
    confirmDistance: 0.45,
    askDistance: 0.6,
    confirmMargin: 0.08,
    minFaceSize: 80,
    minBlur: 40,
    maxYaw: 0.35,
    logEnabled: false,
  };

  const savedFaces: unknown[] = [];
  service.faceModel = {
    find: jest.fn().mockResolvedValue([
      {
        personId: PERSON_ID,
        userId: USER_ID,
        embedding: options?.templateEmbedding ?? embeddingAt(8, 1),
        status: 'active',
      },
    ]),
    create: jest.fn(value => value),
    save: jest.fn(async value => {
      savedFaces.push(value);
      return value;
    }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
  } as never;
  service.personModel = {
    find: jest.fn().mockResolvedValue([
      {
        id: PERSON_ID,
        userId: USER_ID,
        preferredName: '妈妈',
        relationToUser: '妈妈',
        status: UserKnownPersonStatus.active,
      },
    ]),
    findOne: jest.fn().mockResolvedValue({
      id: PERSON_ID,
      userId: USER_ID,
      preferredName: '妈妈',
      status: UserKnownPersonStatus.active,
    }),
  } as never;
  service.logModel = {
    create: jest.fn(value => value),
    save: jest.fn(async value => value),
  } as never;

  jest.spyOn(service, 'analyze').mockResolvedValue({
    ok: true,
    model: 'dlib-resnet-v1',
    version: '2026.11',
    dim: 8,
    costMs: 40,
    faces: [
      {
        box: { top: 10, right: 110, bottom: 110, left: 10 },
        quality: {
          faceSize: options?.quality?.faceSize ?? 120,
          blur: options?.quality?.blur ?? 200,
          brightness: 120,
          yaw: 0.02,
        },
        embedding: options?.faceEmbedding ?? embeddingAt(8, 1),
      },
    ],
  });

  return { service, savedFaces };
}

describe('FaceRecognitionService', () => {
  it('同一张脸与模板距离为 0 时判定为 confirmed', async () => {
    const { service } = createService();
    const result = await service.recognize({
      userId: USER_ID,
      agentId: AGENT_ID,
      objectKey: 'voice-timbres/x.jpg',
    });

    expect(result.enabled).toBe(true);
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].decision).toBe(FaceRecognitionDecision.confirmed);
    expect(result.faces[0].top1?.name).toBe('妈妈');
    expect(result.candidates[0][0].score).toBeCloseTo(1, 2);
  });

  it('同一人多张模板不会把 margin 压成 0（应按人聚合）', async () => {
    const { service } = createService();
    jest.mocked(service.faceModel.find).mockResolvedValue([
      {
        personId: PERSON_ID,
        userId: USER_ID,
        embedding: embeddingAt(8, 1),
        status: 'active',
      },
      {
        personId: PERSON_ID,
        userId: USER_ID,
        embedding: embeddingAt(8, 1),
        status: 'active',
      },
    ] as never);

    const result = await service.recognize({ userId: USER_ID });
    expect(result.faces[0].decision).toBe(FaceRecognitionDecision.confirmed);
  });

  it('距离在 ask 区间时判定为 ask', async () => {
    const { service } = createService({
      templateEmbedding: embeddingAt(8, 1),
      faceEmbedding: [...embeddingAt(8, 1)].map((v, i) => (i === 0 ? 1 + 0.55 : v)),
    });
    const result = await service.recognize({ userId: USER_ID });
    expect(result.faces[0].decision).toBe(FaceRecognitionDecision.ask);
  });

  it('距离超过 ask 阈值时判定为 unknown', async () => {
    const { service } = createService({
      templateEmbedding: embeddingAt(8, 1),
      faceEmbedding: [...embeddingAt(8, 1)].map((v, i) => (i === 0 ? 1 + 1.2 : v)),
    });
    const result = await service.recognize({ userId: USER_ID });
    expect(result.faces[0].decision).toBe(FaceRecognitionDecision.unknown);
  });

  it('模糊照片被质量门禁拦下，即使很像也不给 confirmed', async () => {
    const { service } = createService({ quality: { blur: 5 } });
    const result = await service.recognize({ userId: USER_ID });
    expect(result.faces[0].gatedBy).toBe('blur');
    expect(result.faces[0].decision).not.toBe(FaceRecognitionDecision.confirmed);
  });

  it('登记模板时质量不合格的照片会被跳过', async () => {
    const { service, savedFaces } = createService({ quality: { blur: 3 } });
    const result = await service.registerFaces({
      userId: USER_ID,
      personId: PERSON_ID,
      images: [{ buffer: Buffer.from('x') }],
    });
    expect(result).toEqual({ stored: 0, skipped: 1 });
    expect(savedFaces).toHaveLength(0);
  });

  it('配置密钥时向量加密落库、读取时能解密还原', async () => {
    process.env.NODE_FACE_EMBEDDING_KEY = 'a'.repeat(64);
    try {
      const { service, savedFaces } = createService();
      const embedding = embeddingAt(8, 1);
      const result = await service.registerFaces({
        userId: USER_ID,
        personId: PERSON_ID,
        images: [{ buffer: Buffer.from('x') }],
      });
      expect(result).toEqual({ stored: 1, skipped: 0 });
      const saved = savedFaces[0] as unknown as {
        embedding?: number[];
        embeddingEnc?: string;
      };
      expect(saved.embedding).toBeUndefined();
      expect(saved.embeddingEnc).toEqual(expect.stringMatching(/^v1:/));

      // 读取链路（loadTemplates → readEmbedding）应能解密出同一向量
      const read = (service as unknown as {
        readEmbedding: (row: { embeddingEnc?: string }) => number[] | null;
      }).readEmbedding({ embeddingEnc: saved.embeddingEnc });
      expect(read).toEqual(embedding);
    } finally {
      delete process.env.NODE_FACE_EMBEDDING_KEY;
    }
  });

  it('登记模板时合格的图片会写入并带质量分', async () => {
    const { service, savedFaces } = createService();
    const result = await service.registerFaces({
      userId: USER_ID,
      personId: PERSON_ID,
      images: [{ buffer: Buffer.from('x') }],
    });
    expect(result).toEqual({ stored: 1, skipped: 0 });
    expect(savedFaces).toHaveLength(1);
  });

  it('合并家人：模板迁移到目标、源档案归档', async () => {
    const { service } = createService();
    const archived: Array<{ status?: string }> = [];
    service.personModel = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ({
        id: where._id,
        userId: USER_ID,
        preferredName: '妈妈',
        status: UserKnownPersonStatus.active,
      })),
      save: jest.fn(async (entity: unknown) => {
        archived.push(entity as { status?: string });
        return entity;
      }),
    } as never;
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });
    service.faceModel = {
      find: jest.fn().mockResolvedValue([]),
      updateMany,
    } as never;
    service.logModel = { create: jest.fn(v => v), save: jest.fn(async v => v) } as never;

    const result = await service.mergePersons({
      userId: USER_ID,
      sourcePersonId: '665000000000000000000904',
      targetPersonId: '665000000000000000000905',
    });

    expect(result).toEqual({ moved: 3 });
    expect(updateMany).toHaveBeenCalled();
    expect(archived[0]).toEqual(
      expect.objectContaining({ status: UserKnownPersonStatus.archived })
    );
  });

  it('识别日志不落原始 objectKey（只存哈希）', async () => {
    const { service } = createService();
    const saved: Array<{ objectKey?: string; objectKeyHash?: string }> = [];
    service.logModel = {
      create: jest.fn(v => v),
      save: jest.fn(async v => {
        saved.push(v as { objectKey?: string; objectKeyHash?: string });
        return v;
      }),
    } as never;
    service.config = { ...service.config, logEnabled: true };

    await service.recognize({
      userId: USER_ID,
      objectKey: 'voice-timbres/2026/11/02/secret.jpg',
    });

    expect(saved[0].objectKey).toBeUndefined();
    expect(saved[0].objectKeyHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('要求同意时：未同意不做识别，同意后正常识别', async () => {
    const { service } = createService();
    service.config = { ...service.config, requireConsent: true };

    let consented = false;
    service.userModel = {
      findOne: jest.fn(async () => ({
        faceRecognitionConsent: consented ? { granted: true } : undefined,
      })),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    } as never;

    const blocked = await service.recognize({ userId: USER_ID });
    expect(blocked.enabled).toBe(false);
    expect(blocked.faces).toHaveLength(0);

    consented = true;
    const allowed = await service.recognize({ userId: USER_ID });
    expect(allowed.enabled).toBe(true);
    expect(allowed.faces.length).toBeGreaterThan(0);
  });

  it('撤回同意会清空已登记的人脸模板', async () => {
    const { service } = createService();
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 4 });
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    service.userModel = { updateOne } as never;
    service.faceModel = { find: jest.fn(), updateMany } as never;

    const result = await service.setConsent({ userId: USER_ID, granted: false });

    expect(result.granted).toBe(false);
    expect(updateOne).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled();
  });

  it('关闭开关时识别直接返回 enabled=false', async () => {
    const { service } = createService();
    service.config = { ...service.config, enabled: false };
    const result = await service.recognize({ userId: USER_ID });
    expect(result.enabled).toBe(false);
    expect(result.faces).toHaveLength(0);
  });
});
