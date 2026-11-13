/**
 * Merker in localStorage (Issue #346): Der Nutzer hat dem Offline-Modell zugestimmt und es wurde
 * vollständig geladen. Eigene kleine Datei, weil das Start-Bundle nur diesen Merker lesen muss,
 * um den Offline-Teil gleich beim Start nachzuladen.
 */
export const LOCAL_MODEL_STORAGE_KEY = "rn_local_model";

type ReadableStorage = Pick<Storage, "getItem"> | undefined;

export function hasLocalModelFlag(storage: ReadableStorage): boolean {
  try {
    return storage?.getItem(LOCAL_MODEL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
