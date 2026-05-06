declare module "node:sqlite" {
  export type SqlValue = string | number | bigint | Uint8Array | null;
  export type SqlParam = SqlValue | boolean;

  export class StatementSync {
    run(...params: SqlParam[]): { changes: number; lastInsertRowid: number | bigint };
    get<T extends Record<string, SqlValue> = Record<string, SqlValue>>(
      ...params: SqlParam[]
    ): T | undefined;
    all<T extends Record<string, SqlValue> = Record<string, SqlValue>>(
      ...params: SqlParam[]
    ): T[];
  }

  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
