/** Ist gerade ein modaler Dialog offen? Dann wirken die Spalten-Kürzel nicht. */
export function isModalOpen(): boolean {
  try {
    return document.querySelector("dialog:modal") !== null;
  } catch {
    return false;
  }
}
