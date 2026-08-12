import { useState } from "react";
import { ActionIcon, Badge, Group, Stack, Text } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { MxdField, MxdRecord, MxdView } from "../mxd-data.api";

interface Props {
  fields: MxdField[];
  records: MxdRecord[];
  view: MxdView;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Calendar renderer: places records on the day of their date field
// (view.config.displayFieldId). Requires a date/datetime field — the view
// validator guarantees one on a saved calendar view.
export function MxdCalendarView({ fields, records, view }: Props) {
  const displayFieldId: string | undefined = view.config?.displayFieldId;
  const primary = fields[0];
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  if (!displayFieldId) {
    return (
      <Text size="sm" c="dimmed">
        This calendar needs a date field. Set one in the view settings.
      </Text>
    );
  }

  // Bucket records by their day.
  const byDay = new Map<string, MxdRecord[]>();
  for (const r of records) {
    const raw = r.data?.[displayFieldId];
    if (typeof raw !== "string" || !raw) continue;
    const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
    if (isNaN(d.getTime())) continue;
    const key = dayKey(d);
    const arr = byDay.get(key) ?? [];
    arr.push(r);
    byDay.set(key, arr);
  }

  const first = new Date(cursor.year, cursor.month, 1);
  const startOffset = first.getDay(); // 0=Sun
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(new Date(cursor.year, cursor.month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = first.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const todayKey = dayKey(new Date());

  const shift = (delta: number) =>
    setCursor((c) => {
      const m = c.month + delta;
      return {
        year: c.year + Math.floor(m / 12),
        month: ((m % 12) + 12) % 12,
      };
    });

  const label = (r: MxdRecord): string => {
    const v = primary ? r.data?.[primary.id] : undefined;
    const s = v == null ? "" : String(v);
    return s || "(untitled)";
  };

  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          {monthLabel}
        </Text>
        <Group gap={4}>
          <ActionIcon size="sm" variant="subtle" onClick={() => shift(-1)} aria-label="Previous month">
            <IconChevronLeft size={16} />
          </ActionIcon>
          <ActionIcon size="sm" variant="subtle" onClick={() => shift(1)} aria-label="Next month">
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
      </Group>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 1,
          background: "var(--mantine-color-default-border)",
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            style={{
              background: "var(--mantine-color-body)",
              padding: "4px 6px",
            }}
          >
            <Text size="xs" c="dimmed" fw={600}>
              {w}
            </Text>
          </div>
        ))}
        {cells.map((date, i) => {
          const key = date ? dayKey(date) : `blank-${i}`;
          const items = date ? (byDay.get(key) ?? []) : [];
          return (
            <div
              key={key}
              style={{
                background: "var(--mantine-color-body)",
                minHeight: 76,
                padding: 4,
                opacity: date ? 1 : 0.4,
              }}
            >
              {date && (
                <Text
                  size="xs"
                  c={key === todayKey ? "blue" : "dimmed"}
                  fw={key === todayKey ? 700 : 400}
                >
                  {date.getDate()}
                </Text>
              )}
              <Stack gap={2} mt={2}>
                {items.slice(0, 3).map((r) => (
                  <Badge
                    key={r.id}
                    size="sm"
                    variant="light"
                    radius="sm"
                    fullWidth
                    styles={{ label: { overflow: "hidden", textOverflow: "ellipsis" } }}
                  >
                    {label(r)}
                  </Badge>
                ))}
                {items.length > 3 && (
                  <Text size="xs" c="dimmed">
                    +{items.length - 3} more
                  </Text>
                )}
              </Stack>
            </div>
          );
        })}
      </div>
    </Stack>
  );
}
