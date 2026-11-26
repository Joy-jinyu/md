/**
 * 登录 GitHub 的那一块：设置的「同步」页签和同步面板里共用。没配置时说明要什么；macOS 走 Device Flow（显示用户码），网页跳 GitHub 授权页。
 * 布局见 DESIGN.md「M5：同步」的登录一节。
 */
import { type Phrase, phrase, t } from "../../i18n";
import { cleanup, Text, View } from "nsh";
import { messageOf } from "../../doc/message";
import { SIGN_IN_FLOW } from "../../platform";
import { beginDeviceLogin, beginWebLogin, cancelDeviceLogin, currentAccount, deviceLogin, signOut } from "../../sync/account";
import { siteOrigin, syncConfigured } from "../../sync/config";
import { Button } from "../../ui/button";
import { writeClipboard } from "../../ui/clipboard";
import { CopyButton } from "../../ui/copy-button";
import { openLink } from "../editor/links";
import { say } from "../library/receipt";
import { discoverRemote, resetSyncView } from "./engine";
import { pageUrl } from "./page-url";

const WEB = SIGN_IN_FLOW === "web";

/** 登录凭证存在哪：网页是这个站点在浏览器里的存储，macOS 是应用自己的存储（nsh 0.6.0 没有钥匙串接口）。 */
const credential = () => WEB
  ? t("登录凭证存在这个浏览器里，只有 Gist 权限，退出登录会删除。", "Your sign-in credentials are saved in this browser. They grant access only to Gists and are removed when you sign out. ")
  : t("登录凭证存在这台电脑上 Pairdown 自己的存储里（不是钥匙串），只有 Gist 权限，退出登录会删除。", "Your sign-in credentials are saved in Pairdown’s local storage, outside Keychain. They grant access only to Gists and are removed when you sign out. ");

/** 登录凭证存在哪、退出登录不撤销 GitHub 上的授权（同步面板和设置页都写这一段）。 */
export const credentialNote = () => credential() + t("退出登录不会撤销 GitHub 上的授权，可以在 GitHub 的设置（Settings → Applications → Authorized OAuth Apps）里撤销。", "Signing out does not revoke access on GitHub. To revoke it, go to Settings → Applications → Authorized OAuth Apps on GitHub.");

/** 上传什么、不上传什么，登录凭证存在哪、怎么撤销。 */
export function SyncExplain() {
  return (
    <View class="gap-1">
      <Text testID="sync-explain" class="select-text text-xs leading-5 text-muted-foreground">{t("同步只上传文档正文（Markdown 文字）：一篇一个私密 Gist，不公开列出，但拿到链接的人能看。图片不同步（Gist 的接口只收文字），正文里的图片地址照原样上传；版本历史和设置不上传。同步要手动点「立即同步」。", "Sync uploads only the Markdown text, one secret Gist per document. Secret Gists are not listed publicly, but anyone with the link can read them. Image links are uploaded as written; image files, version history, and settings stay on this device. Select “Sync now” to sync.")}</Text>
      <Text testID="sync-credential" class="select-text text-xs leading-5 text-muted-foreground">
        {credentialNote()}
      </Text>
    </View>
  );
}

function NotConfigured() {
  return (
    <View testID="sync-not-configured" class="gap-1">
      <Text class="text-[13px] font-medium text-strong">{t("同步还没配置", "Sync is not configured")}</Text>
      <Text class="select-text text-xs leading-5 text-muted-foreground">
        {t(`要先建一个 GitHub OAuth App，把它的 client id 填进部署配置的 PAIRDOWN_GITHUB_CLIENT_ID${WEB ? "，站点地址填进 PAIRDOWN_SITE；站点的 Worker 还要设好 client secret（worker/README.md）" : "，并在 App 设置里打开 Device Flow"}。配好以后重新打包，这里就能登录。`, `Create a GitHub OAuth App and put its client ID in the PAIRDOWN_GITHUB_CLIENT_ID deployment setting. ${WEB ? "For the web app, also set PAIRDOWN_SITE and the site Worker's client secret (see worker/README.md)." : "Enable Device Flow in the OAuth App settings."} Rebuild Pairdown to enable sign-in.`)}
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
  if (!here) return say(() => t("读不到这个页面的地址，没法登录。", "Could not determine this page’s address. Sign-in is unavailable."), "warn");
  if (originOf(here) !== siteOrigin()) return say(() => t(`网页登录只在 ${new URL(siteOrigin()).host} 可用：GitHub 只把登录送回那里登记的地址。`, `Web sign-in is available only at ${new URL(siteOrigin()).host}, where the GitHub callback URL is registered.`), "warn");
  try {
    const url = await beginWebLogin();
    if (!(await openLink(url, () => false))) say(() => t("浏览器没让打开 GitHub 的授权页（可能拦了弹出窗口），允许本站打开新窗口后再试。", "Could not open GitHub’s authorization page. Allow this site to open a new window and try again."), "warn");
    else say(() => t("已在新标签页打开 GitHub 授权页。授权后那一页会完成登录，回到这里就能同步。", "Opened GitHub authorization in a new tab. After you finish signing in there, return here to sync."), "info");
  } catch (e) {
    console.error("web sign-in not started", e);
    say(() => t(`没能开始登录：${messageOf(e)}`, `Could not start sign-in: ${messageOf(e)}`), "warn");
  }
}

/** macOS：Device Flow 走完了，登上了就看 GitHub 上有没有本机没有的文档。 */
async function startDeviceLogin() {
  await beginDeviceLogin();
  const account = currentAccount();
  if (account.kind !== "signed-in") return;
  say(() => t(`已登录 GitHub：@${account.login}。`, `Signed in to GitHub as @${account.login}.`), "info");
  await discoverRemote();
}

/** 「复制并打开」：用户码放进剪贴板，打开 GitHub 的验证页。 */
async function copyAndOpen(userCode: string, uri: string) {
  const copied = await writeClipboard(userCode).then(
    () => true,
    (e: unknown) => {
      console.warn("user code not copied", e);
      return false;
    },
  );
  const opened = await openLink(uri, () => false);
  if (!opened) say(() => copied ? t(`没能打开浏览器，手动打开 ${uri} 输入验证码。`, `Could not open the browser. Open ${uri} and enter the verification code.`) : t(`没能打开浏览器，验证码也没复制上：手动打开 ${uri}，输入上面的验证码。`, `Could not open the browser or copy the code. Open ${uri} and enter the code above.`), "warn");
  else if (!copied) say(() => t("验证码没复制上，请在 GitHub 的页面里手动输入上面的验证码。", "Could not copy the code. Enter the code above on GitHub."), "warn");
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
            <Text class="select-text text-xs text-muted-foreground">{t(`打开 ${code().verificationUri}，输入这个码并授权：`, `Open ${code().verificationUri}, enter this code, and authorize Pairdown:`)}</Text>
            <View class="flex-row items-center gap-2">
              <Text class="select-text font-mono text-xl font-semibold text-strong">
                {code().userCode}
              </Text>
              <CopyButton testID="copy-device-code" text={code().userCode} label={t("复制验证码", "Copy verification code")} />
            </View>
            <View class="flex-row flex-wrap gap-1">
              <Button testID="device-open" label={t("复制并打开", "Copy and open")} variant="primary" onPress={() => void copyAndOpen(code().userCode, code().verificationUri)} />
              <Button testID="device-cancel" label={t("取消", "Cancel")} onPress={cancelDeviceLogin} />
            </View>
            <Text class="text-xs text-muted-foreground">{t("等你在 GitHub 上输入这个码并授权…", "Waiting for you to enter the code and authorize Pairdown on GitHub…")}</Text>
          </View>
        )}
      </If>
      <If when={state().kind === "failed" ? (state() as { message: Phrase }).message : null}>
        {(message) => (
          <View class="flex-row items-start gap-2">
            <Text testID="sign-in-problem" role="alert" class="min-w-0 flex-1 select-text text-xs leading-5 text-destructive">
              {phrase(message())}
            </Text>
            <CopyButton testID="copy-sign-in-problem" text={phrase(message())} label={t("复制出错原因", "Copy error details")} />
          </View>
        )}
      </If>
    </View>
  );
}

function SignIn() {
  const busy = () => deviceLogin().kind === "starting" || deviceLogin().kind === "waiting";
  return (
    <View class="gap-2">
      <Text class="select-text text-xs leading-5 text-muted-foreground">{WEB ? t("点了会在新标签页打开 GitHub 的授权页，只要 Gist 权限。", "GitHub authorization opens in a new tab and requests access only to Gists.") : t("点了会给你一个验证码，在 GitHub 上输入它授权，只要 Gist 权限。", "Use the verification code on GitHub to grant access only to Gists.")}</Text>
      <View class="flex-row">
        <Button
          testID="sign-in"
          label={deviceLogin().kind === "starting" ? t("正在要验证码…", "Requesting code…") : t("用 GitHub 登录", "Sign in with GitHub")}
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
      say(() => t("已退出 GitHub 登录。本机的文档没有动。", "Signed out of GitHub. The documents on this device are unchanged."), "info");
    } catch (e) {
      console.error("sign-out failed", e);
      say(() => t(`没能退出登录：${messageOf(e)}`, `Could not sign out: ${messageOf(e)}`), "warn");
    }
  };
  return (
    <View class="flex-row items-center gap-2">
      <Text testID="sync-account" style={{ numberOfLines: 1 }} class="min-w-0 flex-1 select-text text-[13px] font-medium text-strong">
        {t(`已登录：@${props.login}`, `Signed in as @${props.login}`)}
      </Text>
      <Button testID="sign-out" label={t("退出登录", "Sign out")} onPress={() => void out()} />
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
              <Button testID="sign-in" label={t("用 GitHub 登录", "Sign in with GitHub")} variant="primary" disabled />
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
