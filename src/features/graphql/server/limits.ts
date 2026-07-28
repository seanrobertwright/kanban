import {
  type DocumentNode,
  type FragmentDefinitionNode,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLType,
  type SelectionSetNode,
  GraphQLError,
  Kind,
  getNamedType,
  isListType,
  isNonNullType,
  isObjectType,
} from "graphql";

/**
 * Guard rails for the GraphQL door (2.9). REST hands a caller one row set per
 * request; GraphQL hands them a query language, and the cost of a request stops
 * being bounded by the route. Three static limits, checked after the spec's own
 * validation and before a single resolver runs:
 *
 *  - **Root fields.** The real amplification in *this* schema. `board` and `task`
 *    are one repository round trip each, and aliases let one document ask for
 *    two hundred of them (`{ a: board(id:1){id} b: board(id:2){id} … }`). Depth
 *    limits do nothing about that — the document is two levels deep. Capping
 *    root selections caps database work per request, directly.
 *  - **Cost.** A field costs 1; a list field multiplies its subtree, because the
 *    server pays for the sub-selection once per element and the schema puts no
 *    page size on `columns` or `tasks`. This is what stops one root field from
 *    being expensive on its own.
 *  - **Depth.** Cheap, and the guard that survives the schema growing. Today
 *    nothing here is cyclic so nothing can nest far; the day a `Task.parent` or
 *    a `Column.board` back-edge lands, an unbounded query becomes possible in a
 *    commit that would otherwise look innocent. The limit is already there.
 *
 * All three are *static* — computed from the document, never from the data — so
 * a rejected query costs a parse and nothing else.
 */

/** Repository round trips per request. Each root field is one. */
export const MAX_ROOT_FIELDS = 10;
/** Nesting levels, counted from the operation's own selection set. */
export const MAX_DEPTH = 8;
/** Total static cost. A whole board with every task field scores ~950. */
export const MAX_COST = 2_000;
/** Bytes of query text the ingress will parse at all. */
export const MAX_QUERY_BYTES = 16_000;

/** Assumed elements behind an unpaginated list field — the subtree multiplier. */
const LIST_MULTIPLIER = 10;
/** What a root field costs before its selections: one repository call. */
const ROOT_FIELD_COST = 10;
/** Cycle-safety and a bound on fragment fan-out while costing. */
const MAX_FRAGMENT_DEPTH = 32;

/**
 * The `extensions.code` on every limit rejection. The ingress keys its 400 off
 * this: a limit failure is a bad request (the caller must change the query),
 * where a resolver failure is a 200 with `errors` (the query was fine, the
 * caller just cannot see that field).
 */
export const LIMIT_ERROR_CODE = "QUERY_LIMIT_EXCEEDED";

function limitError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: LIMIT_ERROR_CODE } });
}

/** True if the caller is a limit rejection rather than a resolver error. */
export function isLimitError(errors: readonly GraphQLError[] | undefined): boolean {
  return Boolean(errors?.some((e) => e.extensions?.code === LIMIT_ERROR_CODE));
}

/** Meta fields (`__schema`, `__type`, `__typename`) resolve off the schema in
 *  memory — no repository, no rows — so they are costed flat and not walked. */
function isIntrospection(name: string): boolean {
  return name.startsWith("__");
}

/** Whether any wrapper on the field's type is a list (`[Task!]!` counts). */
function wrapsList(type: GraphQLType): boolean {
  if (isNonNullType(type)) return wrapsList(type.ofType);
  return isListType(type);
}

type Fragments = Record<string, FragmentDefinitionNode>;

function collectFragments(document: DocumentNode): Fragments {
  const fragments: Fragments = {};
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments[def.name.value] = def;
  }
  return fragments;
}

/** Depth of a selection set, following fragments. Introspection selections are
 *  not walked: a tooling introspection query is legitimately ~11 levels deep and
 *  costs the database nothing, so measuring it would only break GraphiQL. */
function depthOf(
  selectionSet: SelectionSetNode,
  fragments: Fragments,
  seen: ReadonlySet<string> = new Set()
): number {
  let deepest = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (isIntrospection(selection.name.value)) continue;
      const child = selection.selectionSet
        ? depthOf(selection.selectionSet, fragments, seen)
        : 0;
      deepest = Math.max(deepest, 1 + child);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      deepest = Math.max(deepest, depthOf(selection.selectionSet, fragments, seen));
    } else {
      const name = selection.name.value;
      const fragment = fragments[name];
      // A cyclic spread is already a validation error; guard anyway so the
      // limit checker can never be the thing that hangs.
      if (!fragment || seen.has(name)) continue;
      deepest = Math.max(
        deepest,
        depthOf(fragment.selectionSet, fragments, new Set([...seen, name]))
      );
    }
  }
  return deepest;
}

/** Static cost of a selection set against the type it is selecting from. */
function costOf(
  selectionSet: SelectionSetNode,
  parentType: GraphQLObjectType,
  schema: GraphQLSchema,
  fragments: Fragments,
  isRoot: boolean,
  seen: ReadonlySet<string>
): number {
  if (seen.size > MAX_FRAGMENT_DEPTH) return MAX_COST + 1;
  const fields = parentType.getFields();
  let total = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const name = selection.name.value;
      if (isIntrospection(name)) {
        total += 1;
        continue;
      }
      const field = fields[name];
      // Unknown field: already a validation error, cost it as a leaf.
      if (!field) {
        total += 1;
        continue;
      }
      const named = getNamedType(field.type);
      const child =
        selection.selectionSet && isObjectType(named)
          ? costOf(selection.selectionSet, named, schema, fragments, false, seen)
          : 0;
      total +=
        (isRoot ? ROOT_FIELD_COST : 1) +
        (wrapsList(field.type) ? LIST_MULTIPLIER : 1) * child;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const condition = selection.typeCondition?.name.value;
      const type = condition ? schema.getType(condition) : parentType;
      if (!isObjectType(type)) continue;
      total += costOf(selection.selectionSet, type, schema, fragments, isRoot, seen);
    } else {
      const name = selection.name.value;
      const fragment = fragments[name];
      if (!fragment || seen.has(name)) continue;
      const type = schema.getType(fragment.typeCondition.name.value);
      if (!isObjectType(type)) continue;
      total += costOf(
        fragment.selectionSet,
        type,
        schema,
        fragments,
        isRoot,
        new Set([...seen, name])
      );
    }
  }
  return total;
}

/** Root selections that will each cost a repository call (introspection excluded). */
function countRootFields(
  selectionSet: SelectionSetNode,
  fragments: Fragments,
  seen: ReadonlySet<string> = new Set()
): number {
  let count = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (!isIntrospection(selection.name.value)) count += 1;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      count += countRootFields(selection.selectionSet, fragments, seen);
    } else {
      const name = selection.name.value;
      const fragment = fragments[name];
      if (!fragment || seen.has(name)) continue;
      count += countRootFields(fragment.selectionSet, fragments, new Set([...seen, name]));
    }
  }
  return count;
}

/** Static cost of a single operation — exported so tests and callers can assert
 *  on the number rather than only on whether it tripped a limit. */
export function estimateCost(schema: GraphQLSchema, document: DocumentNode): number {
  const fragments = collectFragments(document);
  let worst = 0;
  for (const def of document.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;
    const rootType =
      def.operation === "query" ? schema.getQueryType() : schema.getMutationType();
    if (!rootType) continue;
    worst = Math.max(
      worst,
      costOf(def.selectionSet, rootType, schema, fragments, true, new Set())
    );
  }
  return worst;
}

/**
 * Checks every operation in the document against all three limits. Returns the
 * errors to hand back, or an empty array to proceed. Every operation is checked,
 * not only the one named: a document is parsed and kept whole, and the cheapest
 * way to be wrong here is to check the operation the caller *said* they wanted.
 */
export function checkQueryLimits(
  schema: GraphQLSchema,
  document: DocumentNode
): GraphQLError[] {
  const fragments = collectFragments(document);
  const errors: GraphQLError[] = [];

  for (const def of document.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;

    const roots = countRootFields(def.selectionSet, fragments);
    if (roots > MAX_ROOT_FIELDS) {
      errors.push(
        limitError(
          `Query selects ${roots} root fields, over the limit of ${MAX_ROOT_FIELDS}. Split it into separate requests.`
        )
      );
    }

    const depth = depthOf(def.selectionSet, fragments);
    if (depth > MAX_DEPTH) {
      errors.push(
        limitError(`Query is ${depth} levels deep, over the limit of ${MAX_DEPTH}.`)
      );
    }
  }

  const cost = estimateCost(schema, document);
  if (cost > MAX_COST) {
    errors.push(
      limitError(
        `Query cost ${cost} is over the limit of ${MAX_COST}. Ask for fewer fields, or fewer list selections.`
      )
    );
  }

  return errors;
}
