// Regression for the D3 proxy-path defect.
//
// D3's launcher resolved the proxy as `<research-root>/tooling/…` and only worked
// when the process happened to run from a directory where that guess landed on
// the tracked file. The tracked proxy is `synthetic/tooling/openrouter-bounded-proxy.mjs`.
// These tests pin the correction: one canonical, module-relative location, no
// working-directory dependence, no URL-encoding breakage, no environment override
// and no fallback.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FAMILY_ROOT, RESEARCH_ROOT, resolveProxyPath, proxyPath } from "../lib/paths.mjs";

const PATHS_MODULE = path.join(FAMILY_ROOT, "lib", "paths.mjs");
const TRACKED_PROXY = path.join(RESEARCH_ROOT, "synthetic", "tooling", "openrouter-bounded-proxy.mjs");

test("the proxy resolves to the tracked file beneath synthetic/tooling", () => {
  const resolved = resolveProxyPath();
  assert.equal(resolved, fs.realpathSync(TRACKED_PROXY));
  assert.equal(path.basename(path.dirname(resolved)), "tooling");
  assert.equal(path.basename(path.dirname(path.dirname(resolved))), "synthetic");
  assert.ok(fs.existsSync(resolved));
  assert.equal(proxyPath(), resolved, "the memoized path is the same path");
});

test("resolution is independent of the working directory", () => {
  const run = (cwd) => {
    const script = `import { proxyPath } from ${JSON.stringify(pathToFileURL(PATHS_MODULE).href)}; process.stdout.write(proxyPath());`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd, encoding: "utf8" });
    return out.trim();
  };
  const expected = fs.realpathSync(TRACKED_PROXY);
  for (const cwd of [os.tmpdir(), RESEARCH_ROOT, FAMILY_ROOT, path.parse(RESEARCH_ROOT).root]) {
    assert.equal(run(cwd), expected, `resolution changed in ${cwd}`);
  }
});

test("a module URL containing spaces and encoded characters still resolves", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "next-family path-"));
  const synthetic = path.join(root, "synthetic");
  fs.mkdirSync(path.join(synthetic, "tooling"), { recursive: true });
  fs.mkdirSync(path.join(synthetic, "next-family", "lib"), { recursive: true });
  fs.copyFileSync(TRACKED_PROXY, path.join(synthetic, "tooling", "openrouter-bounded-proxy.mjs"));
  fs.copyFileSync(PATHS_MODULE, path.join(synthetic, "next-family", "lib", "paths.mjs"));

  const moduleUrl = pathToFileURL(path.join(synthetic, "next-family", "lib", "paths.mjs")).href;
  assert.ok(moduleUrl.includes("%20"), "the fixture URL must actually contain an escaped character");
  const script = `import { proxyPath } from ${JSON.stringify(moduleUrl)}; process.stdout.write(proxyPath());`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim();
  assert.equal(out, fs.realpathSync(path.join(synthetic, "tooling", "openrouter-bounded-proxy.mjs")));
  assert.ok(!out.includes("%20"), "the resolved path must be a decoded filesystem path");
});

test("a repository-root tooling/ directory is not accepted as the proxy", () => {
  // The exact D3 mistake: a proxy-shaped file at <root>/tooling/, with the module
  // still at <root>/synthetic/next-family/lib/. There must be no fallback.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "next-family-root-tooling-"));
  fs.mkdirSync(path.join(root, "tooling"), { recursive: true });
  fs.mkdirSync(path.join(root, "synthetic", "next-family", "lib"), { recursive: true });
  fs.copyFileSync(TRACKED_PROXY, path.join(root, "tooling", "openrouter-bounded-proxy.mjs"));
  fs.copyFileSync(PATHS_MODULE, path.join(root, "synthetic", "next-family", "lib", "paths.mjs"));

  const moduleUrl = pathToFileURL(path.join(root, "synthetic", "next-family", "lib", "paths.mjs")).href;
  const script = `import { proxyPath } from ${JSON.stringify(moduleUrl)}; try { process.stdout.write(proxyPath()); } catch (error) { process.stdout.write('THREW ' + error.message); }`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim();
  assert.match(out, /^THREW the bounded proxy is missing at its canonical module-relative location/);
  assert.match(out, /synthetic[\\/\\\\]tooling/, "the error names the canonical location");
});

test("there is no environment override and no second proxy location", () => {
  const fake = path.join(os.tmpdir(), `not-the-proxy-${process.pid}.mjs`);
  fs.writeFileSync(fake, "// decoy\n");
  const script = `import { proxyPath } from ${JSON.stringify(pathToFileURL(PATHS_MODULE).href)}; process.stdout.write(proxyPath());`;
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, PROXY: fake, OPENROUTER_PROXY: fake, BOUNDED_PROXY: fake, PROXY_PATH: fake },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), fs.realpathSync(TRACKED_PROXY));
});

test("the launcher and the tooling sell-test both point at one file", () => {
  const launcher = fs.readFileSync(path.join(FAMILY_ROOT, "criteria-next.mjs"), "utf8");
  assert.ok(launcher.includes('proxyPath()'), "the launcher must use the resolver");
  assert.ok(!/path\.join\(SYN,\s*"tooling"/.test(launcher), "no repository-root tooling/ construction");
  assert.ok(!/process\.cwd\(\)/.test(launcher), "no working-directory assumption in the launcher");
  const audit = fs.readFileSync(path.join(RESEARCH_ROOT, "synthetic", "tooling", "proxy-audit.test.mjs"), "utf8");
  assert.ok(audit.includes("./openrouter-bounded-proxy.mjs"), "the audit resolves its sibling");
});

test("the resolved file is the proxy implementation, not a copy", () => {
  const text = fs.readFileSync(proxyPath(), "utf8");
  assert.ok(text.includes("proxy_input_ceiling_exceeded"));
  assert.ok(text.includes("proxy_observed_model_mismatch"));
  assert.equal(fileURLToPath(pathToFileURL(proxyPath())), proxyPath());
});
