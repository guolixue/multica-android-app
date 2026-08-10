#!/usr/bin/env node
/**
 * Copy the just-built release APK to a versioned filename.
 *
 * Gradle always emits `android/app/build/outputs/apk/release/app-release.apk`,
 * which doesn't carry the version. This script copies it to
 * `apps/mobile/dist/multica-app-v<version>.apk` (e.g. `multica-app-v0.2.3.apk`)
 * so every build is identifiable at a glance and can't be confused with an
 * older artifact.
 *
 * Version is read from apps/mobile/package.json, which the version-bump
 * script has just advanced before the gradle build ran (see the
 * build:android:apk script chain). Must run AFTER the gradle build.
 */
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(scriptDir, ".."); // apps/mobile
const distDir = join(mobileRoot, "dist");

const mobilePkg = JSON.parse(readFileSync(join(mobileRoot, "package.json"), "utf8"));
const version = mobilePkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`[copy-versioned-apk] cannot parse version "${version}"`);
  process.exit(1);
}

const builtApk = join(
  mobileRoot,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "release",
  "app-release.apk",
);
const dest = join(distDir, `multica-app-v${version}.apk`);

if (!existsSync(builtApk)) {
  console.error(
    `[copy-versioned-apk] built APK not found: ${builtApk}\n` +
      "Run the gradle build first (build:android:apk runs bump → build → copy).",
  );
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
copyFileSync(builtApk, dest);
console.log(`[copy-versioned-apk] ${dest}`);
