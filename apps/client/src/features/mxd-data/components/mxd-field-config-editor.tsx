import { useMemo } from "react";
import { Select, Stack, Text, Textarea } from "@mantine/core";
import { MxdField } from "../mxd-data.api";
import { fieldTypeMeta } from "../mxd-field-types";
import { useMxdFields } from "../queries/mxd-data-query";

interface Props {
  tableId: string;
  type: string;
  config: Record<string, any>;
  onChange: (config: Record<string, any>) => void;
}

const ROLLUP_OPS = ["count", "sum", "avg", "min", "max", "concat"] as const;

// Formula field references are stored as {fieldId} but shown/edited as {Field
// Name} so a human can actually read them. Field ids are stable, so display
// always reflects the current names even after a rename.
function toDisplay(expr: string, fields: MxdField[]): string {
  const byId = new Map(fields.map((f) => [f.id, f.name]));
  return (expr ?? "").replace(/\{([^}]*)\}/g, (m, inner) =>
    byId.has(inner) ? `{${byId.get(inner)}}` : m,
  );
}
function toStored(expr: string, fields: MxdField[]): string {
  const byName = new Map(fields.map((f) => [f.name, f.id]));
  return (expr ?? "").replace(/\{([^}]*)\}/g, (m, inner) =>
    byName.has(inner) ? `{${byName.get(inner)}}` : m,
  );
}

// Config inputs for the computed / relation-derived field types (formula,
// lookup, rollup). Emits the stored config shape the server expects. Kept
// separate so both Add Column and Field Settings can reuse it.
export function MxdFieldConfigEditor({ tableId, type, config, onChange }: Props) {
  const fieldsQuery = useMxdFields(tableId);
  const fields = fieldsQuery.data ?? [];
  const relationFields = fields.filter((f) => fieldTypeMeta(f.type).relation);

  const relatedTableId: string | undefined = useMemo(() => {
    const via = relationFields.find((f) => f.id === config.viaFieldId);
    return via?.config?.relatedTableId;
  }, [relationFields, config.viaFieldId]);

  const relatedFieldsQuery = useMxdFields(relatedTableId ?? "");
  const relatedFields = relatedFieldsQuery.data ?? [];

  if (type === "formula") {
    const displayExpr = toDisplay(config.expression ?? "", fields);
    return (
      <Stack gap={6}>
        <Textarea
          label="Expression"
          description="Reference fields with { }, e.g. {Score} * 2. Functions: SUM, IF, CONCAT, ROUND…"
          autosize
          minRows={2}
          maxRows={6}
          value={displayExpr}
          onChange={(e) =>
            onChange({
              ...config,
              expression: toStored(e.currentTarget.value, fields),
            })
          }
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
        />
        <Select
          label="Insert field"
          placeholder="Add a field reference"
          size="xs"
          value={null}
          data={fields
            .filter((f) => !fieldTypeMeta(f.type).button)
            .map((f) => ({ value: f.id, label: f.name }))}
          onChange={(id) => {
            if (!id) return;
            const f = fields.find((x) => x.id === id);
            if (!f) return;
            const cur = toDisplay(config.expression ?? "", fields);
            const next = (cur ? cur + " " : "") + `{${f.name}}`;
            onChange({ ...config, expression: toStored(next, fields) });
          }}
          comboboxProps={{ withinPortal: true }}
        />
      </Stack>
    );
  }

  if (type === "lookup" || type === "rollup") {
    return (
      <Stack gap={6}>
        <Select
          label="Via relation"
          description="Which relation on this table to follow"
          placeholder={
            relationFields.length ? "Pick a relation field" : "No relation fields yet"
          }
          value={config.viaFieldId ?? null}
          data={relationFields.map((f) => ({ value: f.id, label: f.name }))}
          onChange={(v) =>
            onChange({ ...config, viaFieldId: v ?? undefined, targetFieldId: undefined })
          }
          comboboxProps={{ withinPortal: true }}
        />
        <Select
          label="Target field"
          description="Which field on the related table to read"
          placeholder={
            relatedTableId ? "Pick a field" : "Pick a relation first"
          }
          value={config.targetFieldId ?? null}
          data={relatedFields.map((f) => ({ value: f.id, label: f.name }))}
          disabled={!relatedTableId}
          onChange={(v) => onChange({ ...config, targetFieldId: v ?? undefined })}
          comboboxProps={{ withinPortal: true }}
        />
        {type === "rollup" && (
          <Select
            label="Aggregation"
            value={config.rollup ?? "count"}
            data={ROLLUP_OPS.map((o) => ({ value: o, label: o }))}
            onChange={(v) => onChange({ ...config, rollup: v ?? "count" })}
            comboboxProps={{ withinPortal: true }}
          />
        )}
      </Stack>
    );
  }

  return (
    <Text size="xs" c="dimmed">
      This field type has no extra settings.
    </Text>
  );
}

// Whether a computed config is complete enough to save.
export function isComputedConfigValid(
  type: string,
  config: Record<string, any>,
): boolean {
  if (type === "formula") return !!(config.expression ?? "").trim();
  if (type === "lookup" || type === "rollup")
    return !!config.viaFieldId && !!config.targetFieldId;
  return true;
}
