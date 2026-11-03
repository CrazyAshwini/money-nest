export const input = (
  name: string,
  value: string | number | null | undefined,
  type = "text",
  required = false,
) => (
  <input
    name={name}
    type={type}
    defaultValue={value ?? ""}
    required={required}
    step={type === "number" ? "0.01" : undefined}
    min={type === "number" ? "0" : undefined}
  />
);
