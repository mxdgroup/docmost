import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Divider,
  Group,
  Loader,
  Modal,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { IconCheck, IconLink, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { MxdForm } from "../mxd-data.api";
import { fieldTypeMeta } from "../mxd-field-types";
import {
  useMxdFields,
  useMxdFormMutations,
  useMxdForms,
} from "../queries/mxd-data-query";

interface Props {
  tableId: string;
  opened: boolean;
  onClose: () => void;
}

interface Draft {
  formId?: string;
  title: string;
  description: string;
  fieldIds: string[];
  submitMessage: string;
  enabled: boolean;
}

function formUrl(key: string): string {
  return `${window.location.origin}/forms/${key}`;
}

// Forms manager: a form collects a whitelisted set of fields via a public link
// and creates a record on submit.
export function MxdFormsModal({ tableId, opened, onClose }: Props) {
  const formsQuery = useMxdForms(tableId, opened);
  const fields = useMxdFields(tableId).data ?? [];
  const settable = fields.filter((f) => {
    const m = fieldTypeMeta(f.type);
    return !m.computed && !m.relation && !m.button;
  });
  const { create, update, remove } = useMxdFormMutations(tableId);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!opened) setDraft(null);
  }, [opened]);

  const startNew = () =>
    setDraft({
      title: "Form",
      description: "",
      fieldIds: settable.map((f) => f.id),
      submitMessage: "",
      enabled: true,
    });
  const startEdit = (f: MxdForm) =>
    setDraft({
      formId: f.id,
      title: f.title,
      description: f.description ?? "",
      fieldIds: f.fieldIds ?? [],
      submitMessage: f.submitMessage ?? "",
      enabled: f.enabled,
    });

  const toggleField = (id: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            fieldIds: d.fieldIds.includes(id)
              ? d.fieldIds.filter((x) => x !== id)
              : [...d.fieldIds, id],
          }
        : d,
    );

  const draftValid = !!draft && draft.fieldIds.length > 0;

  const saveDraft = async () => {
    if (!draft || !draftValid) return;
    const payload = {
      title: draft.title,
      description: draft.description || undefined,
      fieldIds: draft.fieldIds,
      submitMessage: draft.submitMessage || undefined,
      enabled: draft.enabled,
    };
    try {
      if (draft.formId) await update.mutateAsync({ formId: draft.formId, ...payload });
      else await create.mutateAsync(payload);
      setDraft(null);
    } catch {
      /* surfaced by hooks */
    }
  };

  const forms = formsQuery.data ?? [];

  return (
    <Modal opened={opened} onClose={onClose} title="Forms" size="lg" centered>
      {draft ? (
        <Stack>
          <TextInput
            label="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
          />
          <Textarea
            label="Description"
            autosize
            minRows={1}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.currentTarget.value })
            }
          />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Fields to collect
            </Text>
            <Stack gap={4}>
              {settable.map((f) => (
                <Checkbox
                  key={f.id}
                  size="sm"
                  label={f.name}
                  checked={draft.fieldIds.includes(f.id)}
                  onChange={() => toggleField(f.id)}
                />
              ))}
              {settable.length === 0 && (
                <Text size="xs" c="dimmed">
                  This table has no fields a form can collect yet.
                </Text>
              )}
            </Stack>
          </div>
          <TextInput
            label="Message after submit"
            placeholder="Thanks!"
            value={draft.submitMessage}
            onChange={(e) =>
              setDraft({ ...draft, submitMessage: e.currentTarget.value })
            }
          />
          <Switch
            label="Enabled"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.currentTarget.checked })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveDraft}
              disabled={!draftValid}
              loading={create.isPending || update.isPending}
            >
              Save form
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Collect submissions through a public link.
            </Text>
            <Button
              size="compact-sm"
              leftSection={<IconPlus size={14} />}
              onClick={startNew}
            >
              New form
            </Button>
          </Group>
          <Divider />
          {formsQuery.isLoading ? (
            <Group justify="center" my="md">
              <Loader size="sm" />
            </Group>
          ) : forms.length === 0 ? (
            <Text size="sm" c="dimmed">
              No forms yet.
            </Text>
          ) : (
            <Stack gap="xs">
              {forms.map((f) => (
                <Group key={f.id} justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text size="sm" fw={500} truncate>
                        {f.title}
                      </Text>
                      {!f.enabled && (
                        <Badge size="xs" color="gray">
                          off
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed" truncate>
                      {(f.fieldIds ?? []).length} field(s) · /forms/{f.key}
                    </Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <CopyButton value={formUrl(f.key)}>
                      {({ copied, copy }) => (
                        <ActionIcon
                          variant="subtle"
                          color={copied ? "teal" : "gray"}
                          aria-label="Copy public link"
                          onClick={() => {
                            copy();
                            notifications.show({ message: "Form link copied" });
                          }}
                        >
                          {copied ? <IconCheck size={16} /> : <IconLink size={16} />}
                        </ActionIcon>
                      )}
                    </CopyButton>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label="Edit"
                      onClick={() => startEdit(f)}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Delete"
                      onClick={() => remove.mutate(f.id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Modal>
  );
}
