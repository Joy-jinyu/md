/** 独立窗口有自己的草稿和保存版本，不借用主窗口的编辑会话。 */
import { cleanup, signal, Storage, Text, View } from "nsh";
import { currentWindow, Window } from "nsh/desktop";
import { dirOf } from "../../doc/file-name";
import { joinEndings, splitEndings } from "../../doc/line-endings";
import { messageOf } from "../../doc/message";
import { type Phrase, phrase, t } from "../../i18n";
import { saveToDownloads } from "../../platform/macos/save";
import { backendTag, documentStore } from "../../store/backend";
import { flush as flushMainDocument } from "../../store/document";
import type { ReadResult } from "../../store/document-store";
import { noteSaved } from "../../store/history";
import { scopedKey, STASH_PREFIX } from "../../store/kv";
import { currentDocId, noteMeta, noteTitle } from "../../store/library";
import { Button } from "../../ui/button";
import { Notice } from "../../ui/notice";
import { createSourceFind, SourcePane } from "./SourcePane";

const SAVE_DELAY = 800;

const windows = new Set<{ flush: () => Promise<boolean>; durable: () => boolean }>();

/** 已确认写盘或另存的草稿才允许应用退出。 */
export function canStashDocumentWindows(): boolean {
  return [...windows].every((session) => session.durable());
}

/** 退出整个应用时，也要等独立窗口写完或确认保住了草稿。 */
export async function flushDocumentWindows(): Promise<boolean> {
  return (await Promise.all([...windows].map((session) => session.flush()))).every(Boolean);
}

export async function openDocumentWindow(id: string): Promise<void> {
  const key = `document:${id}`;
  const window = Window.get(key);
  if (window) return window.focus();
  if (id === currentDocId() && !(await flushMainDocument()).ok) {
    throw new Error(t("请先处理这篇文档的保存问题，再在新窗口打开。", "Resolve this document’s save problem before opening it in a new window."));
  }
  const original = await documentStore.read(id);
  if (!original) throw new Error(t("这篇文档已经不在了。", "This document no longer exists."));
  Window.open(() => <DocumentWindow id={id} original={original} />, {
    id: key,
    title: id.slice(dirOf(id).length),
    closeOnPress: false,
    defaultSize: { width: 830, height: 680 },
    minSize: { width: 360, height: 260 },
    restoreBounds: true,
  });
}

function DocumentWindow(props: { id: string; original: ReadResult }) {
  const window = currentWindow();
  const find = createSourceFind();
  const fileName = props.id.slice(dirOf(props.id).length);
  const endings = splitEndings(props.original.text);
  const backend = backendTag();
  // 主窗口的应急键独立保留。重启时 recoverUnsaved 会一起恢复这份草稿。
  const stashKey = scopedKey(`${STASH_PREFIX}window.`, backend, props.id);
  const status = signal<Phrase>(() => t("Markdown 源码", "Markdown source"));
  const copyNeeded = signal(false);
  const savedCopy = signal<string | null>(null);
  let latest = props.original.text;
  let stored = props.original.text;
  let version = props.original.version;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<boolean> | undefined;
  let stashedText: string | null = null;

  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const stash = async (): Promise<boolean> => {
    const text = latest;
    try {
      await Storage.setItem(stashKey, JSON.stringify({ id: props.id, base: version, text, backend }));
      stashedText = text;
      return text === latest;
    } catch (error) {
      console.warn("独立窗口草稿未能保留", error);
      return false;
    }
  };

  const clearStash = async () => {
    try {
      await Storage.removeItem(stashKey);
      stashedText = null;
    } catch (error) {
      console.warn("独立窗口草稿未能清除", error);
    }
  };

  const save = async (): Promise<boolean> => {
    while (latest !== stored) {
      const text = latest;
      try {
        const result = await documentStore.write(props.id, text, version);
        if (!result.ok) {
          copyNeeded.set(true);
          status.set(() => t(
            "文件已被其他窗口或程序修改或移走。这里的改动还在，可以先存成副本。",
            "This file was changed or moved elsewhere. Your edits are still here. Save them as a copy.",
          ));
          await stash();
          return false;
        }
        const previous = stored;
        stored = text;
        version = result.meta.version;
        noteMeta(result.meta);
        noteTitle(props.id, text);
        await noteSaved(props.id, previous, text).catch((error: unknown) => console.warn("独立窗口版本历史未能更新", error));
        await clearStash();
      } catch (error) {
        copyNeeded.set(true);
        status.set(() => t(`没能保存：${messageOf(error)}`, `Could not save: ${messageOf(error)}`));
        await stash();
        return false;
      }
    }
    copyNeeded.set(false);
    status.set(() => t("已保存", "Saved"));
    return true;
  };

  const flush = () => {
    stopTimer();
    if (inFlight) return inFlight;
    if (latest === stored) return Promise.resolve(true);
    inFlight = save().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  const preserveBeforeQuit = async () => {
    if (await flush()) return true;
    if (savedCopy() === latest) {
      await clearStash();
      if (savedCopy() === latest) return true;
    }
    if (await stash()) return true;
    window.focus();
    return false;
  };
  const session = {
    flush: preserveBeforeQuit,
    durable: () => latest === stored || latest === stashedText || latest === savedCopy(),
  };
  windows.add(session);
  cleanup(() => {
    stopTimer();
    windows.delete(session);
  });

  const onClose = async () => {
    if (await flush() && latest === stored) window.close();
    else if (savedCopy() === latest) {
      await clearStash();
      window.close();
    }
  };
  window.on("closePress", () => void onClose());
  window.on("focusChange", ({ focused }) => {
    if (!focused && latest !== stored) void flush();
  });

  const changed = (text: string) => {
    latest = joinEndings(text, endings);
    stopTimer();
    if (copyNeeded()) {
      timer = setTimeout(() => void stash(), SAVE_DELAY);
      return;
    }
    status.set(() => t("保存中…", "Saving…"));
    timer = setTimeout(() => void flush(), SAVE_DELAY);
  };
  const saveCopy = async () => {
    const text = latest;
    try {
      const path = await saveToDownloads(fileName, text);
      savedCopy.set(text);
      status.set(() => t(`副本已存到 ${path}`, `Copy saved to ${path}`));
    } catch (error) {
      status.set(() => t(`没能保存副本：${messageOf(error)}`, `Could not save a copy: ${messageOf(error)}`));
    }
  };

  return (
    <View class="flex-1 bg-background">
      <SourcePane text={endings.text} find={find} onChange={changed} />
      <If when={copyNeeded()}>
        <Notice testID="document-window-save-problem" message={phrase(status())} tone={savedCopy() === latest ? "info" : "warn"} />
      </If>
      <View class="min-h-8 flex-row items-center gap-2 border-t border-border px-3">
        <Text class="flex-1 text-xs text-muted-foreground">{copyNeeded() ? t("Markdown 源码", "Markdown source") : phrase(status())}</Text>
        <If when={copyNeeded()}>
          <Button testID="document-window-save-copy" label={t("将副本存到下载文件夹", "Save Copy to Downloads")} onPress={() => void saveCopy()} />
        </If>
        <Button testID="document-window-save" label={t("保存", "Save")} onPress={() => void flush()} />
      </View>
    </View>
  );
}
