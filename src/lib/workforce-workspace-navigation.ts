import type { NavItem } from './app-navigation';

/** Regroup only the links AppShell has already authorized. No fallback may add a link. */
export function compactWorkspaces(items: NavItem[]): NavItem[] {
  const groups = [
    { label: 'Today', sources: ['Workforce Dashboard'] },
    { label: 'Associates', sources: ['Associates', 'IDs & rates'] },
    { label: 'Operations', sources: ['Attendance & routes', 'Reports'] },
    { label: 'Pay & settlement', sources: ['Payments'] },
    { label: 'Connect', sources: ['Connect'] },
    { label: 'Settings', sources: ['Master', 'Settings', 'User access'] }
  ];
  const prominent = new Set([
    '/delivery-network/associates', '/delivery-network/joining',
    '/delivery-network/rate-mapping', '/delivery-network/rate-cards',
    '/delivery-network/id-onboarding', '/master/payment-methods',
    '/delivery-network/training-policies', '/delivery-network/payroll-calendars',
    '/users?section=users'
  ]);
  return groups.flatMap(group => {
    const sources = group.sources.flatMap(label => items.filter(item => item.label === label));
    if (!sources.length) return [];
    if (group.sources[0] === 'Workforce Dashboard') return [{ ...sources[0], label: group.label }];
    const children = sources.flatMap(item => item.children ?? [{ code: item.code, href: item.href, label: item.label }])
      .map(child => ({ ...child, secondary: group.label === 'Associates' || group.label === 'Settings'
        ? !prominent.has(child.href ?? '') : child.secondary }));
    return [{ ...sources[0], label: group.label, href: undefined, children }];
  });
}

function routePath(href: string) { return href.split(/[?#]/)[0]; }

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
    '/delivery-network/pooled-settlements':'Payments','/delivery-network/contractor-profiles':'Associates'
  };
  const relatedLabel = related[pathname] === 'Payments' ? 'Pay & settlement' : related[pathname];
  const relatedWorkspace=items.find(item=>item.label===relatedLabel || item.label===related[pathname]);
  if(relatedWorkspace)return relatedWorkspace;
  const matches = items.flatMap(item => [item, ...(item.children ?? [])]
    .filter(link => link.href && (pathname === routePath(link.href) || pathname.startsWith(routePath(link.href) + '/')))
    .map(link => ({ item, length: routePath(link.href!).length })));
  return matches.sort((a, b) => b.length - a.length)[0]?.item
    ?? items.find(item => item.label === active || item.children?.some(child => child.label === active));
}
