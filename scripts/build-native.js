const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") {
  console.log("Skipping macOS Swift helpers on this platform.");
  process.exit(0);
}

const archFlag = process.argv.indexOf("--arch");
const arch = archFlag === -1 ? process.env.TARGET_ARCH || process.arch : process.argv[archFlag + 1];
const tripleArch = { arm64: "arm64", x64: "x86_64" }[arch];
if (!tripleArch) throw new Error(`Unsupported native helper architecture: ${arch}`);

const resources = path.resolve(__dirname, "../resources");
const outputDir = path.join(resources, "bin");
fs.mkdirSync(outputDir, { recursive: true });

const sdkLookup = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
if (sdkLookup.error) throw sdkLookup.error;
if (sdkLookup.status !== 0) throw new Error(sdkLookup.stderr.trim() || "macOS SDK not found.");
const discoveredSdk = sdkLookup.stdout.trim();
const toolchainSdk = path.join(path.dirname(discoveredSdk), "MacOSX.sdk");
// The generic SDK symlink selects the installed toolchain's SDK when newer SDKs also exist.
const sdk = process.env.SDKROOT || (fs.existsSync(toolchainSdk) ? toolchainSdk : discoveredSdk);

// Compile only the two CoreAudio helpers used by the app.
for (const [name, minimumOS, frameworks] of [
  ["macos-audio-tap", "14.2", ["CoreAudio", "AudioToolbox", "AVFoundation", "Foundation"]],
  ["macos-mic-listener", "11.0", ["CoreAudio", "Foundation"]],
]) {
  const source = path.join(resources, `${name}.swift`);
  const binary = path.join(outputDir, name);
  const previous = fs.statSync(binary, { throwIfNoEntry: false });
  const updatedAt = Math.max(fs.statSync(source).mtimeMs, fs.statSync(__filename).mtimeMs);
  if (previous?.mtimeMs >= updatedAt && !process.env.SDKROOT &&
      spawnSync("xcrun", ["lipo", binary, "-verify_arch", tripleArch]).status === 0) {
    continue;
  }
  const scratch = `${binary}.${process.pid}.tmp`;
  try {
    const compile = spawnSync("xcrun", [
      "swiftc", "-O", "-sdk", sdk, "-target", `${tripleArch}-apple-macosx${minimumOS}`,
      source, "-o", scratch, ...frameworks.flatMap((framework) => ["-framework", framework]),
    ], { stdio: "inherit" });
    if (compile.error) throw compile.error;
    if (compile.status !== 0) throw new Error(`Swift compilation failed for ${name}`);
    fs.renameSync(scratch, binary);
    console.log(`Built ${name} (${arch}).`);
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}
