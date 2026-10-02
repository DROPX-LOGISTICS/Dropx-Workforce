import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOut } from '@/app/login/actions';
import { DocumentTitle } from '@/components/document-title';
import { OwnerPreviewSwitcher } from '@/components/owner-preview-switcher';
import { UserMenu } from '@/components/user-menu';
import { getAuthorization, hasPermission } from '@/lib/authorization';
import styles from './workforce-onboarding-shell.module.css';

export async function WorkforceOnboardingShell({children, active}: {children: ReactNode; active: 'onboarding' | 'mapping'}) {
  const auth = await getAuthorization();
  if (!auth) redirect('/login');
  return <div className={styles.shell}>
    <DocumentTitle pageName={active === 'onboarding' ? 'Amazon onboarding' : 'ID review'} productName="DropX Workforce" />
    <header className={styles.header}>
      <Link className={styles.brand} href="/delivery-network/amazon-pilot"><Image src="/amazon-pilot-logo.png" alt="DropX" width={110} height={38}/><span>Workforce<small>Amazon onboarding</small></span></Link>
      <nav aria-label="Workforce">{hasPermission(auth,'delivery_associates','access') ? <Link aria-current={active==='onboarding'?'page':undefined} href="/delivery-network/amazon-pilot">Onboarding</Link> : null}{hasPermission(auth,'provider_mapping','access') ? <Link aria-current={active==='mapping'?'page':undefined} href="/delivery-network/rate-mapping">ID review</Link> : null}</nav>
      <div className={styles.actions}>{auth.canPreviewUsers ? <OwnerPreviewSwitcher active={Boolean(auth.isPreview)} name={auth.fullName??'user'}/> : null}<UserMenu action={signOut} email={auth.email} name={auth.fullName??auth.email??'DropX user'} role={auth.designationName??auth.roleName}/></div>
    </header>
    {auth.isPreview ? <div className="owner-preview-banner"><strong>Read-only user preview</strong><span>You are viewing as {auth.fullName}. Exit preview to make changes.</span></div> : null}
    <div className={styles.content}>{children}</div>
  </div>;
}
