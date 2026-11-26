import { expect, test } from "nsh/test";
import { authorizeUrl, checkState, codeChallenge, exchangeCode, parseCallback, pollDeviceToken, type PollResult, randomVerifier, requestDeviceCode, STATE_TTL, withoutCallback } from "../src/sync/auth";
import { phrase } from "../src/i18n";
import { SyncError } from "../src/sync/github";

/** 失败原因是按界面语言显示的文字：比较时取它现在显示的那句。 */
const shown = (r: PollResult) => (r.kind === "failed" ? { ...r, message: phrase(r.message) } : r);

const CODE = { deviceCode: "dev-1", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 };

/** 轮询时 GitHub 依次回这些（`"offline"` 是这一次连不上）；记下每次等了多久、发了什么。 */
function polling(replies: (Record<string, unknown> | "offline")[], options: { cancelAfter?: number } = {}) {
  const waits: number[] = [];
  const forms: URLSearchParams[] = [];
  let now = 0;
  let i = 0;
  return {
    waits,
    forms,
    run: () =>
      pollDeviceToken("cid", CODE, {
        fetchFn: async (_url, init) => {
          forms.push(new URLSearchParams(String(init?.body)));
          const reply = replies[i++] ?? { error: "authorization_pending" };
          if (reply === "offline") throw new TypeError("Network request failed");
          return Response.json(reply);
        },
        sleep: async (ms) => {
          waits.push(ms);
          now += ms;
        },
        cancelled: () => options.cancelAfter !== undefined && forms.length >= options.cancelAfter,
        now: () => now,
      }),
  };
}

test("device flow asks for a user code with the gist scope only", async () => {
  let form = new URLSearchParams();
  const code = await requestDeviceCode("cid", async (url, init) => {
    expect(url).toBe("https://github.com/login/device/code");
    form = new URLSearchParams(String(init?.body));
    return Response.json({ device_code: "d", user_code: "ABCD-EFGH", verification_uri: "https://github.com/login/device", expires_in: 899, interval: 5 });
  });
  expect(form.get("scope")).toBe("gist");
  expect(form.get("client_id")).toBe("cid");
  expect(code.userCode).toBe("ABCD-EFGH");
});

test("polling waits the interval while pending, slows down when told, then returns the token", async () => {
  const p = polling([{ error: "authorization_pending" }, { error: "slow_down", interval: 10 }, { error: "authorization_pending" }, { access_token: "test-token-x", token_type: "bearer", scope: "gist" }]);
  expect(await p.run()).toEqual({ kind: "token", token: "test-token-x" });
  expect(p.waits).toEqual([5000, 5000, 10000, 10000]);
  expect(p.forms[0].get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
  expect(p.forms[0].get("device_code")).toBe("dev-1");
});

test("slow_down without a new interval adds 5 seconds", async () => {
  const p = polling([{ error: "slow_down" }, { access_token: "t" }]);
  await p.run();
  expect(p.waits).toEqual([5000, 10000]);
});

test("an expired code, a cancel on GitHub, and a disabled device flow each stop with a reason", async () => {
  expect(shown(await polling([{ error: "expired_token" }]).run())).toEqual({ kind: "failed", message: "The verification code expired. Select “Sign in with GitHub” to request another one." });
  expect(shown(await polling([{ error: "access_denied" }]).run())).toEqual({ kind: "failed", message: "Authorization was canceled on GitHub. You weren’t signed in." });
  const disabled = await polling([{ error: "device_flow_disabled" }]).run();
  expect(disabled.kind === "failed" && phrase(disabled.message).includes("Device Flow")).toBe(true);
});

test("polling past the code's lifetime stops as expired, and a cancel stops it quietly", async () => {
  const long = polling(Array.from({ length: 400 }, () => ({ error: "authorization_pending" })));
  const result = await long.run();
  expect(result.kind).toBe("failed");
  expect(long.forms.length <= 180).toBe(true);
  expect(await polling([], { cancelAfter: 2 }).run()).toEqual({ kind: "cancelled" });
});

test("a blip in the network while waiting is tolerated a couple of times; three in a row stop the sign-in", async () => {
  const blips = polling(["offline", { error: "authorization_pending" }, "offline", "offline", { access_token: "test-token-y" }]);
  expect(await blips.run()).toEqual({ kind: "token", token: "test-token-y" });
  const down = await polling(["offline", "offline", "offline", { access_token: "never" }]).run();
  expect(down.kind === "failed" && phrase(down.message).includes("Check your connection")).toBe(true);
});

test("the authorize page asks for gist with the state, the redirect back to the page, and a PKCE S256 challenge", async () => {
  const url = new URL(authorizeUrl("cid", "s123", "https://markdown.pairwise.site/", "chal"));
  expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(url.searchParams.get("scope")).toBe("gist");
  expect(url.searchParams.get("state")).toBe("s123");
  expect(url.searchParams.get("redirect_uri")).toBe("https://markdown.pairwise.site/");
  expect([url.searchParams.get("code_challenge"), url.searchParams.get("code_challenge_method")]).toEqual(["chal", "S256"]);
  // 期望值用 Node 算的：createHash("sha256").update(verifier).digest("base64url")
  expect(await codeChallenge("dBjftJeZ4CVP-mJ92K1jfgbLlFx4pX8kDiiw7AEdcGQ")).toBe("cRAim_xfzVmwJDtwPH1tGUwvpRYIhFPAkgKjWD-siNY");
  const verifier = randomVerifier();
  expect(/^[A-Za-z0-9_-]{43}$/.test(verifier)).toBe(true);
  expect(randomVerifier() === verifier).toBe(false);
});

test("the page address after GitHub is read for code / error and cleaned of them", () => {
  expect(parseCallback("https://m.site/?code=abc&state=s1")).toEqual({ kind: "code", code: "abc", state: "s1" });
  expect(parseCallback("https://m.site/?error=access_denied&state=s1")).toEqual({ kind: "error", error: "access_denied", state: "s1" });
  expect(parseCallback("https://m.site/")).toBe(null);
  expect(parseCallback(null)).toBe(null);
  expect(withoutCallback("https://m.site/app/?code=abc&state=s1&keep=1#x")).toBe("https://m.site/app/?keep=1");
  // GitHub 回跳还带 iss（发令牌方）；失败时带 error 三件。用户自己的参数（keep、lang）留着
  expect(withoutCallback("https://m.site/?lang=zh&code=abc&state=s1&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth&keep=1")).toBe("https://m.site/?lang=zh&keep=1");
  expect(withoutCallback("https://m.site/?error=access_denied&error_description=x&error_uri=y&state=s1&keep=1")).toBe("https://m.site/?keep=1");
});

test("the state must have been saved here, be fresh, and match", () => {
  const saved = { state: "s1", at: 1000 };
  expect(checkState(saved, "s1", 2000)).toBe(null);
  expect(checkState(saved, "s2", 2000)?.includes("did not match")).toBe(true);
  expect(checkState(saved, "s1", 1000 + STATE_TTL + 1)?.includes("expired")).toBe(true);
  expect(checkState(null, "s1", 2000)?.includes("started on another page")).toBe(true);
  expect(checkState(saved, "", 2000) === null).toBe(false);
});

test("the code is exchanged at the worker with the PKCE verifier and the redirect; a refusal says why without leaking anything", async () => {
  let sent: unknown = null;
  const x = { code: "c", state: "s", verifier: "v".repeat(43), redirectUri: "https://markdown.pairwise.site/" };
  const token = await exchangeCode("https://auth.example", x, async (url, init) => {
    expect(url).toBe("https://auth.example/token");
    sent = JSON.parse(String(init?.body));
    return Response.json({ access_token: "test-token-ok" });
  });
  expect(token).toBe("test-token-ok");
  expect(sent).toEqual({ code: "c", state: "s", code_verifier: "v".repeat(43), redirect_uri: "https://markdown.pairwise.site/" });
  let error: unknown = null;
  try {
    await exchangeCode("https://auth.example", x, async () => Response.json({ error: "bad_verification_code" }, { status: 400 }));
  } catch (e) {
    error = e;
  }
  expect(error instanceof SyncError && error.message.includes("bad_verification_code")).toBe(true);
});
