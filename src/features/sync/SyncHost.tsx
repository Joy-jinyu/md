/**
 * 同步在编辑页上的那一层：挂上同步面板；启动时读出登录状态；网页从 GitHub 授权页回来时完成登录；
 * 窗口回到前台时重读登录（别的标签页可能刚登录、退出或换了账号：换了就清掉上一个账号的待选事项）。
 * `reload`：同步把开着的这篇换成了 GitHub 上的内容，编辑页要重新载入。
 */
import { t } from "../../i18n";
import { effect, lifecycle, untracked } from "nsh";
import { messageOf } from "../../doc/message";
import { SIGN_IN_FLOW } from "../../platform";
import { finishWebLogin, restoreAccount } from "../../sync/account";
import { parseCallback, withoutCallback } from "../../sync/auth";
import { say } from "../library/receipt";
import { onCurrentReplaced } from "./apply";
import { discoverRemote, dropViewOfOtherAccount, loadLastSync } from "./engine";
import { syncOpen } from "./open";
import { pageUrl, setPageUrl } from "./page-url";
import { SyncDialog } from "./SyncDialog";

/** 网页：地址里带着 GitHub 授权回来的 code / state 就完成登录，先把这些参数从地址里去掉（刷新时不再用一次）。 */
async function completeWebLogin() {
  const here = pageUrl();
  const callback = parseCallback(here);
  if (!here || !callback) return;
  setPageUrl(withoutCallback(here));
  try {
    const login = await finishWebLogin(callback);
    say(() => t(`已登录 GitHub：@${login}。从这一页打开的登录，原来那一页回到前台时也会变成已登录。`, `Signed in to GitHub as @${login}. If you started in another tab, it will pick up the sign-in when you return to it.`), "info");
    syncOpen.set(true);
    await discoverRemote();
  } catch (e) {
    console.warn("web sign-in not finished", messageOf(e));
    say(messageOf(e), "warn");
  }
}

export function SyncHost(props: { reload: () => Promise<void> }) {
  onCurrentReplaced(props.reload);
  void restoreAccount().then(() => (SIGN_IN_FLOW === "web" ? completeWebLogin() : undefined));
  void loadLastSync();
  let wasActive = true;
  effect(() => {
    const active = lifecycle() === "active";
    untracked(() => {
      if (active && !wasActive) void restoreAccount().then(dropViewOfOtherAccount);
      wasActive = active;
    });
  });
  return <SyncDialog />;
}
