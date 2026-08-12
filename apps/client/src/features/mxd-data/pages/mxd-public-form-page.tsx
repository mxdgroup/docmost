import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Center,
  Checkbox,
  Container,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  MxdPublicFormField,
  mxdGetPublicForm,
  mxdSubmitForm,
} from "@/features/mxd-data/mxd-data.api";

// Public, anonymous form page (/forms/:key). Renders inputs for the form's
// whitelisted fields and submits to the public endpoint, which validates and
// creates a record. No app shell, no auth.
export default function MxdPublicFormPage() {
  const { key = "" } = useParams();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const formQuery = useQuery({
    queryKey: ["mxd-public-form", key],
    queryFn: () => mxdGetPublicForm(key),
    enabled: !!key,
    retry: false,
  });

  const set = (id: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [id]: v }));

  const submit = async () => {
    if (!formQuery.data) return;
    setSubmitting(true);
    try {
      // Drop empty values so optional fields aren't sent as "".
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v === "" || v == null) continue;
        payload[k] = v;
      }
      await mxdSubmitForm(key, payload);
      setSubmitted(true);
    } catch (err: any) {
      notifications.show({
        color: "red",
        message: err?.response?.data?.message ?? "Could not submit the form",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (formQuery.isLoading) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }
  if (formQuery.isError || !formQuery.data) {
    return (
      <Container size="xs" py="xl">
        <Alert color="gray" variant="light">
          This form isn’t available.
        </Alert>
      </Container>
    );
  }

  const form = formQuery.data;

  if (submitted) {
    return (
      <Container size="xs" py="xl">
        <Paper withBorder p="xl" radius="md">
          <Stack align="center">
            <Title order={4}>{form.title}</Title>
            <Text ta="center">{form.submitMessage || "Thanks — your response was recorded."}</Text>
            <Button variant="light" onClick={() => { setValues({}); setSubmitted(false); }}>
              Submit another response
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size="xs" py="xl">
      <Paper withBorder p="xl" radius="md">
        <Stack>
          <Title order={3}>{form.title}</Title>
          {form.description && <Text c="dimmed">{form.description}</Text>}
          {form.fields.map((f) => (
            <FormFieldInput
              key={f.id}
              field={f}
              value={values[f.id]}
              onChange={(v) => set(f.id, v)}
            />
          ))}
          <Button onClick={submit} loading={submitting} mt="sm">
            Submit
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}

function FormFieldInput({
  field,
  value,
  onChange,
}: {
  field: MxdPublicFormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = field.name;
  switch (field.type) {
    case "long_text":
      return (
        <Textarea
          label={label}
          autosize
          minRows={2}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
    case "number":
    case "currency":
    case "percent":
      return (
        <TextInput
          label={label}
          type="number"
          value={value == null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            onChange(raw === "" ? "" : Number(raw));
          }}
        />
      );
    case "checkbox":
      return (
        <Checkbox
          label={label}
          checked={!!value}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case "date":
    case "datetime": {
      const isDate = field.type === "date";
      return (
        <TextInput
          label={label}
          type={isDate ? "date" : "datetime-local"}
          value={(value as string) ?? ""}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            if (!raw) return onChange("");
            onChange(isDate ? raw : new Date(raw).toISOString());
          }}
        />
      );
    }
    case "select":
      return (
        <Select
          label={label}
          searchable
          clearable
          value={(value as string) ?? null}
          data={(field.choices ?? []).map((c) => ({ value: c.id, label: c.label }))}
          onChange={(v) => onChange(v)}
          comboboxProps={{ withinPortal: true }}
        />
      );
    default:
      return (
        <TextInput
          label={label}
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
  }
}
