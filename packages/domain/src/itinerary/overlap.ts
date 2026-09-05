import type { ItineraryItem, TimeConflict } from '@travel/contracts';

export function findDirectOverlaps(
  confirmedItems: ReadonlyArray<ItineraryItem>,
  candidate: ItineraryItem,
): TimeConflict[] {
  const candidateStart = Date.parse(candidate.startsAt);
  const candidateEnd = Date.parse(candidate.endsAt);
  if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd) || candidateStart >= candidateEnd) {
    throw new Error('itinerary interval must have a valid start before end');
  }

  return confirmedItems
    .filter(item => item.confirmed && item.id !== candidate.id)
    // A stay reserves lodging, not the traveler's entire time. Two stays still conflict.
    .filter(item => (item.category === 'stay') === (candidate.category === 'stay'))
    .flatMap(item => {
      const start = Math.max(candidateStart, Date.parse(item.startsAt));
      const end = Math.min(candidateEnd, Date.parse(item.endsAt));
      return start < end
        ? [{
            candidateId: candidate.id,
            existingId: item.id,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
          }]
        : [];
    });
}
