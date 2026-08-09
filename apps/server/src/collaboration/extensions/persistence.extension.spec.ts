import { authorizedUserMentions } from './persistence.extension';

const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';
const VICTIM = '00000000-0000-0000-0000-0000000000ff';

describe('authorizedUserMentions (anonymous mention-spoof guard)', () => {
  it('keeps mentions authored by an authenticated contributor', () => {
    const mentions = [{ creatorId: U1, entityId: VICTIM, id: 'm1' }];
    expect(authorizedUserMentions(mentions, [U1, U2])).toEqual(mentions);
  });

  it('drops a mention whose creatorId is NOT a real contributor (anonymous inject)', () => {
    // anonymous session: editingUserIds is empty (onChange skips no-user edits)
    const spoof = [{ creatorId: VICTIM, entityId: U1, id: 'm1' }];
    expect(authorizedUserMentions(spoof, [])).toEqual([]);
  });

  it('drops a cross-spoofed mention (real target, forged sender not in the session)', () => {
    // a guest edit in a window where only U1 legitimately edited cannot forge
    // a mention "from" U2
    const spoof = [{ creatorId: U2, entityId: VICTIM, id: 'm1' }];
    expect(authorizedUserMentions(spoof, [U1])).toEqual([]);
  });

  it('filters a mixed batch to only the authenticated-authored ones', () => {
    const batch = [
      { creatorId: U1, entityId: VICTIM, id: 'ok' },
      { creatorId: VICTIM, entityId: U1, id: 'spoof' },
    ];
    expect(authorizedUserMentions(batch, [U1])).toEqual([
      { creatorId: U1, entityId: VICTIM, id: 'ok' },
    ]);
  });
});
