import type { MaterialRef, LocationRef } from "./entities";

export interface BruceLink { label: string; href: string }
export interface BruceAnswer { text: string; links?: BruceLink[] }

export interface BruceContext {
  question: string;
  currentUser: { id: string; role: string };
  materials: MaterialRef[];
  locations: LocationRef[];
  material: MaterialRef | null;
  location: LocationRef | null;
}

export interface BruceIntent {
  key: string;
  requiresEntity: boolean; // material or location must have been extracted for this intent to be tried
  match: (q: string) => boolean;
  handle: (ctx: BruceContext) => Promise<BruceAnswer>;
}
