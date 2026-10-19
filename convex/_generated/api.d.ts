/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as boards from "../boards.js";
import type * as goals from "../goals.js";
import type * as labels from "../labels.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_board from "../lib/board.js";
import type * as lib_burndown from "../lib/burndown.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_goalSprints from "../lib/goalSprints.js";
import type * as lib_labelPresets from "../lib/labelPresets.js";
import type * as lib_password from "../lib/password.js";
import type * as progress from "../progress.js";
import type * as projects from "../projects.js";
import type * as templates from "../templates.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  attachments: typeof attachments;
  auth: typeof auth;
  boards: typeof boards;
  goals: typeof goals;
  labels: typeof labels;
  "lib/activity": typeof lib_activity;
  "lib/auth": typeof lib_auth;
  "lib/board": typeof lib_board;
  "lib/burndown": typeof lib_burndown;
  "lib/constants": typeof lib_constants;
  "lib/goalSprints": typeof lib_goalSprints;
  "lib/labelPresets": typeof lib_labelPresets;
  "lib/password": typeof lib_password;
  progress: typeof progress;
  projects: typeof projects;
  templates: typeof templates;
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
