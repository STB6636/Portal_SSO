import { describe, expect, it } from 'vitest';
import { resolveRouterConfig } from '@/lib/routerMode';

describe('routerMode (Dual-Hosting Dynamic Router)', () => {
  it('uses browser router with root basename for Cloudflare Pages', () => {
    expect(resolveRouterConfig('browser', '/', 'portal-sso.pages.dev')).toEqual({
      mode: 'browser',
      basename: '/',
    });
  });

  it('uses hash router with normalized /Portal_SSO basename for GitHub Pages', () => {
    expect(resolveRouterConfig('hash', '/Portal_SSO/', 'stb6636.github.io')).toEqual({
      mode: 'hash',
      basename: '/Portal_SSO',
    });
  });

  it('auto-detects hash mode on *.github.io and browser mode on custom/Pages domains when env unset', () => {
    expect(resolveRouterConfig('', './', 'stb6636.github.io')).toEqual({
      mode: 'hash',
      basename: '/',
    });
    expect(resolveRouterConfig('', '/', 'portal.bangkok.go.th')).toEqual({
      mode: 'browser',
      basename: '/',
    });
  });
});
