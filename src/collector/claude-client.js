import { normalizeOrganizations, normalizeUsage } from './normalize.js';
import { makeEmptyState } from '../shared/model.js';

const ORGANIZATIONS_URL = 'https://claude.ai/api/organizations';
const REQUEST_OPTIONS = Object.freeze({
  credentials: 'include',
  headers: Object.freeze({ Accept: 'application/json' }),
});

function emptyState(status, diagnostic, now) {
  return makeEmptyState(status, diagnostic, now);
}

function isJsonResponse(response) {
  const contentType = response.headers?.get?.('content-type');
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

async function requestJson(fetchImpl, url) {
  const response = await fetchImpl(url, REQUEST_OPTIONS);

  if (response.status === 401 || response.status === 403) {
    return { kind: 'signed-out' };
  }
  if (!response.ok) {
    return { kind: 'network-error', diagnostic: 'HTTP_FAILURE' };
  }
  if (!isJsonResponse(response)) {
    return { kind: 'unsupported', diagnostic: 'NON_JSON_RESPONSE' };
  }

  try {
    return { kind: 'success', value: await response.json() };
  } catch {
    return { kind: 'unsupported', diagnostic: 'NON_JSON_RESPONSE' };
  }
}

function toState(result, now) {
  if (result.kind === 'signed-out') return emptyState('signed-out', 'SIGNED_OUT', now);
  if (result.kind === 'unsupported') return emptyState('unsupported', result.diagnostic, now);
  if (result.kind === 'network-error') return emptyState('network-error', result.diagnostic, now);
  return null;
}

export async function collectClaudeUsage(fetchImpl, now = new Date()) {
  try {
    const organizationsResult = await requestJson(fetchImpl, ORGANIZATIONS_URL);
    const organizationFailure = toState(organizationsResult, now);
    if (organizationFailure) return organizationFailure;

    const organization = normalizeOrganizations(organizationsResult.value);
    if (!organization) return emptyState('unsupported', 'ORGANIZATION_UNAVAILABLE', now);

    const usageUrl = `${ORGANIZATIONS_URL}/${encodeURIComponent(organization.organizationId)}/usage`;
    const usageResult = await requestJson(fetchImpl, usageUrl);
    const usageFailure = toState(usageResult, now);
    if (usageFailure) return usageFailure;

    return normalizeUsage(usageResult.value, now);
  } catch {
    return emptyState('network-error', 'NETWORK_FAILURE', now);
  }
}
