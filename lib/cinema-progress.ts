import { FILM_DAYS, beijingDay } from "./film-season";
import { movieRewardBank } from "./movie-rewards";
import { milestoneKey, type MilestoneRecord } from "./progress-milestones";

export type CinemaEarnBasis = "fact_confirmation" | "work_session_self_report" | "task_completion_owner_report" | "meaningful_milestone";
export type EarnedCinemaCard = {
  event_id: string;
  card_id: string;
  earned_at: string;
  earned_day: string;
  chapter_id: string | null;
  basis: CinemaEarnBasis;
  milestone_id?: string;
  milestone_title?: string;
  package_id?: string;
};
export const CINEMA_COLLECTION_CAPACITY = 240;

/** Checked-in cards plus the validated owner-private editorial source are
 * eligible. Browser actions cannot choose cards or supply this bank.
 * Reading today's free discovery never calls this. */
export function earnCinemaCard(
  value: unknown, eventId: string, basis: CinemaEarnBasis, now = new Date(), curatedBank?: unknown, milestone?: MilestoneRecord,
): { cinema: Record<string, any>; earned_card: EarnedCinemaCard | null } {
  const cinema: Record<string, any> = value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) : {};
  // Legacy bases are retained in historical card types but cannot issue new
  // cards. Only a catalog-backed owner-reported deliverable reaches this path.
  if (basis !== "meaningful_milestone" || !milestone || milestone.event_id !== eventId || !["owner_report", "agent_report"].includes(milestone.basis) || milestone.key !== milestoneKey(milestone.project_key, milestone.milestone_id)) return { cinema, earned_card: null };
  if (cinema.milestones !== undefined && !Array.isArray(cinema.milestones)) return { cinema, earned_card: null };
  const milestones: MilestoneRecord[] = cinema.milestones ?? [];
  if (milestones.some((record) => record.key === milestone.key) || milestones.length >= CINEMA_COLLECTION_CAPACITY) return { cinema, earned_card: null };
  cinema.milestones = [...milestones, structuredClone(milestone)];
  // Preserve unfamiliar legacy state rather than silently dropping history.
  if (cinema.earned_cards !== undefined && !Array.isArray(cinema.earned_cards)) return { cinema, earned_card: null };
  const existing: Record<string, any>[] = cinema.earned_cards ?? [];
  if (existing.some((card) => card && card.event_id === eventId) || existing.length >= CINEMA_COLLECTION_CAPACITY) return { cinema, earned_card: null };
  const collected = new Set(existing.map((card) => card?.card_id));
  const day = beijingDay(now);
  // Film-day IDs take priority too; curated data cannot replace a static card.
  const pool = [...FILM_DAYS, ...movieRewardBank(curatedBank)].filter((card, index, cards) => cards.findIndex((candidate) => candidate.id === card.id) === index);
  const today = FILM_DAYS.find((card) => card.date === day && !collected.has(card.id));
  const selected = today ?? pool.find((card) => !collected.has(card.id));
  if (!selected) return { cinema, earned_card: null };
  const earned: EarnedCinemaCard = {
    event_id: eventId, card_id: selected.id, earned_at: now.toISOString(), earned_day: day,
    chapter_id: "chapter_id" in selected && typeof selected.chapter_id === "string" ? selected.chapter_id : null, basis,
    milestone_id: milestone.milestone_id, milestone_title: milestone.title, package_id: milestone.package_id,
  };
  cinema.earned_cards = [...existing, earned];
  // The collection is never truncated and stops at capacity/exhaustion.
  // This total therefore counts actual persisted cards, not virtual points.
  cinema.earned_total = cinema.earned_cards.length;
  cinema.collection_capacity = CINEMA_COLLECTION_CAPACITY;
  return { cinema, earned_card: earned };
}
