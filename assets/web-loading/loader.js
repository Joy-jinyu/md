(() => {
  const root = document.documentElement;
  root.classList.add("pd-starting");

  let revealed = false;
  let revealing = false;
  let watchHost;

  function hide() {
    if (revealed) return;
    revealed = true;
    clearTimeout(deadline);
    watchHost?.disconnect();
    document.getElementById("pairdown-loader")?.setAttribute("aria-hidden", "true");
    root.classList.remove("pd-starting", "pd-load-failed");
  }

  // 编辑页选过简体中文就换成中文；落地页没有 data-settings，只有英文
  let localized = false;
  function localize() {
    const loader = document.getElementById("pairdown-loader");
    const key = loader?.dataset.settings;
    if (localized || !key) return;
    localized = true;
    let locale;
    try {
      locale = JSON.parse(localStorage.getItem(key) || "{}").locale;
    } catch (e) {
      console.warn("pairdown loader: saved language unreadable", e);
      return;
    }
    if (locale !== "zh-CN") return;
    for (const el of loader.querySelectorAll("[data-zh]")) el.textContent = el.dataset.zh;
  }
  document.addEventListener("DOMContentLoaded", localize, { once: true });

  function fail() {
    if (revealed) return;
    localize();
    const hostStatus = document.getElementById("status");
    if (hostStatus?.classList.contains("failed")) hide();
    else root.classList.add("pd-load-failed");
  }

  // 这里只兜底挂起的启动，正常退场以页面就绪事件为准。
  const deadline = setTimeout(fail, 30000);
  function ready() {
    if (revealed || revealing) return;
    revealing = true;
    clearTimeout(deadline);
    requestAnimationFrame(() => requestAnimationFrame(hide));
  }

  document.addEventListener("pairdown:ready", ready, { once: true });

  document.addEventListener("DOMContentLoaded", () => {
    const hostStatus = document.getElementById("status");
    const editor = document.getElementById("app");
    if (!hostStatus || !editor || revealed) return;
    const checkHost = () => {
      if (hostStatus.classList.contains("failed")) hide();
      else if (editor.querySelector('[data-testid="pairdown-ready"]')) ready();
    };
    watchHost = new MutationObserver(checkHost);
    watchHost.observe(hostStatus, { attributes: true, attributeFilter: ["class"] });
    watchHost.observe(editor, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-testid"] });
    checkHost();
  }, { once: true });

  window.addEventListener("error", (event) => {
    const entry = event.target instanceof HTMLScriptElement && event.target.type === "module";
    const localError = event instanceof ErrorEvent && event.filename.startsWith(location.origin + "/");
    if (entry || localError) fail();
  }, true);
})();
