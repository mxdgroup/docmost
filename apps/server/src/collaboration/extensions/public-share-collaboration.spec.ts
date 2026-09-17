import { Server } from '@hocuspocus/server';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { AuthenticationExtension } from './authentication.extension';
import { PersistenceExtension } from './persistence.extension';
import { TokenService } from '../../core/auth/services/token.service';
import { CollaborationHandler } from '../collaboration.handler';

const PAGE = '00000000-0000-0000-0000-000000000001';
const WORKSPACE = '00000000-0000-0000-0000-000000000002';
const SHARE = '00000000-0000-0000-0000-000000000003';
const SECRET = 'public-share-test-secret-at-least-32-characters';

async function until(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout)
      throw new Error('Timed out waiting for collaboration');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Real signed tokens, websocket clients, Hocuspocus message processing and the
// production persistence extension. Only database/queue I/O is substituted.
describe('Public collaborative editing over real websockets', () => {
  let server: Server;
  let share: any;
  let saved: any;
  let tokens: TokenService;
  let providers: HocuspocusProvider[];
  let sockets: HocuspocusProviderWebsocket[];
  let writes: number;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    share = { id: SHARE, pageId: PAGE, workspaceId: WORKSPACE, mode: 'edit' };
    saved = {
      id: PAGE,
      workspaceId: WORKSPACE,
      creatorId: null,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdAt: new Date(),
    };
    writes = 0;
    providers = [];
    sockets = [];
    tokens = new TokenService(new JwtService({ secret: SECRET }), {
      getAppSecret: () => SECRET,
    } as any);
    const pageRepo = {
      findById: async (id: string) => (id === PAGE ? saved : null),
      updatePage: async (update: any) => {
        saved = { ...saved, ...update };
        writes++;
      },
    };
    const auth = new AuthenticationExtension(
      tokens,
      {} as any,
      pageRepo as any,
      {} as any,
      { hasRestrictedAncestor: async () => false } as any,
      {
        findById: async () => share,
        isSharingAllowed: async () => true,
        isPageWithinShareScope: async (_share: any, pageId: string) =>
          pageId === PAGE,
      } as any,
      {
        isShareEditEnabled: () => true,
        isShareGuestCommentsEnabled: () => true,
      } as any,
    );
    const queue = { add: async () => undefined } as any;
    const persistence = new PersistenceExtension(
      pageRepo as any,
      {
        transaction: () => ({ execute: (callback: any) => callback({}) }),
      } as any,
      queue,
      queue,
      queue,
      { addContributors: async () => undefined } as any,
      {
        syncPageTransclusions: async () => undefined,
        syncPageReferences: async () => undefined,
      } as any,
    );
    server = new Server({
      port: 0,
      address: '127.0.0.1',
      quiet: true,
      debounce: 20,
      maxDebounce: 50,
      extensions: [auth, persistence],
    });
    await server.listen();
  });

  afterEach(async () => {
    providers.forEach((provider) => provider.destroy());
    sockets.forEach((socket) => socket.destroy());
    await server.destroy();
  });

  async function connect(pageId = PAGE, onAuthenticationFailed?: () => void) {
    const token = await tokens.generateShareCollabToken({
      shareId: SHARE,
      pageId: PAGE,
      workspaceId: WORKSPACE,
      guestId: 'abc123-guest',
    });
    const socket = new HocuspocusProviderWebsocket({
      url: server.webSocketURL,
      WebSocketPolyfill: WebSocket,
    });
    sockets.push(socket);
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: `page.${pageId}`,
      document: new Y.Doc(),
      token,
      onAuthenticationFailed,
    });
    providers.push(provider);
    provider.attach();
    if (!onAuthenticationFailed) await until(() => provider.isSynced);
    return provider;
  }

  function addText(provider: HocuspocusProvider, value: string) {
    const fragment = provider.document.getXmlFragment('default');
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, value);
    paragraph.insert(0, [text]);
    fragment.insert(fragment.length, [paragraph]);
  }

  it('syncs two anonymous editors, persists content and guest attribution, then reloads saved Yjs state', async () => {
    const first = await connect();
    const second = await connect();
    addText(first, 'Anonymous content survives refresh');
    await until(() =>
      second.document
        .getXmlFragment('default')
        .toString()
        .includes('survives refresh'),
    );
    await until(() => writes > 0);
    expect(JSON.stringify(saved.content)).toContain(
      'Anonymous content survives refresh',
    );
    expect(saved.lastUpdatedByGuest).toBe('Guest abc123');
    expect(saved.lastUpdatedById).toBeNull();
    first.destroy();
    second.destroy();
    sockets.forEach((socket) => socket.destroy());
    await until(() => !server.hocuspocus.documents.has(`page.${PAGE}`));
    const refreshed = await connect();
    expect(refreshed.document.getXmlFragment('default').toString()).toContain(
      'survives refresh',
    );
  });

  it('blocks malicious Yjs writes on comment links while allowing synchronization', async () => {
    share.mode = 'comment';
    const attacker = await connect();
    const observer = await connect();
    addText(attacker, 'must never be saved');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(writes).toBe(0);
    expect(
      observer.document.getXmlFragment('default').toString(),
    ).not.toContain('must never');
  });

  it('rejects updates sent on an already connected socket after downgrade', async () => {
    const attacker = await connect();
    share.mode = 'comment';
    let denied = false;
    attacker.on('stateless', ({ payload }) => {
      denied = JSON.parse(payload).type === 'share.access-denied';
    });
    addText(attacker, 'rejected after downgrade');
    await until(() => denied);
    expect(writes).toBe(0);
  });

  it('pushes revocation to idle editors and stops their connection', async () => {
    const visitor = await connect();
    let denied = false;
    visitor.on('stateless', ({ payload }) => {
      denied = JSON.parse(payload).type === 'share.access-denied';
    });
    share = null;
    await new CollaborationHandler()
      .getHandlers(server.hocuspocus)
      .revokeShareSessions(`page.${PAGE}`, { shareId: SHARE });
    await until(() => denied);
    expect(
      server.hocuspocus.documents.get(`page.${PAGE}`)?.getConnectionsCount() ??
        0,
    ).toBe(0);
  });

  it('rejects replaying a signed share token against a private document', async () => {
    let denied = false;
    await connect('00000000-0000-0000-0000-000000000099', () => {
      denied = true;
    });
    await until(() => denied);
    expect(writes).toBe(0);
  });
});
