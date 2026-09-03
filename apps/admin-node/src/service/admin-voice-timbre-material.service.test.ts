import { MongoObjectId } from '@tzl/entities';
import { AdminVoiceTimbreMaterialService } from './admin-voice-timbre-material.service';

function createService() {
  const service = new AdminVoiceTimbreMaterialService();
  service.materialRepo = {
    findOne: jest.fn(),
    save: jest.fn(async value => value),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  } as any;
  service.storageService = {
    deleteCosObject: jest.fn().mockResolvedValue(undefined),
  } as any;
  service.storageFileService = {
    resolve: jest.fn(value => `https://cdn.example.com/${value}`),
  } as any;
  service.logger = { warn: jest.fn() } as any;
  return service;
}

describe('AdminVoiceTimbreMaterialService', () => {
  it('physically deletes the source and derived clips before the record', async () => {
    const service = createService();
    const id = new MongoObjectId();
    jest.mocked(service.materialRepo.findOne).mockResolvedValue({
      id,
      objectKey: 'voice-timbres/source.wav',
      reviewClips: [{ objectKey: 'voice-service-clips/clip.wav' }],
    } as never);

    await service.remove(id.toHexString());

    expect(service.storageService.deleteCosObject).toHaveBeenCalledTimes(2);
    expect(service.storageService.deleteCosObject).toHaveBeenNthCalledWith(
      1,
      'voice-timbres/source.wav'
    );
    expect(service.storageService.deleteCosObject).toHaveBeenNthCalledWith(
      2,
      'voice-service-clips/clip.wav'
    );
    expect(service.materialRepo.deleteOne).toHaveBeenCalledWith({ _id: id });
  });

  it('keeps the record when object deletion fails', async () => {
    const service = createService();
    const id = new MongoObjectId();
    jest.mocked(service.materialRepo.findOne).mockResolvedValue({
      id,
      objectKey: 'voice-timbres/source.wav',
      reviewClips: [],
    } as never);
    jest
      .mocked(service.storageService.deleteCosObject)
      .mockRejectedValue(new Error('cos unavailable'));

    await expect(service.remove(id.toHexString())).rejects.toThrow(
      'cos unavailable'
    );
    expect(service.materialRepo.deleteOne).not.toHaveBeenCalled();
  });

  it('allows deleting historical voice workflow source files', async () => {
    const service = createService();
    const id = new MongoObjectId();
    jest.mocked(service.materialRepo.findOne).mockResolvedValue({
      id,
      objectKey: 'voice-timbre-merged/historical.wav',
      reviewClips: [],
    } as never);

    await service.remove(id.toHexString());

    expect(service.storageService.deleteCosObject).toHaveBeenCalledWith(
      'voice-timbre-merged/historical.wav'
    );
    expect(service.materialRepo.deleteOne).toHaveBeenCalledWith({ _id: id });
  });

  it('never deletes an object outside the voice workflow directories', async () => {
    const service = createService();
    const id = new MongoObjectId();
    jest.mocked(service.materialRepo.findOne).mockResolvedValue({
      id,
      objectKey: 'avatars/user.png',
      reviewClips: [],
    } as never);

    await expect(service.remove(id.toHexString())).rejects.toMatchObject({
      code: 'INVALID_VOICE_MATERIAL_OBJECT_KEY',
    });
    expect(service.storageService.deleteCosObject).not.toHaveBeenCalled();
    expect(service.materialRepo.deleteOne).not.toHaveBeenCalled();
  });

  it('persists review decisions and cleans replaced clips', async () => {
    const service = createService();
    const id = new MongoObjectId();
    jest.mocked(service.materialRepo.findOne).mockResolvedValue({
      id,
      userId: new MongoObjectId(),
      name: 'source.wav',
      objectKey: 'voice-timbres/source.wav',
      reviewClips: [{ objectKey: 'voice-service-clips/old.wav' }],
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    } as never);

    const result = await service.saveReviewClips(id.toHexString(), [
      {
        sourceMaterialId: id.toHexString(),
        sourceName: 'source.wav',
        objectKey: 'voice-service-clips/new.wav',
        publicUrl: 'https://cdn.example.com/new.wav',
        durationSeconds: 8,
        reviewStatus: 'accepted',
      },
    ]);

    expect(result.reviewClips[0].reviewStatus).toBe('accepted');
    expect(service.storageService.deleteCosObject).toHaveBeenCalledWith(
      'voice-service-clips/old.wav'
    );
  });

  it('rejects review clips that do not belong to the material', async () => {
    const service = createService();
    const id = new MongoObjectId();
    jest.mocked(service.materialRepo.findOne).mockResolvedValue({
      id,
      name: 'source.wav',
      reviewClips: [],
    } as never);

    await expect(
      service.saveReviewClips(id.toHexString(), [
        {
          sourceMaterialId: new MongoObjectId().toHexString(),
          sourceName: 'source.wav',
          objectKey: 'voice-service-clips/new.wav',
          publicUrl: 'https://cdn.example.com/new.wav',
          durationSeconds: 8,
          reviewStatus: 'pending',
        },
      ])
    ).rejects.toMatchObject({ code: 'INVALID_VOICE_REVIEW_CLIP' });
    expect(service.materialRepo.save).not.toHaveBeenCalled();
  });

  it('only rolls back files from the voice material upload directory', async () => {
    const service = createService();

    await expect(
      service.rollbackUpload('avatars/user.png')
    ).rejects.toMatchObject({ code: 'INVALID_VOICE_MATERIAL_OBJECT_KEY' });
    await expect(
      service.rollbackUpload('/voice-timbres/orphan.wav')
    ).resolves.toEqual({ deleted: true });
    expect(service.storageService.deleteCosObject).toHaveBeenCalledWith(
      'voice-timbres/orphan.wav'
    );
  });
});
