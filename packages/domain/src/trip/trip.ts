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
  if (!/^[\u3400-\u9fff]+$/.test(values.destination.trim()) || /香港|澳门|台湾|台北/.test(values.destination)) {
    throw new Error('destination must be in mainland China');
  }
  if (!Number.isInteger(values.travelerCount) || values.travelerCount < 1 || values.travelerCount > 6) {
    throw new Error('traveler count must be an integer between 1 and 6');
  }
  const cstOrUtc = (value: string) => value.endsWith('+08:00') || value.endsWith('Z');
  if (!cstOrUtc(values.startsAt) || !cstOrUtc(values.endsAt)) {
    throw new Error('trip timestamps must use China Standard Time');
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
