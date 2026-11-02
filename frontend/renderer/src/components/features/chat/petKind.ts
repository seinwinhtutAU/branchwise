import { useCallback, useSyncExternalStore } from "react";

// Which pet the person chose (the cat or the robot). Kept in one place so everything that shows the
// pet agrees: the floating pet, the chat panel's title and the Explain switch in the header.

export type PetKind = "cat" | "robot";

export const PET_KIND_KEY = "branchwise-assistant-pet-kind";
const CHANGE_EVENT = "branchwise-pet-kind-change";

// Held in memory too, so a browser that refuses to store anything still switches pets.
let current: PetKind | null = null;

export function readPetKind(): PetKind {
  if (current) return current;
  try {
    return localStorage.getItem(PET_KIND_KEY) === "robot" ? "robot" : "cat";
  } catch {
    return "cat";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePetKind(): [
  PetKind,
  (next: PetKind | ((kind: PetKind) => PetKind)) => void,
] {
  const kind = useSyncExternalStore(
    subscribe,
    readPetKind,
    (): PetKind => "cat",
  );
  const setKind = useCallback(
    (next: PetKind | ((kind: PetKind) => PetKind)) => {
      const value = typeof next === "function" ? next(readPetKind()) : next;
      current = value;
      try {
        localStorage.setItem(PET_KIND_KEY, value);
      } catch {
        // Not remembered next time; it still changes now.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [],
  );
  return [kind, setKind];
}

/**
 * Where a pet picture lives. Built from BASE_URL rather than a leading "/", because the installed
 * app opens its page from a file on disk, where "/mascots/..." points at the disk's root and the
 * picture never loads.
 */
export function mascotSrc(file: string): string {
  return `${import.meta.env.BASE_URL}mascots/${file}`;
}

/** The still picture of the pet used as an icon (its idle frame). */
export function petIconSrc(kind: PetKind): string {
  return mascotSrc(
    kind === "cat" ? "branchwise-cat-idle.png" : "branchwise-robot-idle.png",
  );
}
