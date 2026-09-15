import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
// The real gateway drags in ESM-only collab deps jest can't parse (the
// pre-existing upstream jest config issue); these tests use a mock instance.
jest.mock('../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: class {},
}));


import { CommentService } from '../comment/comment.service';
import { ShareController } from './share.controller';

// MXD: guest inline comments, ownership (edit/delete own), and resolution.
// CommentService and ShareController are constructed directly; only the
// collaborators these paths touch are functional mocks.

const WS = '00000000-0000-0000-0000-00000000000a';
const PAGE = '00000000-0000-0000-0000-00000000000c';
const SPACE = '00000000-0000-0000-0000-00000000000d';
const COMMENT = '00000000-0000-0000-0000-00000000000e';

const page = { id: PAGE, spaceId: SPACE, workspaceId: WS } as any;
const doc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
};
const yjsSelection = {
  anchor: { type: { client: 1, clock: 2 }, tname: null, item: { client: 1, clock: 3 }, assoc: 0 },
  head: { type: { client: 1, clock: 2 }, tname: null, item: { client: 1, clock: 5 }, assoc: 0 },
};

function buildCommentService(stored: Record<string, any> = {}) {
  const tokens = new Map<string, string>();
  const rows = new Map<string, any>(Object.entries(stored));
  const commentRepo = {
    insertComment: jest.fn(async (v) => {
      const row = { id: COMMENT, resolvedAt: null, ...v };
      rows.set(row.id, row);
      return row;
    }),
    findById: jest.fn(async (id) => rows.get(id) ?? null),
    updateComment: jest.fn(async (v, id) => {
      rows.set(id, { ...rows.get(id), ...v });
    }),
    deleteComment: jest.fn(async (id) => rows.delete(id)),
    insertGuestCommentToken: jest.fn(async (id, hash) => tokens.set(id, hash)),
    findGuestCommentTokenHash: jest.fn(async (id) => tokens.get(id) ?? null),
  };
  const wsService = { emitCommentEvent: jest.fn() };
  const collaborationGateway = { handleYjsEvent: jest.fn().mockResolvedValue(undefined) };
  const notificationQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new CommentService(
    commentRepo as any,
    {} as any, // pageRepo
    wsService as any,
    collaborationGateway as any,
    { add: jest.fn().mockResolvedValue(undefined) } as any, // generalQueue
    notificationQueue as any,
  );
  return { service, commentRepo, wsService, collaborationGateway, tokens, rows };
}

describe('CommentService guest comments', () => {
  it('inline guest comment: stores selection, applies the highlight with no user, mints an owner token', async () => {
    const { service, collaborationGateway, commentRepo, tokens } =
      buildCommentService();
    const { comment, guestToken } = await service.createGuestComment(
      { page, workspaceId: WS, guestName: 'Ana', sanitizedContent: doc },
      { selection: 'the kitchen', yjsSelection },
    );

    expect(commentRepo.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'inline',
        selection: 'the kitchen',
        creatorId: null,
        guestName: 'Ana',
      }),
    );
    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalledWith(
      'setCommentMark',
      `page.${PAGE}`,
      expect.objectContaining({ commentId: comment.id, user: null, resolved: false }),
    );
    expect(guestToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    // only a hash is stored, never the raw token
    expect(tokens.get(comment.id)).toBeDefined();
    expect(tokens.get(comment.id)).not.toEqual(guestToken);
  });

  it('a reply never anchors to a selection (no highlight, type page)', async () => {
    const parent = { id: 'p1', pageId: PAGE, parentCommentId: null };
    const { service, collaborationGateway, commentRepo } = buildCommentService({
      p1: parent,
    });
    await service.createGuestComment(
      { page, workspaceId: WS, guestName: 'Ana', sanitizedContent: doc },
      { parentCommentId: 'p1', selection: 'x', yjsSelection },
    );
    expect(commentRepo.insertComment).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'page', selection: null }),
    );
    expect(collaborationGateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('a malformed yjsSelection still saves the comment, without a highlight', async () => {
    const { service, collaborationGateway } = buildCommentService();
    const { comment } = await service.createGuestComment(
      { page, workspaceId: WS, guestName: 'Ana', sanitizedContent: doc },
      { selection: 'x', yjsSelection: { anchor: 'nope', head: 1 } },
    );
    expect(comment).toBeDefined();
    expect(collaborationGateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('ownership: only the minted token proves ownership; member comments are never guest-owned', async () => {
    const { service, rows } = buildCommentService();
    const { comment, guestToken } = await service.createGuestComment(
      { page, workspaceId: WS, guestName: 'Ana', sanitizedContent: doc },
      {},
    );
    expect(await service.isGuestCommentOwner(comment, guestToken)).toBe(true);
    expect(await service.isGuestCommentOwner(comment, 'wrong-token')).toBe(false);
    expect(await service.isGuestCommentOwner(comment, undefined)).toBe(false);

    const memberComment = { ...rows.get(comment.id), creatorId: 'user-1' };
    expect(await service.isGuestCommentOwner(memberComment, guestToken)).toBe(false);
  });

  it('commenter ownership: only the account a comment is attributed to owns it', async () => {
    const { service } = buildCommentService();
    const owned = { id: 'c1', creatorId: null, commenterId: 'cmtr-1' } as any;
    expect(await service.isGuestCommentOwner(owned, undefined, 'cmtr-1')).toBe(true);
    expect(await service.isGuestCommentOwner(owned, undefined, 'cmtr-2')).toBe(false);
    expect(await service.isGuestCommentOwner(owned, undefined, null)).toBe(false);
    const member = { id: 'c2', creatorId: 'user-1', commenterId: 'cmtr-1' } as any;
    expect(await service.isGuestCommentOwner(member, undefined, 'cmtr-1')).toBe(false);
  });

  it('deleting an inline guest comment removes its highlight server-side', async () => {
    const inline = { id: COMMENT, pageId: PAGE, spaceId: SPACE, type: 'inline', parentCommentId: null };
    const { service, collaborationGateway, commentRepo, wsService } =
      buildCommentService({ [COMMENT]: inline });
    await service.deleteGuestComment(inline as any);
    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalledWith(
      'unsetCommentMark',
      `page.${PAGE}`,
      { commentId: COMMENT, user: null },
    );
    expect(commentRepo.deleteComment).toHaveBeenCalledWith(COMMENT);
    expect(wsService.emitCommentEvent).toHaveBeenCalledWith(
      SPACE,
      PAGE,
      expect.objectContaining({ operation: 'commentDeleted', commentId: COMMENT }),
    );
  });

  it('resolve by a guest records the guest name and flips the highlight', async () => {
    const inline = { id: COMMENT, pageId: PAGE, spaceId: SPACE, type: 'inline', parentCommentId: null };
    const { service, collaborationGateway, rows } = buildCommentService({
      [COMMENT]: inline,
    });
    const updated = await service.resolveComment(inline as any, true, {
      guestName: 'Ana',
    });
    expect(updated.resolvedAt).toBeInstanceOf(Date);
    expect(updated.resolvedById).toBeNull();
    expect(updated.resolvedByGuestName).toBe('Ana');
    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalledWith(
      'resolveCommentMark',
      `page.${PAGE}`,
      { commentId: COMMENT, resolved: true, user: null },
    );

    const reopened = await service.resolveComment(rows.get(COMMENT), false, {
      guestName: 'Ana',
    });
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.resolvedByGuestName).toBeNull();
  });

  it('resolve by a member records the member, not a guest name', async () => {
    const pageComment = { id: COMMENT, pageId: PAGE, spaceId: SPACE, type: 'page', parentCommentId: null };
    const { service, collaborationGateway } = buildCommentService({
      [COMMENT]: pageComment,
    });
    const updated = await service.resolveComment(pageComment as any, true, {
      user: { id: 'user-1' } as any,
    });
    expect(updated.resolvedById).toBe('user-1');
    expect(updated.resolvedByGuestName).toBeNull();
    // page-level comments have no highlight to flip
    expect(collaborationGateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('replies cannot be resolved', async () => {
    const reply = { id: COMMENT, pageId: PAGE, spaceId: SPACE, parentCommentId: 'p1' };
    const { service } = buildCommentService({ [COMMENT]: reply });
    await expect(
      service.resolveComment(reply as any, true, { guestName: 'Ana' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ShareController guest comment actions', () => {
  function buildController(opts: {
    comment?: any;
    isOwner?: boolean;
    accessError?: Error;
    commenter?: any;
  }) {
    const shareService = {
      validateGuestCommentAccess: jest.fn(async () => {
        if (opts.accessError) throw opts.accessError;
        return { share: {}, page };
      }),
    };
    const commentService = {
      createGuestComment: jest.fn(async () => ({
        comment: { id: COMMENT },
        guestToken: 'tok',
      })),
      isGuestCommentOwner: jest.fn().mockResolvedValue(opts.isOwner ?? false),
      updateGuestComment: jest.fn(async (c: any, _content: any) => c),
      deleteGuestComment: jest.fn().mockResolvedValue(undefined),
      resolveComment: jest.fn(async (c) => c),
    };
    const commentRepo = {
      findById: jest.fn().mockResolvedValue('comment' in opts ? opts.comment : null),
    };
    const commenterService = {
      resolveFromRequest: jest.fn().mockResolvedValue(opts.commenter ?? null),
    };
    const controller = new ShareController(
      shareService as any,
      commentService as any,
      commentRepo as any,
      commenterService as any,
      {} as any, // shareRepo
      {} as any, // pageRepo
      {} as any, // pagePermissionRepo
      {} as any, // pageAccessService
      {} as any, // licenseCheckService
      { log: jest.fn() } as any, // auditService
    );
    return { controller, shareService, commentService, commenterService };
  }

  const workspace = { id: WS } as any;
  const guestComment = { id: COMMENT, pageId: PAGE, workspaceId: WS, creatorId: null };
  const content = JSON.stringify(doc);

  it('create returns the comment together with its one-time guest token', async () => {
    const { controller, commentService } = buildController({});
    const result = await controller.createGuestComment(
      { shareId: 's', pageId: PAGE, content, guestName: '  Ana  ', selection: 'x', yjsSelection } as any,
      workspace,
      {},
    );
    expect(result).toEqual({ id: COMMENT, guestToken: 'tok' });
    expect(commentService.createGuestComment).toHaveBeenCalledWith(
      expect.objectContaining({ guestName: 'Ana' }),
      expect.objectContaining({ selection: 'x', yjsSelection }),
    );
  });

  it('update/delete are refused without the owner token', async () => {
    const { controller, commentService } = buildController({
      comment: guestComment,
      isOwner: false,
    });
    await expect(
      controller.updateGuestComment(
        { shareId: 's', commentId: COMMENT, guestToken: 'bad', content } as any,
        workspace,
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.deleteGuestComment(
        { shareId: 's', commentId: COMMENT, guestToken: 'bad' } as any,
        workspace,
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(commentService.updateGuestComment).not.toHaveBeenCalled();
    expect(commentService.deleteGuestComment).not.toHaveBeenCalled();
  });

  it('owner can update (content re-sanitized) and delete', async () => {
    const { controller, commentService } = buildController({
      comment: guestComment,
      isOwner: true,
    });
    const hostile = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] },
        { type: 'iframe', attrs: { src: 'https://evil' } },
      ],
    });
    await controller.updateGuestComment(
      { shareId: 's', commentId: COMMENT, guestToken: 'tok', content: hostile } as any,
      workspace,
        {},
    );
    const sanitized = commentService.updateGuestComment.mock.calls[0][1];
    expect(JSON.stringify(sanitized)).not.toContain('iframe');

    await controller.deleteGuestComment(
      { shareId: 's', commentId: COMMENT, guestToken: 'tok' } as any,
      workspace,
      {},
    );
    expect(commentService.deleteGuestComment).toHaveBeenCalled();
  });

  it("access is validated against the comment's OWN page (no acting on comments outside the share)", async () => {
    const { controller, shareService, commentService } = buildController({
      comment: { ...guestComment, pageId: 'page-outside-share' },
      accessError: new ForbiddenException('Page is not covered by this share'),
    });
    await expect(
      controller.resolveGuestComment(
        { shareId: 's', commentId: COMMENT, resolved: true, guestName: 'Ana' } as any,
        workspace,
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(shareService.validateGuestCommentAccess).toHaveBeenCalledWith(
      's',
      'page-outside-share',
      WS,
    );
    expect(commentService.resolveComment).not.toHaveBeenCalled();
  });

  it('404 for missing or foreign-workspace comments', async () => {
    for (const comment of [null, { ...guestComment, workspaceId: 'other' }]) {
      const { controller } = buildController({ comment });
      await expect(
        controller.resolveGuestComment(
          { shareId: 's', commentId: COMMENT, resolved: true, guestName: 'Ana' } as any,
          workspace,
          {},
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('any guest can resolve (attributed to their display name); blank name is refused', async () => {
    const { controller, commentService } = buildController({
      comment: guestComment,
    });
    await controller.resolveGuestComment(
      { shareId: 's', commentId: COMMENT, resolved: true, guestName: ' Ana ' } as any,
      workspace,
      {},
    );
    expect(commentService.resolveComment).toHaveBeenCalledWith(
      guestComment,
      true,
      { guestName: 'Ana' },
    );
    await expect(
      controller.resolveGuestComment(
        { shareId: 's', commentId: COMMENT, resolved: true, guestName: '   ' } as any,
        workspace,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a signed-in commenter posts under their account without a guest name', async () => {
    const commenter = { id: 'cmtr-1', name: 'Sam Kelly', email: 'sam@x.co' };
    const { controller, commentService } = buildController({ commenter });
    await controller.createGuestComment(
      { shareId: 's', pageId: PAGE, content } as any,
      workspace,
      {},
    );
    expect(commentService.createGuestComment).toHaveBeenCalledWith(
      expect.objectContaining({ guestName: 'Sam Kelly', commenterId: 'cmtr-1' }),
      expect.anything(),
    );
  });

  it('an anonymous guest still needs a display name', async () => {
    const { controller, commentService } = buildController({});
    await expect(
      controller.createGuestComment(
        { shareId: 's', pageId: PAGE, content } as any,
        workspace,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(commentService.createGuestComment).not.toHaveBeenCalled();
  });

  it('ownership check passes the signed-in commenter id (no token needed)', async () => {
    const commenter = { id: 'cmtr-1', name: 'Sam Kelly' };
    const { controller, commentService } = buildController({
      comment: { ...guestComment, commenterId: 'cmtr-1' },
      commenter,
      isOwner: true,
    });
    await controller.deleteGuestComment(
      { shareId: 's', commentId: COMMENT } as any,
      workspace,
      {},
    );
    expect(commentService.isGuestCommentOwner).toHaveBeenCalledWith(
      expect.objectContaining({ id: COMMENT }),
      undefined,
      'cmtr-1',
    );
    expect(commentService.deleteGuestComment).toHaveBeenCalled();
  });

  it('a signed-in commenter resolves as themselves', async () => {
    const commenter = { id: 'cmtr-1', name: 'Sam Kelly' };
    const { controller, commentService } = buildController({
      comment: guestComment,
      commenter,
    });
    await controller.resolveGuestComment(
      { shareId: 's', commentId: COMMENT, resolved: true } as any,
      workspace,
      {},
    );
    expect(commentService.resolveComment).toHaveBeenCalledWith(
      guestComment,
      true,
      { guestName: 'Sam Kelly', commenterId: 'cmtr-1' },
    );
  });
});
