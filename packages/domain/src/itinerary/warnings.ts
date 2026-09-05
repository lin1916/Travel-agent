import type { ItineraryItem, ItineraryWarning, RouteEstimator } from '@travel/contracts';

export async function buildSoftWarnings(
  itinerary: ReadonlyArray<ItineraryItem>,
  routeEstimator: RouteEstimator,
): Promise<ItineraryWarning[]> {
  const confirmed = itinerary
    .filter(item => item.confirmed && item.category !== 'stay')
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const warnings: ItineraryWarning[] = [];

  for (let index = 1; index < confirmed.length; index += 1) {
    const previous = confirmed[index - 1];
    const current = confirmed[index];
    const fromCity = previous.location?.city ?? '';
    const toCity = current.location?.city ?? '';
    const route = await routeEstimator.estimate(
      fromCity,
      toCity,
      previous.endsAt,
    );
    const availableMinutes = (Date.parse(current.startsAt) - Date.parse(previous.endsAt)) / 60_000;
    if (availableMinutes < route.minutes) {
      warnings.push({
        code: 'transfer_tight',
        severity: 'warning',
        message: 'Travel time may exceed the available gap.',
      });
    }
    if (current.category === 'transport' && availableMinutes < 90) {
      warnings.push({
        code: 'airport_advance',
        severity: 'warning',
        message: 'Allow more advance time before departing by train or flight.',
      });
    }
  }

  const itemsByDay = new Map<string, number>();
  for (const item of confirmed) {
    const day = item.startsAt.slice(0, 10);
    itemsByDay.set(day, (itemsByDay.get(day) ?? 0) + 1);
  }
  if ([...itemsByDay.values()].some(count => count > 4)) {
    warnings.push({
      code: 'rhythm',
      severity: 'info',
      message: 'This day has a dense activity rhythm.',
    });
  }
  return warnings;
}
