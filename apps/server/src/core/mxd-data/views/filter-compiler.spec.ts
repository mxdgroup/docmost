import { BadRequestException } from '@nestjs/common';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { MxdField } from '@docmost/db/types/entity.types';
import { compileFilter } from './filter-compiler';
import { FilterGroup } from './view-config';

// A stub Kysely instance used ONLY to compile RawBuilder fragments into SQL
// text + bound parameters. PostgresDialect requires a `pool`-shaped value at
// construction time, but .compile() never talks to it — it just walks the
// query AST — so a dummy, never-connected pool keeps this test fully
// offline and deterministic. CamelCasePlugin mirrors the real DatabaseModule
// setup, since filter-compiler.ts relies on it to map system columns like
// `createdAt` -> `created_at`.
const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: {} as any }),
  plugins: [new CamelCasePlugin()],
});

function makeField(overrides: { id: string; type: string }): MxdField {
  return {
    id: overrides.id,
    type: overrides.type,
    name: overrides.type,
    tableId: 't1',
    workspaceId: 'ws1',
    position: 0,
    config: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as any;
}

function compileGroup(fieldsById: Map<string, MxdField>, group: FilterGroup) {
  return compileFilter(fieldsById, group).compile(db);
}

describe('filter-compiler', () => {
  it('binds field id and value as parameters, never interpolated into the SQL text', () => {
    const f = makeField({ id: 'my-field-id', type: 'text' });
    const fieldsById = new Map([[f.id, f]]);
    const group: FilterGroup = {
      combinator: 'and',
      conditions: [{ fieldId: f.id, op: 'equals', value: 'secret-value' }],
    };

    const compiled = compileGroup(fieldsById, group);

    expect(compiled.sql).toContain('->>');
    expect(compiled.sql).not.toContain('my-field-id');
    expect(compiled.sql).not.toContain('secret-value');
    expect(compiled.parameters).toEqual(
      expect.arrayContaining(['my-field-id', 'secret-value']),
    );
  });

  it('throws BadRequestException for an unsupported filter operator', () => {
    const f = makeField({ id: 'f1', type: 'text' });
    const fieldsById = new Map([[f.id, f]]);
    const group: FilterGroup = {
      combinator: 'and',
      conditions: [{ fieldId: f.id, op: 'bogusOp' as any, value: 'x' }],
    };

    expect(() => compileFilter(fieldsById, group)).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for a condition referencing an unknown field', () => {
    const fieldsById = new Map<string, MxdField>();
    const group: FilterGroup = {
      combinator: 'and',
      conditions: [{ fieldId: 'ghost', op: 'equals', value: 'x' }],
    };

    expect(() => compileFilter(fieldsById, group)).toThrow(
      BadRequestException,
    );
  });

  it('compiles system field types to their real record columns, not data ->> id', () => {
    const createdTime = makeField({ id: 'ct', type: 'created_time' });
    const createdBy = makeField({ id: 'cb', type: 'created_by' });
    const autonumber = makeField({ id: 'an', type: 'autonumber' });

    const check = (field: MxdField, expectedColumn: string) => {
      const fieldsById = new Map([[field.id, field]]);
      const group: FilterGroup = {
        combinator: 'and',
        conditions: [{ fieldId: field.id, op: 'isNotEmpty' }],
      };
      const compiled = compileGroup(fieldsById, group);
      expect(compiled.sql).toContain(expectedColumn);
      expect(compiled.sql).not.toContain('->>');
      // The field id never needs to be bound as a parameter for a system
      // field — it's compiled straight to a real column reference.
      expect(compiled.parameters).toEqual([]);
    };

    check(createdTime, 'created_at');
    check(createdBy, 'creator_id');
    check(autonumber, 'position');
  });

  it('only ever emits the fixed " and " / " or " combinator fragments', () => {
    const f = makeField({ id: 'f2', type: 'text' });
    const fieldsById = new Map([[f.id, f]]);
    const twoConditions = (combinator: 'and' | 'or'): FilterGroup => ({
      combinator,
      conditions: [
        { fieldId: f.id, op: 'equals', value: 'a' },
        { fieldId: f.id, op: 'equals', value: 'b' },
      ],
    });

    const andCompiled = compileGroup(fieldsById, twoConditions('and'));
    expect(andCompiled.sql).toContain(' and ');
    expect(andCompiled.sql).not.toContain(' or ');

    const orCompiled = compileGroup(fieldsById, twoConditions('or'));
    expect(orCompiled.sql).toContain(' or ');
    expect(orCompiled.sql).not.toContain(' and ');

    // A malicious/unexpected combinator string can only ever fall through to
    // the fixed " and " fragment (the compiler never interpolates the client
    // string itself).
    const weirdCombinator = twoConditions('and');
    (weirdCombinator as any).combinator = "'; DROP TABLE mxd_records; --";
    const weirdCompiled = compileGroup(fieldsById, weirdCombinator);
    expect(weirdCompiled.sql).toContain(' and ');
    expect(weirdCompiled.sql).not.toContain('DROP TABLE');
  });

  it('returns a bare "true" fragment for an empty condition list', () => {
    const group: FilterGroup = { combinator: 'and', conditions: [] };
    const compiled = compileGroup(new Map(), group);
    expect(compiled.sql).toContain('true');
    expect(compiled.parameters).toEqual([]);
  });
});
