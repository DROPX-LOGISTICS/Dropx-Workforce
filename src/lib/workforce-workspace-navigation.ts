import type { NavItem } from './app-navigation';

/** Regroup only the links AppShell has already authorized. No fallback may add a link. */
export function compactWorkspaces(items: NavItem[]): NavItem[] {
  const groups = [
    { label: 'Today', sources: ['Workforce Dashboard'] },
    { label: 'Onboarding', sources: ['Onboarding'] },
    { label: 'Associates', sources: ['Associates', 'Attendance & routes', 'Reports', 'Connect'] },
    { label: 'Referrals', sources: ['Referrals'] },
    { label: 'Pay & settlement', sources: ['Payments'] },
    { label: 'Settings', sources: ['Master', 'Settings', 'User access'] }
  ];
  const prominent = new Set([
    '/delivery-network/onboarding?area=registration',
    '/delivery-network/onboarding?area=client',
    '/delivery-network/rate-mapping',
    '/delivery-network/onboarding/associates',
    '/delivery-network/amazon-lifecycle?view=not_onboarded',
    '/delivery-network/amazon-lifecycle?view=idfy',
    '/delivery-network/associates',
    '/master/payment-methods', '/delivery-network/amazon-onboarding-settings',
    '/delivery-network/payroll-calendars',
    '/users?section=users'
  ]);
  return groups.flatMap(group => {
    const sources = group.sources.flatMap(label => items.filter(item => item.label === label));
    if (!sources.length) return [];
    if (group.sources[0] === 'Workforce Dashboard') return [{ ...sources[0], label: group.label }];
    if (sources.length === 1 && !sources[0].children?.length) return [{ ...sources[0], label: group.label }];
    if (sources.length === 1 && !sources[0].href && sources[0].children?.length === 1 && !sources[0].children[0].secondary) {
      return [{ ...sources[0], label: group.label, href: sources[0].children[0].href, children: undefined }];
    }
    const children = sources.flatMap(item => item.children ?? [{ code: item.code, href: item.href, label: item.label }])
      .map(child => ({ ...child, secondary: group.label === 'Settings' || group.label === 'Associates'
        ? !prominent.has(child.href ?? '') : child.secondary }));
    return [{ ...sources[0], label: group.label, href: sources.length === 1 ? sources[0].href : undefined, children }];
  });
}

function routePath(href: string) { return href.split(/[?#]/)[0]; }

export function lifecyclePhaseDestination(phase: string) {
  if (phase === 'active') return '/delivery-network/associates';
  if (phase === 'closed') return '/delivery-network/lifecycle?view=closed';
  if (phase === 'registration') return '/delivery-network/onboarding?area=registration&stage=registration';
  if (phase === 'review') return '/delivery-network/onboarding?area=registration&stage=review';
  if (phase === 'mapping') return '/delivery-network/onboarding?area=client&status=mapping';
  if (phase === 'pay') return '/delivery-network/rate-mapping';
  return '/delivery-network/onboarding?area=client';
}

export function workspaceLinkActive(href: string | undefined, pathname: string, search: string) {
  if (!href || routePath(href) !== pathname) return false;
  const expected = new URLSearchParams(href.split('?')[1]?.split('#')[0] ?? '');
  const current = new URLSearchParams(search);
  return [...expected].every(([key, value]) => current.get(key) === value);
}

/** Inputs are already permission-filtered by AppShell. Never invent fallback links. */
export function workspaceDestination(item: NavItem) {
  return item.href ?? item.children?.find(child => child.href)?.href;
}

export function activeWorkspace(items: NavItem[], pathname: string, active: string) {
  const related:Record<string,string>={
    '/delivery-network/payment-holds':'Payments','/delivery-network/mileage':'Payments',
    '/delivery-network/pooled-settlements':'Payments','/delivery-network/contractor-profiles':'Associates',
    '/delivery-network/lifecycle':'Associates','/delivery-network/id-onboarding':'Onboarding',
    '/delivery-network/amazon-lifecycle':'Onboarding',
    '/delivery-network/rate-mapping':'Onboarding','/delivery-network/rate-cards':'Onboarding',
    '/delivery-network/onboarding':'Onboarding','/delivery-network/referrals':'Referrals','/delivery-network/attention':'Associates'
  };
  const relatedPath = Object.keys(related)
    .filter(path => pathname === path || pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  const relatedSource = relatedPath ? related[relatedPath] : undefined;
  const relatedLabel = relatedSource === 'Payments' ? 'Pay & settlement' : relatedSource;
  const relatedWorkspace=items.find(item=>item.label===relatedLabel || item.label===relatedSource);
  if(relatedWorkspace)return relatedWorkspace;
  const matches = items.flatMap(item => [item, ...(item.children ?? [])]
    .filter(link => link.href && (pathname === routePath(link.href) || pathname.startsWith(routePath(link.href) + '/')))
    .map(link => ({ item, length: routePath(link.href!).length })));
  return matches.sort((a, b) => b.length - a.length)[0]?.item
    ?? items.find(item => item.label === active || item.children?.some(child => child.label === active));
}
