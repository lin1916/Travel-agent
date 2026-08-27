export interface CreateTripValues {
  destination: string;
  startsAt: string;
  endsAt: string;
  travelerCount: number;
}

export function validateTrip(values: CreateTripValues): void {
  if (!values.destination.trim()) {
    throw new Error('destination is required');
  }
  if (values.travelerCount < 1 || values.travelerCount > 6) {
    throw new Error('traveler count must be between 1 and 6');
  }
  const startsAt = Date.parse(values.startsAt);
  const endsAt = Date.parse(values.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt) {
    throw new Error('trip interval must have a valid start before end');
  }
}
