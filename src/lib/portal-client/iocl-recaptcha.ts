/** IOCL beta portal reCAPTCHA v3 site key (from main-es2015 bundle). */
export const IOCL_RECAPTCHA_SITE_KEY = '6LcxXQcpAAAAAJ5PJ03v0fjVftHhDPC94Vd1X4cV';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Google reCAPTCHA.'));
    document.head.appendChild(script);
  });
}

/** Obtain IOCL login reCAPTCHA token in the operator browser. */
export async function getIoclRecaptchaToken(action = 'login'): Promise<string> {
  await loadScript(`https://www.google.com/recaptcha/api.js?render=${IOCL_RECAPTCHA_SITE_KEY}`);
  await new Promise<void>((resolve) => {
    if (!window.grecaptcha) {
      resolve();
      return;
    }
    window.grecaptcha.ready(() => resolve());
  });
  if (!window.grecaptcha) {
    throw new Error('Google reCAPTCHA did not initialize.');
  }
  const token = await window.grecaptcha.execute(IOCL_RECAPTCHA_SITE_KEY, { action });
  if (!token) throw new Error('Google reCAPTCHA returned an empty token.');
  return token;
}
