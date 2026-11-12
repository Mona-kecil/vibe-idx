import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { useLocale } from './locale';

export function SignInButton() {
  const { signIn, isLoading } = useAuth();
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={isLoading}
        onClick={() => {
          const path = window.location.pathname;
          if (/^(?:\/|\/stocks|\/market|\/t\/[A-Z0-9-]+)$/.test(path))
            window.sessionStorage.setItem('vibe-idx-return-to', path);
          void signIn().catch(() => setFailed(true));
        }}
      >
        {t('Sign in')}
      </button>
      {failed ? <p role="alert">{t('Could not sign in. Try again.')}</p> : null}
    </>
  );
}

export function AccountControls() {
  const { user, signOut } = useAuth();
  const { t } = useLocale();
  return user ? (
    <>
      <span>{user.email}</span>
      <button type="button" onClick={() => signOut({ returnTo: window.location.origin })}>
        {t('Sign out')}
      </button>
    </>
  ) : (
    <SignInButton />
  );
}

export function CompactAccountControls() {
  const { user, signOut } = useAuth();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (e.target instanceof Node && !box.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('click', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!user) return <SignInButton />;
  return (
    <div className="account-menu" ref={box}>
      <button
        type="button"
        className="avatar"
        aria-label={t('Account')}
        aria-expanded={open}
        aria-controls="account-popover"
        onClick={() => setOpen(!open)}
      >
        {user.email?.[0]?.toUpperCase() ?? '?'}
      </button>
      {open && (
        <div className="account-popover" id="account-popover">
          <span>{user.email}</span>
          <button type="button" onClick={() => signOut({ returnTo: window.location.origin })}>
            {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  );
}

export function LoginPage() {
  const { signIn, isLoading } = useAuth();
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isLoading) void signIn().catch(() => setFailed(true));
  }, [isLoading, signIn]);
  return failed ? (
    <div role="alert">
      {t('Could not sign in. Try again.')} <SignInButton />
    </div>
  ) : (
    <p role="status">{t('Signing you in…')}</p>
  );
}
