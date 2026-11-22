// SQL statements as tagged templates (docs/adr/0014): every interpolated value becomes a parameter (@p0, @p1, …),
// never text, and statements nest, so one is put together from parts without building strings by hand.
//
//   sql`SELECT c.ID AS clubId FROM dbo.Club c WHERE c.ID = ${clubId}`
//   sql`… WHERE p.ID IN (${sql.list(playerIds)})`
//   sql`UPDATE dbo.Club SET ${sql.join(assignments)} WHERE ID = ${clubId}`
//
// A value's SQL type follows from its JavaScript type (see inferType); a column that needs another one gets a typed
// value (`t.dateTime2(at, 0)`, `t.nvarchar(name, 50)`, …), which keeps the parameter exactly the column's type.

import mssql from "mssql";

/** What mssql accepts as a parameter type: a type (`mssql.Int`) or a sized one (`mssql.NVarChar(50)`). */
export type SqlType = mssql.ISqlTypeFactoryWithNoParams | mssql.ISqlType;

/** A value with the SQL type it is sent as. */
export class TypedValue {
  readonly value: unknown;
  readonly type: SqlType;

  constructor(value: unknown, type: SqlType) {
    this.value = value;
    this.type = type;
  }
}

export type SqlValue = Statement | TypedValue | string | number | bigint | boolean | Date | Buffer | null;

/** A statement or a part of one: its text pieces and the values between them. */
export class Statement {
  readonly strings: readonly string[];
  readonly values: readonly SqlValue[];

  constructor(strings: readonly string[], values: readonly SqlValue[]) {
    this.strings = strings;
    this.values = values;
  }
}

export interface Parameter {
  readonly name: string;
  readonly type: SqlType;
  readonly value: unknown;
}

export interface RenderedStatement {
  readonly text: string;
  readonly parameters: readonly Parameter[];
}

const MAX_INT = 2_147_483_647;
const MAX_NVARCHAR = 4000;

/**
 * The SQL type of a plain value. Strings are NVARCHAR(4000) (NVARCHAR(MAX) beyond), so a statement keeps one plan
 * whatever the length of its text values; whole numbers are INT (BIGINT beyond), other numbers FLOAT.
 */
export function inferType(value: Exclude<SqlValue, Statement | TypedValue>): SqlType {
  if (value === null) return mssql.NVarChar(MAX_NVARCHAR);
  if (typeof value === "string")
    return value.length > MAX_NVARCHAR ? mssql.NVarChar(mssql.MAX) : mssql.NVarChar(MAX_NVARCHAR);
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return mssql.Float;
    return Math.abs(value) > MAX_INT ? mssql.BigInt : mssql.Int;
  }
  if (typeof value === "bigint") return mssql.BigInt;
  if (typeof value === "boolean") return mssql.Bit;
  if (value instanceof Date) return mssql.DateTime2;
  return mssql.VarBinary(mssql.MAX);
}

function renderInto(statement: Statement, parameters: Parameter[]): string {
  let text = statement.strings[0] ?? "";
  statement.values.forEach((value, index) => {
    if (value instanceof Statement) {
      text += renderInto(value, parameters);
    } else {
      const name = `p${String(parameters.length)}`;
      parameters.push(
        value instanceof TypedValue
          ? { name, type: value.type, value: value.value }
          : { name, type: inferType(value), value },
      );
      text += `@${name}`;
    }
    text += statement.strings[index + 1] ?? "";
  });
  return text;
}

/** The statement's text with its parameters numbered in order. */
export function render(statement: Statement): RenderedStatement {
  const parameters: Parameter[] = [];
  const text = renderInto(statement, parameters);
  return { text, parameters };
}

interface SqlTag {
  (strings: TemplateStringsArray, ...values: SqlValue[]): Statement;
  /** Text that is part of the statement itself: only constants of the code, never a value from outside. */
  raw(text: string): Statement;
  /** The parts with `separator` between them, e.g. a SET list or the columns of a SELECT. */
  join(parts: readonly Statement[], separator?: string): Statement;
  /** The values as a list of parameters (`IN (…)`); an empty list is a mistake of the caller and throws. */
  list(values: readonly SqlValue[]): Statement;
}

export const sql: SqlTag = Object.assign(
  (strings: TemplateStringsArray, ...values: SqlValue[]): Statement => new Statement([...strings], values),
  {
    raw: (text: string): Statement => new Statement([text], []),
    join: (parts: readonly Statement[], separator = ", "): Statement =>
      new Statement(parts.length ? ["", ...parts.slice(1).map(() => separator), ""] : [""], parts),
    list: (values: readonly SqlValue[]): Statement => {
      if (!values.length) throw new Error("sql.list needs at least one value.");
      return new Statement(["", ...values.slice(1).map(() => ", "), ""], values);
    },
  },
);

/** Typed values, for columns whose type differs from what a plain value would be sent as. */
export const t = {
  int: (value: number | null): TypedValue => new TypedValue(value, mssql.Int),
  bigInt: (value: number | bigint | string | null): TypedValue => new TypedValue(value, mssql.BigInt),
  bit: (value: boolean | null): TypedValue => new TypedValue(value, mssql.Bit),
  float: (value: number | null): TypedValue => new TypedValue(value, mssql.Float),
  decimal: (value: number | null, precision: number, scale: number): TypedValue =>
    new TypedValue(value, mssql.Decimal(precision, scale)),
  nvarchar: (value: string | null, length: number): TypedValue => new TypedValue(value, mssql.NVarChar(length)),
  nvarcharMax: (value: string | null): TypedValue => new TypedValue(value, mssql.NVarChar(mssql.MAX)),
  varchar: (value: string | null, length: number): TypedValue => new TypedValue(value, mssql.VarChar(length)),
  char: (value: string | null, length: number): TypedValue => new TypedValue(value, mssql.Char(length)),
  dateTime2: (value: Date | number | null, scale = 7): TypedValue =>
    new TypedValue(typeof value === "number" ? new Date(value) : value, mssql.DateTime2(scale)),
  dateTime: (value: Date | number | null): TypedValue =>
    new TypedValue(typeof value === "number" ? new Date(value) : value, mssql.DateTime),
  varBinary: (value: Buffer | null): TypedValue => new TypedValue(value, mssql.VarBinary(mssql.MAX)),
};
