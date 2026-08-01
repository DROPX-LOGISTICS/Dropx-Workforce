type OnboardingLocation = {
  id: string;
  hide_from_location_list?: boolean | null;
};

type LocationAuthorization = {
  hasAllLocationAccess: boolean;
  locationScopeIds: string[];
};

export function filterOnboardingLocations<T extends OnboardingLocation>(
  locations: T[],
  authorization: LocationAuthorization
) {
  if (authorization.hasAllLocationAccess) {
    return locations.filter((location) => !location.hide_from_location_list);
  }

  const allowedIds = new Set(authorization.locationScopeIds);
  return locations.filter((location) => allowedIds.has(location.id));
}
