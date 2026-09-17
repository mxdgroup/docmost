import { Readable } from 'node:stream';
import { ForbiddenException } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { prepareFile } from '../attachment.utils';

jest.mock('../attachment.utils', () => ({
  ...jest.requireActual('../attachment.utils'),
  prepareFile: jest.fn(),
}));

describe('Guest attachment persistence boundary', () => {
  const previousVersion =
    'workspace/files/attachment/00000000-0000-4000-8000-000000000001/diagram.svg';
  function setup(pageId = 'shared-page') {
    const attachmentRepo = {
      findById: jest.fn().mockResolvedValue({
        pageId,
        workspaceId: 'workspace',
        fileExt: '.svg',
        filePath: previousVersion,
      }),
      updateAttachment: jest
        .fn()
        .mockResolvedValue({ id: 'attachment', fileExt: '.svg' }),
    };
    const storage = { delete: jest.fn().mockResolvedValue(undefined) };
    const service = new AttachmentService(
      storage as any,
      attachmentRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { add: jest.fn() } as any,
    );
    const upload = jest
      .spyOn(service as any, 'uploadToDrive')
      .mockResolvedValue(undefined);
    (prepareFile as jest.Mock).mockResolvedValue({
      fileName: 'diagram.svg',
      fileExtension: '.svg',
      multiPartFile: { file: Readable.from(['<svg/>']) },
    });
    return { service, attachmentRepo, storage, upload };
  }

  const input = {
    pageId: 'shared-page',
    workspaceId: 'workspace',
    spaceId: 'space',
    userId: null,
    attachmentId: 'attachment',
    filePromise: null,
  };

  it('denies overwriting an attachment belonging to a different page before any storage write', async () => {
    const { service, upload } = setup('private-page');
    await expect(
      service.uploadFile({ ...input, validateAccess: async () => undefined }),
    ).rejects.toThrow('does not match');
    expect(upload).not.toHaveBeenCalled();
  });

  it('stages a replacement and refuses to publish it if access is revoked during upload', async () => {
    const { service, attachmentRepo, storage, upload } = setup();
    const validateAccess = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.uploadFile({ ...input, validateAccess }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attachmentRepo.updateAttachment).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(upload.mock.calls[0][0]);
    expect(storage.delete).not.toHaveBeenCalledWith(previousVersion);
    expect(upload.mock.calls[0][0]).toMatch(
      /\/attachment\/[0-9a-f-]+\/diagram.svg$/,
    );
  });

  it('publishes only the staged path after the final permission check succeeds', async () => {
    const { service, attachmentRepo, upload } = setup();
    const validateAccess = jest.fn().mockResolvedValue(undefined);
    await service.uploadFile({ ...input, validateAccess });
    expect(validateAccess).toHaveBeenCalledTimes(2);
    expect(attachmentRepo.updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: upload.mock.calls[0][0] }),
      'attachment',
    );
  });
  it('keeps member replacements working after a guest has changed the storage path', async () => {
    const { service, attachmentRepo, storage, upload } = setup();
    await service.uploadFile({ ...input, userId: 'member' });
    expect(attachmentRepo.updateAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: upload.mock.calls[0][0] }),
      'attachment',
    );
    expect(storage.delete).toHaveBeenCalledWith(previousVersion);
  });

  it('deletes the superseded guest version only after the replacement is published', async () => {
    const { service, attachmentRepo, storage } = setup();
    await service.uploadFile({
      ...input,
      validateAccess: async () => undefined,
    });
    expect(storage.delete).toHaveBeenCalledWith(previousVersion);
    expect(
      attachmentRepo.updateAttachment.mock.invocationCallOrder[0],
    ).toBeLessThan(storage.delete.mock.invocationCallOrder[0]);
  });

  it('returns the committed upload if superseded version cleanup fails', async () => {
    const { service, storage } = setup();
    storage.delete.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(
      service.uploadFile({ ...input, validateAccess: async () => undefined }),
    ).resolves.toEqual({ id: 'attachment', fileExt: '.svg' });
  });

  it('does not delete a canonical key which a concurrent member upload can reuse', async () => {
    const { service, attachmentRepo, storage } = setup();
    attachmentRepo.findById.mockResolvedValueOnce({
      pageId: input.pageId,
      workspaceId: input.workspaceId,
      fileExt: '.svg',
      filePath: 'workspace/files/attachment/diagram.svg',
    });
    await service.uploadFile({
      ...input,
      validateAccess: async () => undefined,
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
