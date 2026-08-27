// App name/version for the status line. A one-shot read the shell shows;
// no `await` at the boot site — a line that can render "—" until the number
// lands should not delay anything.

import { signal } from "@preact/signals";

export const appVersion = signal<string>("");

export async function loadAppInfo(): Promise<void> {
  const info = await window.api.appInfo();
  appVersion.value = info.version;
}
