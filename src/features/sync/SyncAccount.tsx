/**
 * 登录 GitHub 的那一块：设置的「同步」页签和同步面板里共用。没配置时说明要什么；macOS 走 Device Flow（显示用户码），网页跳 GitHub 授权页。
 * 布局见 DESIGN.md「M5：同步」的登录一节。
 */
import { cleanup, Clipboard, Text, View } from "nsh";
import { messageOf } from "../../doc/message";
import { SIGN_IN_FLOW } from "../../platform";
import { beginDeviceLogin, beginWebLogin, cancelDeviceLogin, currentAccount, deviceLogin, signOut } from "../../sync/account";
import { withoutCallback } from "../../sync/auth";
import { OAUTH_CALLBACK_ORIGIN, syncConfigured } from "../../sync/config";
import { Button } from "../../ui/button";
import { openLink } from "../editor/links";
import { say } from "../library/receipt";
import { discoverRemote, resetSyncView } from "./engine";
import { pageUrl } from "./page-url";

const WEB = SIGN_IN_FLOW === "web";

/** 登录凭证存在哪：网页是这个站点在浏览器里的存储，macOS 是应用自己的存储（nsh 0.6.0 没有钥匙串接口）。 */
const CREDENTIAL = WEB
  ? "登录凭证存在这个浏览器里，只有 Gist 权限，退出登录会删除。"
  : "登录凭证存在这台电脑上 Pairdown 自己的存储里（不是钥匙串），只有 Gist 权限，退出登录会删除。";

/** 上传什么、不上传什么，登录凭证存在哪、怎么撤销。 */
export function SyncExplain() {
  return (
    <View class="gap-1">
      <Text testID="sync-explain" class="text-xs leading-5 text-muted-foreground">
        同步只上传文档正文（Markdown 文字）：一篇一个私密 Gist，不公开列出，但拿到链接的人能看。图片不同步（Gist 的接口只收文字），正文里的图片地址照原样上传；版本历史和设置不上传。同步要手动点「立即同步」。
      </Text>
      <Text testID="sync-credential" class="text-xs leading-5 text-muted-foreground">
        {`${CREDENTIAL}退出登录不会撤销 GitHub 上的授权，可以在 GitHub 的设置（Settings → Applications → Authorized OAuth Apps）里撤销。`}
      </Text>
    </View>
  );
}

function NotConfigured() {
  return (
    <View testID="sync-not-configured" class="gap-1">
      <Text class="text-[13px] font-medium text-strong">同步还没配置</Text>
      <Text class="text-xs leading-5 text-muted-foreground">
        {`要先建一个 GitHub OAuth App，把它的 client id 填进 src/sync/config.ts 的 GITHUB_CLIENT_ID${WEB ? "；网页版还要部署换 token 的中转 Worker（worker/ 文件夹），把地址填进 AUTH_WORKER_URL" : "，并在 App 设置里打开 Device Flow"}。配好以后重新打包，这里就能登录。`}
      </Text>
    </View>
  );
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch (e) {
    console.warn("page address unreadable", e);
    return null;
  }
}

async function startWebLogin() {
  const here = pageUrl();
  if (!here) return say("读不到这个页面的地址，没法登录。", "warn");
  if (originOf(here) !== OAUTH_CALLBACK_ORIGIN) return say(`网页登录只在 ${new URL(OAUTH_CALLBACK_ORIGIN).host} 可用：GitHub 只把登录送回那里登记的地址。`, "warn");
  try {
    const url = await beginWebLogin(withoutCallback(here));
    if (!(await openLink(url, () => false))) say("浏览器没让打开 GitHub 的授权页（可能拦了弹出窗口），允许本站打开新窗口后再试。", "warn");
    else say("已在新标签页打开 GitHub 授权页。授权后那一页会完成登录，回到这里就能同步。", "info");
  } catch (e) {
    console.error("web sign-in not started", e);
    say(`没能开始登录：${messageOf(e)}`, "warn");
  }
}

/** macOS：Device Flow 走完了，登上了就看 GitHub 上有没有本机没有的文档。 */
async function startDeviceLogin() {
  await beginDeviceLogin();
  const account = currentAccount();
  if (account.kind !== "signed-in") return;
  say(`已登录 GitHub：@${account.login}。`, "info");
  await discoverRemote();
}

/** 「复制并打开」：用户码放进剪贴板，打开 GitHub 的验证页。 */
async function copyAndOpen(userCode: string, uri: string) {
  await Clipboard.writeText(userCode).catch((e: unknown) => console.warn("user code not copied", e));
  if (!(await openLink(uri, () => false))) say(`没能打开浏览器，手动打开 ${uri} 输入验证码。`, "warn");
}

function DeviceSteps() {
  const state = () => deviceLogin();
  // 面板（设置、同步）关掉了就不再轮询：用户看不到验证码，也就不会去输入
  cleanup(() => {
    const kind = deviceLogin().kind;
    if (kind === "starting" || kind === "waiting") cancelDeviceLogin();
  });
  return (
    <View class="gap-2">
      <If when={state().kind === "waiting" ? (state() as Extract<ReturnType<typeof deviceLogin>, { kind: "waiting" }>).code : null}>
        {(code) => (
          <View testID="device-code" class="gap-2 rounded-(--radius-sm) bg-muted px-3 py-2">
            <Text class="text-xs text-muted-foreground">{`打开 ${code().verificationUri}，输入这个码并授权：`}</Text>
            <Text class="font-mono text-xl font-semibold text-strong">
              {code().userCode}
            </Text>
            <View class="flex-row flex-wrap gap-1">
              <Button testID="device-open" label="复制并打开" variant="primary" onPress={() => void copyAndOpen(code().userCode, code().verificationUri)} />
              <Button testID="device-cancel" label="取消" onPress={cancelDeviceLogin} />
            </View>
            <Text class="text-xs text-muted-foreground">等你在 GitHub 上输入这个码并授权…</Text>
          </View>
        )}
      </If>
      <If when={state().kind === "failed" ? (state() as { message: string }).message : null}>
        {(message) => (
          <Text testID="sign-in-problem" role="alert" class="text-xs leading-5 text-destructive">
            {message()}
          </Text>
        )}
      </If>
    </View>
  );
}

function SignIn() {
  const busy = () => deviceLogin().kind === "starting" || deviceLogin().kind === "waiting";
  return (
    <View class="gap-2">
      <Text class="text-xs leading-5 text-muted-foreground">{WEB ? "点了会在新标签页打开 GitHub 的授权页，只要 Gist 权限。" : "点了会给你一个验证码，在 GitHub 上输入它授权，只要 Gist 权限。"}</Text>
      <View class="flex-row">
        <Button
          testID="sign-in"
          label={deviceLogin().kind === "starting" ? "正在要验证码…" : "用 GitHub 登录"}
          variant="primary"
          disabled={busy()}
          onPress={() => (WEB ? void startWebLogin() : void startDeviceLogin())}
        />
      </View>
      <If when={!WEB}>
        <DeviceSteps />
      </If>
    </View>
  );
}

function SignedIn(props: { login: string }) {
  const out = async () => {
    try {
      await signOut();
      resetSyncView();
      say("已退出 GitHub 登录。本机的文档没有动。", "info");
    } catch (e) {
      console.error("sign-out failed", e);
      say(`没能退出登录：${messageOf(e)}`, "warn");
    }
  };
  return (
    <View class="flex-row items-center gap-2">
      <Text testID="sync-account" style={{ numberOfLines: 1 }} class="min-w-0 flex-1 text-[13px] font-medium text-strong">
        {`已登录：@${props.login}`}
      </Text>
      <Button testID="sign-out" label="退出登录" onPress={() => void out()} />
    </View>
  );
}

/** 登录区：没配置 → 说明；没登录 → 登录按钮；登录了 → 账号和退出。`explain`：下面带上「上传什么」的说明。 */
export function SyncAccount(props: { explain?: boolean }) {
  const account = () => currentAccount();
  return (
    <View testID="sync-account-area" class="gap-3">
      <If
        when={syncConfigured(WEB)}
        else={
          <>
            <NotConfigured />
            <View class="flex-row">
              <Button testID="sign-in" label="用 GitHub 登录" variant="primary" disabled />
            </View>
          </>
        }
      >
        <If when={account().kind === "signed-in" ? (account() as { login: string }).login : null} else={<SignIn />}>
          {(login) => <SignedIn login={login()} />}
        </If>
      </If>
      <If when={props.explain}>
        <SyncExplain />
      </If>
    </View>
  );
}
