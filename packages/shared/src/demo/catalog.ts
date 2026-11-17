import { CLOUDFLARE_ARCH_DEMO_NOTEBOOK, CLOUDFLARE_ARCH_NOTEBOOK_ID } from "./cloudflare-demo.js";
import type { DemoNotebookDefinition } from "./demo-types.d.js";
import { RELATIONFLOW_DEMO_NOTEBOOK, RELATIONFLOW_NOTEBOOK_ID } from "./relationflow-demo.js";

export const ALL_DEMO_NOTEBOOKS: readonly DemoNotebookDefinition[] = [
  RELATIONFLOW_DEMO_NOTEBOOK,
  CLOUDFLARE_ARCH_DEMO_NOTEBOOK
];

export const DEMO_NOTEBOOK_IDS = [RELATIONFLOW_NOTEBOOK_ID, CLOUDFLARE_ARCH_NOTEBOOK_ID] as const;

export type DemoNotebookId = (typeof DEMO_NOTEBOOK_IDS)[number];

export function isDemoNotebookId(notebookId: string): notebookId is DemoNotebookId {
  return DEMO_NOTEBOOK_IDS.includes(notebookId as DemoNotebookId);
}
