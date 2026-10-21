/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as ingest from "../ingest.js";
import type * as inspect from "../inspect.js";
import type * as jobs from "../jobs.js";
import type * as lib_fivePct from "../lib/fivePct.js";
import type * as lib_indices from "../lib/indices.js";
import type * as lib_issuers from "../lib/issuers.js";
import type * as lib_onePct from "../lib/onePct.js";
import type * as lib_ownershipList from "../lib/ownershipList.js";
import type * as lib_prices from "../lib/prices.js";
import type * as lib_rows from "../lib/rows.js";
import type * as lib_xlsx from "../lib/xlsx.js";
import type * as ui from "../ui.js";
import type * as writes from "../writes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  ingest: typeof ingest;
  inspect: typeof inspect;
  jobs: typeof jobs;
  "lib/fivePct": typeof lib_fivePct;
  "lib/indices": typeof lib_indices;
  "lib/issuers": typeof lib_issuers;
  "lib/onePct": typeof lib_onePct;
  "lib/ownershipList": typeof lib_ownershipList;
  "lib/prices": typeof lib_prices;
  "lib/rows": typeof lib_rows;
  "lib/xlsx": typeof lib_xlsx;
  ui: typeof ui;
  writes: typeof writes;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
