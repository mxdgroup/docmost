import { Global, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectKysely, KyselyModule } from 'nestjs-kysely';
import { EnvironmentService } from '../integrations/environment/environment.service';
import { CamelCasePlugin, LogEvent, sql } from 'kysely';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PageRepo } from './repos/page/page.repo';
import { PagePermissionRepo } from './repos/page/page-permission.repo';
import { CommentRepo } from './repos/comment/comment.repo';
import { PageTransclusionsRepo } from './repos/page-transclusions/page-transclusions.repo';
import { PageTransclusionReferencesRepo } from './repos/page-transclusions/page-transclusion-references.repo';
import { PageHistoryRepo } from './repos/page/page-history.repo';
import { AttachmentRepo } from './repos/attachment/attachment.repo';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import * as process from 'node:process';
import { MigrationService } from '@docmost/db/services/migration.service';
import { UserTokenRepo } from './repos/user-token/user-token.repo';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { NotificationRepo } from '@docmost/db/repos/notification/notification.repo';
import { WatcherRepo } from '@docmost/db/repos/watcher/watcher.repo';
import { LabelRepo } from '@docmost/db/repos/label/label.repo';
import { FavoriteRepo } from '@docmost/db/repos/favorite/favorite.repo';
import { TemplateRepo } from '@docmost/db/repos/template/template.repo';
import { PageListener } from '@docmost/db/listeners/page.listener';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { normalizePostgresUrl } from '../common/helpers';

@Global()
@Module({
  imports: [
    KyselyModule.forRootAsync({
      imports: [],
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        dialect: new PostgresJSDialect({
          postgres: postgres(
            normalizePostgresUrl(environmentService.getDatabaseURL()),
            {
              max: environmentService.getDatabaseMaxPool(),
              onnotice: () => {},
              types: {
                bigint: {
                  to: 20,
                  from: [20, 1700],
                  serialize: (value: number) => value.toString(),
                  parse: (value: string) => Number.parseInt(value),
                },
              },
            },
          ),
        }),
        plugins: [new CamelCasePlugin()],
        log: (event: LogEvent) => {
          if (environmentService.getNodeEnv() !== 'development') return;
          const logger = new Logger(DatabaseModule.name);
          if (process.env.DEBUG_DB?.toLowerCase() === 'true') {
            logger.debug(event.query.sql);
            logger.debug('query time: ' + event.queryDurationMillis + ' ms');
          }
        },
      }),
    }),
  ],
  providers: [
    MigrationService,
    WorkspaceRepo,
    UserRepo,
    GroupRepo,
    GroupUserRepo,
    SpaceRepo,
    SpaceMemberRepo,
    PageRepo,
    PagePermissionRepo,
    PageTransclusionsRepo,
    PageTransclusionReferencesRepo,
    PageHistoryRepo,
    CommentRepo,
    FavoriteRepo,
    AttachmentRepo,
    UserTokenRepo,
    UserSessionRepo,
    BacklinkRepo,
    ShareRepo,
    NotificationRepo,
    WatcherRepo,
    LabelRepo,
    TemplateRepo,
    PageListener,
  ],
  exports: [
    WorkspaceRepo,
    UserRepo,
    GroupRepo,
    GroupUserRepo,
    SpaceRepo,
    SpaceMemberRepo,
    PageRepo,
    PagePermissionRepo,
    PageTransclusionsRepo,
    PageTransclusionReferencesRepo,
    PageHistoryRepo,
    CommentRepo,
    FavoriteRepo,
    AttachmentRepo,
    UserTokenRepo,
    UserSessionRepo,
    BacklinkRepo,
    ShareRepo,
    NotificationRepo,
    WatcherRepo,
    LabelRepo,
    TemplateRepo,
  ],
})
export class DatabaseModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly migrationService: MigrationService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async onApplicationBootstrap() {
    await this.establishConnection();

    if (this.environmentService.getNodeEnv() === 'production') {
      await this.migrationService.migrateToLatest();
      // MXD fork migrations run after upstream's, from their own ledger
      // (mxd_migration) — see MXD-FORK.md.
      await this.migrationService.migrateMxdToLatest();
    }

    // Fail-fast deploy invariant (MXD): if the data platform is enabled, its
    // schema MUST be present. Boot runs migrateMxdToLatest above, so this only
    // trips when the fork migrations did not run against this database (e.g. an
    // env that skips boot migrations, or a schema/image mismatch). Turning that
    // into a loud boot failure prevents the far worse alternative — a container
    // that starts, passes a health check, then 500s the first time a data-
    // platform request hits a table that was never created.
    await this.verifyMxdSchema();
  }

  private async verifyMxdSchema(): Promise<void> {
    if (!this.environmentService.isMxdDataPlatformEnabled()) return;
    const row = await sql<{
      present: string | null;
    }>`select to_regclass('public.mxd_tables')::text as present`.execute(
      this.db,
    );
    const present = row.rows?.[0]?.present;
    if (!present) {
      this.logger.error(
        'MXD_DATA_PLATFORM_ENABLED is on but table mxd_tables is missing — ' +
          'fork migrations (mxd_migration) have not been applied to this ' +
          'database. Refusing to start. Run migrations or deploy with ' +
          'NODE_ENV=production so boot applies them.',
      );
      process.exit(1);
    }
    this.logger.log('MXD data-platform schema verified (mxd_tables present)');
  }

  async establishConnection() {
    const retryAttempts = 15;
    const retryDelay = 3000;

    this.logger.log('Establishing database connection');
    for (let i = 0; i < retryAttempts; i++) {
      try {
        await sql`SELECT 1=1`.execute(this.db);
        this.logger.log('Database connection successful');
        break;
      } catch (err) {
        if (err['errors']) {
          this.logger.error(err['errors'][0]);
        } else {
          this.logger.error(err);
        }

        if (i < retryAttempts - 1) {
          this.logger.log(
            `Retrying [${i + 1}/${retryAttempts}] in ${retryDelay / 1000} seconds`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          this.logger.error(
            `Failed to connect to database after ${retryAttempts} attempts. Exiting...`,
          );
          process.exit(1);
        }
      }
    }
  }
}
