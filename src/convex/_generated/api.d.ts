/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as adminConfig from "../adminConfig.js";
import type * as appBackup from "../appBackup.js";
import type * as appThemes from "../appThemes.js";
import type * as auth from "../auth.js";
import type * as auth_deviceAuth from "../auth/deviceAuth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as authActions from "../authActions.js";
import type * as bulk from "../bulk.js";
import type * as catalog from "../catalog.js";
import type * as clubLists from "../clubLists.js";
import type * as crons from "../crons.js";
import type * as deviceTokenStore from "../deviceTokenStore.js";
import type * as deviceTokens from "../deviceTokens.js";
import type * as diagnostic from "../diagnostic.js";
import type * as emails from "../emails.js";
import type * as exportData from "../exportData.js";
import type * as head from "../head.js";
import type * as http from "../http.js";
import type * as importer from "../importer.js";
import type * as labels from "../labels.js";
import type * as lib from "../lib.js";
import type * as lookup from "../lookup.js";
import type * as notifications from "../notifications.js";
import type * as notify from "../notify.js";
import type * as parts from "../parts.js";
import type * as printing from "../printing.js";
import type * as projectReadme from "../projectReadme.js";
import type * as projectWorkspace from "../projectWorkspace.js";
import type * as projects from "../projects.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as rentCardRelay from "../rentCardRelay.js";
import type * as rentCardTelegram from "../rentCardTelegram.js";
import type * as reports from "../reports.js";
import type * as resetDb from "../resetDb.js";
import type * as resetDbStore from "../resetDbStore.js";
import type * as settings from "../settings.js";
import type * as stats from "../stats.js";
import type * as sync from "../sync.js";
import type * as telegram from "../telegram.js";
import type * as telegramTopics from "../telegramTopics.js";
import type * as turso from "../turso.js";
import type * as tursoCatalog from "../tursoCatalog.js";
import type * as tursoClient from "../tursoClient.js";
import type * as tursoDb from "../tursoDb.js";
import type * as tursoHealth from "../tursoHealth.js";
import type * as tursoMigrate from "../tursoMigrate.js";
import type * as tursoMigrateSource from "../tursoMigrateSource.js";
import type * as tursoMirror from "../tursoMirror.js";
import type * as tursoRepo from "../tursoRepo.js";
import type * as userLookup from "../userLookup.js";
import type * as users from "../users.js";
import type * as whatsapp from "../whatsapp.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  adminConfig: typeof adminConfig;
  appBackup: typeof appBackup;
  appThemes: typeof appThemes;
  auth: typeof auth;
  "auth/deviceAuth": typeof auth_deviceAuth;
  "auth/emailOtp": typeof auth_emailOtp;
  authActions: typeof authActions;
  bulk: typeof bulk;
  catalog: typeof catalog;
  clubLists: typeof clubLists;
  crons: typeof crons;
  deviceTokenStore: typeof deviceTokenStore;
  deviceTokens: typeof deviceTokens;
  diagnostic: typeof diagnostic;
  emails: typeof emails;
  exportData: typeof exportData;
  head: typeof head;
  http: typeof http;
  importer: typeof importer;
  labels: typeof labels;
  lib: typeof lib;
  lookup: typeof lookup;
  notifications: typeof notifications;
  notify: typeof notify;
  parts: typeof parts;
  printing: typeof printing;
  projectReadme: typeof projectReadme;
  projectWorkspace: typeof projectWorkspace;
  projects: typeof projects;
  push: typeof push;
  pushSend: typeof pushSend;
  rentCardRelay: typeof rentCardRelay;
  rentCardTelegram: typeof rentCardTelegram;
  reports: typeof reports;
  resetDb: typeof resetDb;
  resetDbStore: typeof resetDbStore;
  settings: typeof settings;
  stats: typeof stats;
  sync: typeof sync;
  telegram: typeof telegram;
  telegramTopics: typeof telegramTopics;
  turso: typeof turso;
  tursoCatalog: typeof tursoCatalog;
  tursoClient: typeof tursoClient;
  tursoDb: typeof tursoDb;
  tursoHealth: typeof tursoHealth;
  tursoMigrate: typeof tursoMigrate;
  tursoMigrateSource: typeof tursoMigrateSource;
  tursoMirror: typeof tursoMirror;
  tursoRepo: typeof tursoRepo;
  userLookup: typeof userLookup;
  users: typeof users;
  whatsapp: typeof whatsapp;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
