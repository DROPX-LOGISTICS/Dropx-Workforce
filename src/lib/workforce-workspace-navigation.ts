import type { NavItem } from './app-navigation';

/** Inputs are already permission-filtered by AppShell. Never invent fallback links. */
export function workspaceDestination(item: NavItem) {
  return item.href ?? item.children?.find(child => child.href)?.href;
}

export function activeWorkspace(items: NavItem[], pathname: string, active: string) {
  const related:Record<string,string>={
    '/delivery-network/payment-holds':'Payments','/delivery-network/mileage':'Payments',
    '/delivery-network/pooled-settlements':'Payments','/delivery-network/contractor-profiles':'Associates'
  };
  const relatedWorkspace=items.find(item=>item.label===related[pathname]);
  if(relatedWorkspace)return relatedWorkspace;
  const matches = items.flatMap(item => [item, ...(item.children ?? [])]
    .filter(link => link.href && (pathname === link.href.split('?')[0] || pathname.startsWith(link.href.split('?')[0] + '/')))
    .map(link => ({ item, length: link.href!.split('?')[0].length })));
  return matches.sort((a, b) => b.length - a.length)[0]?.item
    ?? items.find(item => item.label === active || item.children?.some(child => child.label === active));
}
