import { useSyncExternalStore } from "react";
import { getAppSettings, saveAppSettings } from "./appSettings";
import { isValidHexColor } from "./colorUtils";

// tiny shared stash of pretty colors. lives in app settings so every timeline gets to borrow them
// capped bc nobody needs 40 slightly different beiges (u know who u are)
export const MAX_FAVORITE_COLORS = 16;

let favorites = [];
let hydrated = false;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

const sanitize = (list) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== "string" || !isValidHexColor(raw.trim())) continue;
    const hex = raw.trim().toLowerCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
    if (out.length >= MAX_FAVORITE_COLORS) break;
  }
  return out;
};

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  getAppSettings()
    .then((settings) => {
      favorites = sanitize(settings?.favoriteColors);
      emit();
    })
    .catch(() => { /* no settings, no faves, no drama */ });
}

function persist(next) {
  favorites = next;
  emit();
  saveAppSettings({ favoriteColors: next }).catch(console.error);
}

export function getFavoriteColors() {
  return favorites;
}

export function addFavoriteColor(color) {
  if (typeof color !== "string" || !isValidHexColor(color.trim())) return;
  const hex = color.trim().toLowerCase();
  // newest goes first, oldest gets politely shown the door
  persist(sanitize([hex, ...favorites.filter((c) => c !== hex)]));
}

export function removeFavoriteColor(color) {
  const hex = String(color || "").trim().toLowerCase();
  persist(favorites.filter((c) => c !== hex));
}

function subscribe(fn) {
  hydrate();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useFavoriteColors() {
  return useSyncExternalStore(subscribe, getFavoriteColors, getFavoriteColors);
}
