import {
  CollectionToken,
  GroupToken,
  ParameterToken,
  SeparatorToken,
  StringToken,
  Token,
  createQueryState,
} from './tokens';
import { Table, TableDefinition } from './table';

import { Column } from './column';
import { Condition } from './condition';
import { Expression } from './expression';
import { Query } from './query';
import { QueryExecutorFn } from './types';
import { ResultSet } from './result-set';

type ToJoinType<
  JoinType,
  NewJoinType extends 'left-join' | 'left-side-of-right-join' | 'full-join'
> = Extract<JoinType, 'left-side-of-right-join'> extends never ? NewJoinType : JoinType;

// It's important to note that to make sure we infer the table name, we should pass object instead
// of any as the second argument to the table.
type GetTableName<T extends Table<any, any>> = T extends Table<infer A, object> ? A : never;

type AddLeftJoin<Columns, JoinTable> = {
  [K in keyof Columns]: Columns[K] extends Column<
    infer Name,
    infer TableName,
    infer DataType,
    infer IsNotNull,
    infer HasDefault,
    infer JoinType
  >
    ? Extract<GetTableName<JoinTable>, TableName> extends never
      ? Column<Name, TableName, DataType, IsNotNull, HasDefault, JoinType>
      : Column<Name, TableName, DataType, IsNotNull, HasDefault, ToJoinType<JoinType, 'left-join'>>
    : never;
};

type AddRightJoin<Columns, JoinTable> = {
  [K in keyof Columns]: Columns[K] extends Column<
    infer Name,
    infer TableName,
    infer DataType,
    infer IsNotNull,
    infer HasDefault,
    infer JoinType
  >
    ? Extract<GetTableName<JoinTable>, TableName> extends never
      ? Column<
          Name,
          TableName,
          DataType,
          IsNotNull,
          HasDefault,
          ToJoinType<JoinType, 'left-side-of-right-join'>
        >
      : Columns[K]
    : never;
};

type AddFullJoin<Columns> = {
  [K in keyof Columns]: Columns[K] extends Column<
    infer Name,
    infer TableName,
    infer DataType,
    infer IsNotNull,
    infer HasDefault,
    infer JoinType
  >
    ? Column<Name, TableName, DataType, IsNotNull, HasDefault, ToJoinType<JoinType, 'full-join'>>
    : never;
};

type GetSelectableName<S> = S extends Column<infer A2, string, any, boolean, boolean, any>
  ? A2
  : S extends Expression<any, boolean, infer A1>
  ? A1
  : S extends SelectQuery<infer Columns>
  ? keyof Columns // This only works if the query has one select clause
  : never;

type GetSelectable<C extends Selectable> = { [K in GetSelectableName<C>]: C };

// https://www.postgresql.org/docs/12/sql-select.html
export class SelectQuery<Columns extends { [column: string]: any }> extends Query<Columns> {
  private _selectQueryBrand: any;

  /** @internal */
  getReturningKeys() {
    return this.returningKeys;
  }

  constructor(
    private readonly queryExecutor: QueryExecutorFn,
    private readonly returningKeys: string[],
    private readonly tokens: Token[],
  ) {
    super();
  }

  then(
    onFulfilled?:
      | ((value: ResultSet<SelectQuery<Columns>, false>[]) => any | PromiseLike<any>)
      | undefined
      | null,
    onRejected?: ((reason: any) => void | PromiseLike<void>) | undefined | null,
  ) {
    const queryState = createQueryState(this.tokens);

    return this.queryExecutor(queryState.text.join(` `), queryState.parameters)
      .then((result) => (onFulfilled ? onFulfilled(result.rows as any) : result))
      .catch(onRejected);
  }

  private newSelectQuery(tokens: Token[]): SelectQuery<Columns> {
    return new SelectQuery(this.queryExecutor, this.returningKeys, tokens);
  }

  // [ FROM from_item [, ...] ]
  from<T extends Table<any, any>>(
    fromItem: T,
  ): T extends TableDefinition<any> ? never : SelectQuery<Columns> {
    const table = fromItem as Table<any, any>;

    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`FROM`),
      table.getOriginalName()
        ? new StringToken(`${table.getOriginalName()} "${table.getName()}"`)
        : new StringToken(table.getName()),
    ]) as any;
  }

  join(table: Table<any, any>): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`JOIN`),
      new StringToken(table.getName()),
    ]);
  }

  innerJoin(table: Table<any, any>): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`INNER JOIN`),
      new StringToken(table.getName()),
    ]);
  }

  leftOuterJoin<JoinTable extends Table<any, any>>(
    table: JoinTable,
  ): SelectQuery<AddLeftJoin<Columns, JoinTable>> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`LEFT OUTER JOIN`),
      new StringToken((table as Table<any, any>).getName()),
    ]);
  }

  leftJoin<JoinTable extends Table<any, any>>(
    table: JoinTable,
  ): SelectQuery<AddLeftJoin<Columns, JoinTable>> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`INNER JOIN`),
      new StringToken((table as Table<any, any>).getName()),
    ]);
  }

  rightOuterJoin<JoinTable extends Table<any, any>>(
    table: JoinTable,
  ): SelectQuery<AddRightJoin<Columns, JoinTable>> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`RIGHT OUTER JOIN`),
      new StringToken((table as Table<any, any>).getName()),
    ]);
  }

  rightJoin<JoinTable extends Table<any, any>>(
    table: JoinTable,
  ): SelectQuery<AddRightJoin<Columns, JoinTable>> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`RIGHT JOIN`),
      new StringToken((table as Table<any, any>).getName()),
    ]);
  }

  fullOuterJoin<JoinTable extends Table<any, any>>(
    table: JoinTable,
  ): SelectQuery<AddFullJoin<Columns>> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`FULL OUTER JOIN`),
      new StringToken((table as Table<any, any>).getName()),
    ]);
  }
  fullJoin<JoinTable extends Table<any, any>>(table: JoinTable): SelectQuery<AddFullJoin<Columns>> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`FULL JOIN`),
      new StringToken((table as Table<any, any>).getName()),
    ]);
  }

  // This doesn't go with an ON or USING afterwards
  crossJoin(table: Table<any, any>): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`CROSS JOIN`),
      new StringToken((table as Table<any, any>).getName()),
    ]);
  }

  forUpdate(): SelectQuery<Columns> {
    return this.newSelectQuery([...this.tokens, new StringToken(`FOR UPDATE`)]);
  }

  forNoKeyUpdate(): SelectQuery<Columns> {
    return this.newSelectQuery([...this.tokens, new StringToken(`FOR NO KEY UPDATE`)]);
  }

  forShare(): SelectQuery<Columns> {
    return this.newSelectQuery([...this.tokens, new StringToken(`FOR SHARE`)]);
  }

  forKeyShare(): SelectQuery<Columns> {
    return this.newSelectQuery([...this.tokens, new StringToken(`FOR KEY SHARE`)]);
  }

  /** @internal */
  toTokens() {
    return this.tokens;
  }

  on(joinCondition: Condition): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`ON`),
      new GroupToken(joinCondition.toTokens()),
    ]);
  }

  using(...columns: Column<any, any, any, any, any, any>[]): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`USING`),
      new GroupToken([
        new SeparatorToken(
          ',',
          columns.map((column) => new CollectionToken(column.toTokens())),
        ),
      ]),
    ]);
  }

  // [ WHERE condition ]
  where(condition: Condition): SelectQuery<Columns> {
    return this.newSelectQuery([...this.tokens, new StringToken(`WHERE`), ...condition.toTokens()]);
  }

  // [ GROUP BY grouping_element [, ...] ]
  // ( )
  // expression
  // ( expression [, ...] )
  // ROLLUP ( { expression | ( expression [, ...] ) } [, ...] )
  // CUBE ( { expression | ( expression [, ...] ) } [, ...] )
  // GROUPING SETS ( grouping_element [, ...] )
  groupBy(...expressions: Expression<any, any, any>[]): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`GROUP BY`),
      new SeparatorToken(
        ',',
        expressions.map((expression) => new CollectionToken(expression.toTokens())),
      ),
    ]);
  }

  // [ HAVING condition [, ...] ]
  having(...conditions: Condition[]): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`HAVING`),
      new SeparatorToken(
        `,`,
        conditions.map((condition) => new CollectionToken(condition.toTokens())),
      ),
    ]);
  }

  // [ WINDOW window_name AS ( window_definition ) [, ...] ]
  window(): SelectQuery<Columns> {
    return undefined as any;
  }

  // [ { UNION | INTERSECT | EXCEPT } [ ALL | DISTINCT ] select ]
  // [ ORDER BY expression [ ASC | DESC | USING operator ] [ NULLS { FIRST | LAST } ] [, ...] ]
  orderBy(...expressions: Expression<any, any, any>[]): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`ORDER BY`),
      new SeparatorToken(
        ',',
        expressions.map((expression) => new CollectionToken(expression.toTokens())),
      ),
    ]);
  }

  // [ LIMIT { count | ALL } ]
  limit(limit: number | 'ALL'): SelectQuery<Columns> {
    if (limit === `ALL`) {
      return this.newSelectQuery([...this.tokens, new StringToken(`LIMIT ALL`)]);
    } else {
      return this.newSelectQuery([
        ...this.tokens,
        new StringToken(`LIMIT`),
        new ParameterToken(limit),
      ]);
    }
  }

  // [ OFFSET start [ ROW | ROWS ] ]
  offset(start: number): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`OFFSET`),
      new ParameterToken(start),
    ]);
  }

  fetch(count: number): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`FETCH FIRST`),
      new ParameterToken(count),
      new StringToken(`ROWS ONLY`),
    ]);
  }

  of(table: Table<any, any>): SelectQuery<Columns> {
    return this.newSelectQuery([
      ...this.tokens,
      new StringToken(`OF`),
      new StringToken(table.getName()),
    ]);
  }

  nowait(): SelectQuery<Columns> {
    return this.newSelectQuery([...this.tokens, new StringToken(`NOWAIT`)]);
  }

  skipLocked(): SelectQuery<Columns> {
    return this.newSelectQuery([...this.tokens, new StringToken(`SKIP LOCKED`)]);
  }
}

type Selectable =
  | Expression<any, any, any>
  | SelectQuery<any>
  | Column<any, any, any, boolean, boolean, any>;

export interface SelectFn {
  <C1 extends Selectable>(c1: C1): SelectQuery<GetSelectable<C1>>;
  <C1 extends Selectable, C2 extends Selectable>(c1: C1, c2: C2): SelectQuery<
    GetSelectable<C1> & GetSelectable<C2>
  >;
  <C1 extends Selectable, C2 extends Selectable, C3 extends Selectable>(
    c1: C1,
    c2: C2,
    c3: C3,
  ): SelectQuery<GetSelectable<C1> & GetSelectable<C2> & GetSelectable<C3>>;
  <C1 extends Selectable, C2 extends Selectable, C3 extends Selectable, C4 extends Selectable>(
    c1: C1,
    c2: C2,
    c3: C3,
    c4: C4,
  ): SelectQuery<GetSelectable<C1> & GetSelectable<C2> & GetSelectable<C3> & GetSelectable<C4>>;
  <
    C1 extends Selectable,
    C2 extends Selectable,
    C3 extends Selectable,
    C4 extends Selectable,
    C5 extends Selectable
  >(
    c1: C1,
    c2: C2,
    c3: C3,
    c4: C4,
    c5: C5,
  ): SelectQuery<
    GetSelectable<C1> &
      GetSelectable<C2> &
      GetSelectable<C3> &
      GetSelectable<C4> &
      GetSelectable<C5>
  >;
  <
    C1 extends Selectable,
    C2 extends Selectable,
    C3 extends Selectable,
    C4 extends Selectable,
    C5 extends Selectable,
    C6 extends Selectable
  >(
    c1: C1,
    c2: C2,
    c3: C3,
    c4: C4,
    c5: C5,
    c6: C6,
  ): SelectQuery<
    GetSelectable<C1> &
      GetSelectable<C2> &
      GetSelectable<C3> &
      GetSelectable<C4> &
      GetSelectable<C5> &
      GetSelectable<C6>
  >;
  <
    C1 extends Selectable,
    C2 extends Selectable,
    C3 extends Selectable,
    C4 extends Selectable,
    C5 extends Selectable,
    C6 extends Selectable,
    C7 extends Selectable
  >(
    c1: C1,
    c2: C2,
    c3: C3,
    c4: C4,
    c5: C5,
    c6: C6,
    c7: C7,
  ): SelectQuery<
    GetSelectable<C1> &
      GetSelectable<C2> &
      GetSelectable<C3> &
      GetSelectable<C4> &
      GetSelectable<C5> &
      GetSelectable<C6> &
      GetSelectable<C7>
  >;
  <
    C1 extends Selectable,
    C2 extends Selectable,
    C3 extends Selectable,
    C4 extends Selectable,
    C5 extends Selectable,
    C6 extends Selectable,
    C7 extends Selectable,
    C8 extends Selectable
  >(
    c1: C1,
    c2: C2,
    c3: C3,
    c4: C4,
    c5: C5,
    c6: C6,
    c7: C7,
    c8: C8,
  ): SelectQuery<
    GetSelectable<C1> &
      GetSelectable<C2> &
      GetSelectable<C3> &
      GetSelectable<C4> &
      GetSelectable<C5> &
      GetSelectable<C6> &
      GetSelectable<C7> &
      GetSelectable<C8>
  >;
  <
    C1 extends Selectable,
    C2 extends Selectable,
    C3 extends Selectable,
    C4 extends Selectable,
    C5 extends Selectable,
    C6 extends Selectable,
    C7 extends Selectable,
    C8 extends Selectable,
    C9 extends Selectable
  >(
    c1: C1,
    c2: C2,
    c3: C3,
    c4: C4,
    c5: C5,
    c6: C6,
    c7: C7,
    c8: C8,
    c9: C9,
  ): SelectQuery<
    GetSelectable<C1> &
      GetSelectable<C2> &
      GetSelectable<C3> &
      GetSelectable<C4> &
      GetSelectable<C5> &
      GetSelectable<C6> &
      GetSelectable<C7> &
      GetSelectable<C8> &
      GetSelectable<C9>
  >;
  <
    C1 extends Selectable,
    C2 extends Selectable,
    C3 extends Selectable,
    C4 extends Selectable,
    C5 extends Selectable,
    C6 extends Selectable,
    C7 extends Selectable,
    C8 extends Selectable,
    C9 extends Selectable,
    C10 extends Selectable
  >(
    c1: C1,
    c2: C2,
    c3: C3,
    c4: C4,
    c5: C5,
    c6: C6,
    c7: C7,
    c8: C8,
    c9: C9,
    c10: C10,
  ): SelectQuery<
    GetSelectable<C1> &
      GetSelectable<C2> &
      GetSelectable<C3> &
      GetSelectable<C4> &
      GetSelectable<C5> &
      GetSelectable<C6> &
      GetSelectable<C7> &
      GetSelectable<C8> &
      GetSelectable<C9> &
      GetSelectable<C10>
  >;
}

export const makeSelect = (queryExecutor: QueryExecutorFn, initialTokens?: Token[]): SelectFn => <
  T extends Selectable
>(
  ...columns: T[]
) => {
  const returningKeys = columns.map((column) => {
    if (column instanceof Query) {
      return column.getReturningKeys()[0];
    }
    return (column as any).getName();
  });

  return new SelectQuery(queryExecutor, returningKeys, [
    ...(initialTokens || []),
    new StringToken(`SELECT`),
    new SeparatorToken(
      `,`,
      columns.map((column) => {
        const tokens = column.toTokens(true);

        if (column instanceof Query) {
          return new GroupToken(tokens);
        }

        return new CollectionToken(tokens);
      }),
    ),
  ]);
};