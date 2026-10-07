import { describe, expect, it } from 'vitest';
import { decodedPath, extractToken, isAllowedHost, isAllowedOrigin, requiresToken, routeNeedsToken, tokenMatches } from '../server/security';

describe('isAllowedHost', () => {
  it('allows loopback names on the right port only', () => {
    expect(isAllowedHost('127.0.0.1:4317', 4317)).toBe(true);
    expect(isAllowedHost('localhost:4317', 4317)).toBe(true);
    expect(isAllowedHost('127.0.0.1:4318', 4317)).toBe(false);
    expect(isAllowedHost('evil.com', 4317)).toBe(false);
    expect(isAllowedHost('localhost:4317.evil.com', 4317)).toBe(false);
    expect(isAllowedHost(undefined, 4317)).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  it('allows absent origin (CLI) and same-origin browsers', () => {
    expect(isAllowedOrigin(undefined, 4317)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4317', 4317)).toBe(true);
    expect(isAllowedOrigin('http://localhost:4317', 4317)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isAllowedOrigin('http://evil.com', 4317)).toBe(false);
    expect(isAllowedOrigin('null', 4317)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:9999', 4317)).toBe(false);
  });
});

describe('tokenMatches', () => {
  it('compares exactly', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
    expect(tokenMatches('ab', 'abc')).toBe(false);
    expect(tokenMatches(undefined, 'abc')).toBe(false);
    expect(tokenMatches('', 'abc')).toBe(false);
  });
});

describe('extractToken', () => {
  it('prefers the header, falls back to ?t=', () => {
    expect(extractToken({ 'x-cos-token': 'h' }, '/api/tasks?t=q')).toBe('h');
    expect(extractToken({}, '/ws?t=q')).toBe('q');
    expect(extractToken({}, '/api/tasks')).toBeUndefined();
  });
  it('never throws on an unparseable URL', () => {
    expect(extractToken({}, '//[')).toBeUndefined();
  });
});

describe('requiresToken', () => {
  it('guards api, ws and mcp but not static assets', () => {
    expect(requiresToken('/api/tasks')).toBe(true);
    expect(requiresToken('/ws?t=1')).toBe(true);
    expect(requiresToken('/mcp?chat=x')).toBe(true);
    expect(requiresToken('/')).toBe(false);
    expect(requiresToken('/assets/index.js')).toBe(false);
  });
});

describe('requiresToken decoding', () => {
  it('decodes before deciding, and treats undecodable paths as protected', () => {
    expect(requiresToken('/%61pi/tasks')).toBe(true);
    expect(requiresToken('/api%2Ftasks')).toBe(true);
    expect(requiresToken('/%77s')).toBe(true);
    expect(requiresToken('/%6Dcp?chat=x')).toBe(true);
    expect(requiresToken('/%E0%A4%A')).toBe(true);
    expect(requiresToken('//[')).toBe(true);
    expect(requiresToken('/tasks')).toBe(false);
  });
  it('decodedPath returns null instead of throwing', () => {
    expect(decodedPath('/%61pi')).toBe('/api');
    expect(decodedPath('/%E0%A4%A')).toBeNull();
  });
});

describe('routeNeedsToken', () => {
  it('only exempts GET/HEAD on the static wildcard or not-found', () => {
    expect(routeNeedsToken('GET', undefined)).toBe(false);
    expect(routeNeedsToken('HEAD', '/*')).toBe(false);
    expect(routeNeedsToken('GET', '/*')).toBe(false);
    expect(routeNeedsToken('GET', '/api/tasks')).toBe(true);
    expect(routeNeedsToken('GET', '/ws')).toBe(true);
    expect(routeNeedsToken('POST', '/mcp')).toBe(true);
    expect(routeNeedsToken('POST', undefined)).toBe(true);
    expect(routeNeedsToken('OPTIONS', '/*')).toBe(true);
  });
});
