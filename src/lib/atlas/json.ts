import type { JsonObject, JsonValue } from "@/lib/atlas/types";

export function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringArrayFromJson(value: JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function stringFromJson(value: JsonValue): string | null {
  return typeof value === "string" ? value : null;
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(text) as JsonValue;
  if (!isJsonObject(parsed)) {
    throw new Error("Expected a JSON object request body.");
  }

  return parsed;
}
