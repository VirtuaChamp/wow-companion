function escapeLuaString(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i] as string;
    const code = value.charCodeAt(i);
    if (ch === "\\") {
      out += "\\\\";
    } else if (ch === '"') {
      out += '\\"';
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (code < 0x20) {
      out += `\\${String(code).padStart(3, "0")}`;
    } else {
      out += ch;
    }
  }
  return `"${out}"`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeLuaValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "nil";
  }
  if (typeof value === "string") {
    return escapeLuaString(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("encodeLuaValue: number must be finite");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => encodeLuaValue(item));
    return `{${items.join(",")}}`;
  }
  if (isPlainObject(value)) {
    const parts = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => `[${escapeLuaString(key)}]=${encodeLuaValue(v)}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error(`encodeLuaValue: unsupported value type ${typeof value}`);
}
