import { createHash } from "node:crypto";

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function fingerprint(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}
