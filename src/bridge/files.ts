// Native "choose a file" dialog for attachments and images.
import { open, type DialogFilter } from '@tauri-apps/plugin-dialog';

/** Paths the desktop E2E suite queues to stand in for the next dialog results. */
export const queuedChoices: string[] = [];

export async function chooseFile(title: string, filters?: DialogFilter[]): Promise<string | null> {
  if (queuedChoices.length) return queuedChoices.shift()!;
  const path = await open({ title, multiple: false, directory: false, filters });
  return typeof path === 'string' ? path : null;
}
