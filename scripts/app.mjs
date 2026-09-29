import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = 3000;
const URL = `http://localhost:${PORT}`;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args) {
  return new Promise((res, rej) => {
    const p = spawn(npm, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    p.on("exit", (c) =>
      c === 0 ? res() : rej(new Error(`${args.join(" ")} exited ${c}`)),
    );
  });
}
const ping = () =>
  new Promise((res) =>
    http
      .get(URL, (r) => res(r.statusCode === 200 || r.statusCode === 307))
      .on("error", () => res(false)),
  );

function openBrowser() {
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
        ]
      : [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
        ];
  const exe = candidates.find((c) => fs.existsSync(c));
  if (!exe) {
    console.log(`Open ${URL} in your browser.`);
    return;
  }
  spawn(exe, [`--app=${URL}`, "--window-size=1400,900"], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

const WATCHED = ["src", "package.json", "next.config.ts"];

/** Newest mtime under the given files/directories, 0 if none exist. */
function newestMtime(targets) {
  let newest = 0;
  const visit = (target) => {
    let st;
    try {
      st = fs.statSync(target);
    } catch {
      return; // deleted or unreadable: nothing to compare
    }
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(target))
        visit(path.join(target, entry));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
    }
  };
  for (const t of targets) visit(t);
  return newest;
}

/**
 * `next start` serves whatever is in .next, so a stale build silently shows
 * yesterday's app. Rebuild when there is no build at all, or when any source
 * file is newer than the one we have.
 */
function needsBuild() {
  let builtAt;
  try {
    builtAt = fs.statSync(path.join(".next", "BUILD_ID")).mtimeMs;
  } catch {
    return true;
  }
  return newestMtime(WATCHED) > builtAt;
}

// Closing the app window does not stop the server, so a second `npm run app`
// (from another terminal, or after closing the window) just reopens the window.
if (await ping()) {
  console.log(`Finance is already running at ${URL}. Opening a window.`);
  openBrowser();
  process.exit(0);
}

if (needsBuild()) await run(["run", "build"]);
const server = spawn(npm, ["run", "start", "--", "-p", String(PORT)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

function stopServer() {
  if (process.platform === "win32" && server.pid) {
    spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
      stdio: "ignore",
    });
  } else {
    server.kill();
  }
}
process.on("SIGINT", () => {
  stopServer();
  setTimeout(() => process.exit(0), 300);
});
process.on("SIGTERM", () => {
  stopServer();
  setTimeout(() => process.exit(0), 300);
});
for (let i = 0; i < 60 && !(await ping()); i++)
  await new Promise((r) => setTimeout(r, 500));
openBrowser();
console.log(
  `\nFinance is running at ${URL}.\nClosed the window? Run \`npm run app\` again to reopen it.\nPress Ctrl-C here to stop the server.`,
);
