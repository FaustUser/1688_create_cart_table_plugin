const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("../background.js"), "utf8");
const offscreenSource = fs.readFileSync(require.resolve("../offscreen.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(require.resolve("../manifest.json"), "utf8"));

test("background exposes tracking job lifecycle messages", () => {
  assert.match(source, /WB_1688_TRACKING_START/);
  assert.match(source, /WB_1688_TRACKING_GET/);
  assert.match(source, /WB_1688_TRACKING_CANCEL/);
  assert.match(source, /WB_1688_TRACKING_STATE/);
});

test("background persists state and manages one hidden tab", () => {
  assert.match(source, /chrome\.storage\.local/);
  assert.match(source, /chrome\.tabs\.create\(\{[^}]*active:\s*false/);
  assert.match(source, /chrome\.tabs\.remove/);
  assert.match(source, /WB_1688_COLLECT_TRACKING/);
  assert.match(source, /response\?\.shipments/);
  assert.match(source, /shipmentDataByOrder/);
  assert.match(source, /products:\s*state\.productsByOrder/);
});

test("manifest grants background job permissions and scripts", () => {
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.background.service_worker);
  assert.ok(manifest.content_scripts[0].js.includes("tracking-parser.js"));
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.match(source, /chrome\.offscreen\.createDocument/);
});

test("offscreen creates Blob URL while background owns downloads API", () => {
  assert.doesNotMatch(offscreenSource, /chrome\.downloads\.download/);
  assert.match(offscreenSource, /WB_1688_CREATE_DOWNLOAD_URL/);
  assert.match(source, /chrome\.downloads\.download\(\{\s*url:\s*response\.url/);
  assert.match(offscreenSource, /URL\.revokeObjectURL/);
});
