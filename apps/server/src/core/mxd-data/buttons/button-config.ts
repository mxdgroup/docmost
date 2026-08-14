import { BadRequestException } from '@nestjs/common';
import { MxdField } from '@docmost/db/types/entity.types';
import { getFieldType } from '../field-types/field-types.registry';

// MXD data platform — button/action config (roadmap §37-38). Buttons are
// DECLARATIVE: a fixed set of action shapes, never arbitrary code or shell. Each
// action is validated against the table's fields at config time and executed
// server-side under the caller's write authorization at run time.

export type ButtonAction =
  | { type: 'setField'; fieldId: string; value: unknown }
  | { type: 'clearField'; fieldId: string }
  | { type: 'setNow'; fieldId: string }
  | { type: 'createRecord'; cells: Record<string, unknown> }
  | { type: 'openUrl'; url: string };

export interface ButtonConfig {
  label?: string;
  actions: ButtonAction[];
}

export const BUTTON_ACTION_TYPES = [
  'setField',
  'clearField',
  'setNow',
  'createRecord',
  'openUrl',
] as const;

const MAX_ACTIONS = 10;

// A field a button may WRITE to: must exist on the table and be a plain settable
// cell (not computed/relation/button — those aren't writable cells).
function requireSettableField(fields: MxdField[], fieldId: string): MxdField {
  const f = fields.find((x) => x.id === fieldId);
  if (!f) {
    throw new BadRequestException(`Action references unknown field: ${fieldId}`);
  }
  const t = getFieldType(f.type);
  if (t.isComputed || t.isRelation || f.type === 'button') {
    throw new BadRequestException(
      `Field "${f.name}" cannot be set by a button (computed/relation/button)`,
    );
  }
  return f;
}

export function validateButtonConfig(
  fields: MxdField[],
  config: ButtonConfig | undefined | null,
): ButtonConfig {
  if (!config || !Array.isArray(config.actions)) {
    throw new BadRequestException('A button requires an actions array');
  }
  if (config.actions.length === 0) {
    throw new BadRequestException('A button needs at least one action');
  }
  if (config.actions.length > MAX_ACTIONS) {
    throw new BadRequestException(`Too many actions (max ${MAX_ACTIONS})`);
  }
  const ids = new Set(fields.map((f) => f.id));
  for (const a of config.actions) {
    switch (a.type) {
      case 'setField':
        requireSettableField(fields, a.fieldId);
        break;
      case 'clearField':
      case 'setNow': {
        const f = requireSettableField(fields, a.fieldId);
        if (a.type === 'setNow' && !['date', 'datetime'].includes(f.type)) {
          throw new BadRequestException(
            `setNow targets a date/datetime field, not "${f.name}"`,
          );
        }
        break;
      }
      case 'createRecord':
        if (!a.cells || typeof a.cells !== 'object') {
          throw new BadRequestException('createRecord requires a cells object');
        }
        for (const fieldId of Object.keys(a.cells)) {
          if (!ids.has(fieldId)) {
            throw new BadRequestException(
              `createRecord references unknown field: ${fieldId}`,
            );
          }
        }
        break;
      case 'openUrl': {
        let parsed: URL;
        try {
          parsed = new URL(String(a.url));
        } catch {
          throw new BadRequestException('openUrl requires a valid URL');
        }
        if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
          throw new BadRequestException('openUrl scheme is not allowed');
        }
        break;
      }
      default:
        throw new BadRequestException(
          `Unknown button action type: ${(a as any).type}`,
        );
    }
  }
  return config;
}
