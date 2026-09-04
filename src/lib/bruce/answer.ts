import { prisma } from "@/lib/db";
import { extractMaterial, extractLocation } from "./entities";
import { BRUCE_INTENTS } from "./intents";
import type { BruceAnswer, BruceContext } from "./types";

const FALLBACK_ANSWER: BruceAnswer = {
  text: "I can help with inventory, consumption, stock movements, requests, quality, dispatch, and related plant data.",
};
const UNAVAILABLE_ANSWER: BruceAnswer = { text: "Bruce AI is temporarily unavailable." };

/**
 * Bruce AI's single entry point — resolves an intent from the question and answers it using
 * only existing, already-RBAC-aware application functions (no external model call, no second
 * data source). Never throws: any internal failure resolves to the section-19 "temporarily
 * unavailable" text so a Bruce AI problem can never affect the rest of the Dashboard.
 */
export async function answerBruceQuestion(question: string, currentUser: { id: string; role: string }): Promise<BruceAnswer> {
  const trimmed = question.trim();
  if (!trimmed) return FALLBACK_ANSWER;
  const q = trimmed.toLowerCase();

  try {
    const [materials, locations] = await Promise.all([
      prisma.material.findMany({ where: { active: true }, select: { id: true, name: true, materialCode: true, uom: true } }),
      prisma.location.findMany({ where: { active: true }, select: { id: true, name: true } }),
    ]);

    const material = extractMaterial(q, materials);
    const location = extractLocation(q, locations);

    const ctx: BruceContext = { question: q, currentUser, materials, locations, material, location };

    // Entity-requiring intents get first refusal, but only when their entity was actually
    // found — otherwise "usable stock" (no material named) would incorrectly try to run a
    // material-specific handler with nothing to work with.
    const tiers = [
      BRUCE_INTENTS.filter((i) => i.requiresEntity && (material || location)),
      BRUCE_INTENTS.filter((i) => !i.requiresEntity),
    ];
    for (const tier of tiers) {
      for (const intent of tier) {
        if (intent.match(q)) return await intent.handle(ctx);
      }
    }

    // A question that clearly named a material/location Bruce AI couldn't otherwise answer
    // about is worth a more specific "insufficient data" response than the generic fallback.
    if (material || location) {
      return { text: `I don't have enough data to answer that accurately for ${material?.name ?? location?.name}.` };
    }
    return FALLBACK_ANSWER;
  } catch {
    return UNAVAILABLE_ANSWER;
  }
}
