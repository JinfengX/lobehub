/**
 * SCIM 2.0 API Endpoint — Stub for Enterprise SSO/SCIM integration
 *
 * SCIM (System for Cross-domain Identity Management) enables automatic
 * user provisioning and deprovisioning from identity providers like
 * Okta, Azure AD, Google Workspace, etc.
 *
 * Supported endpoints (to be fully implemented):
 * - GET  /api/scim/v2/Users         — List users
 * - GET  /api/scim/v2/Users/:id     — Get user by ID
 * - POST /api/scim/v2/Users         — Create user (provision)
 * - PUT  /api/scim/v2/Users/:id     — Replace user
 * - PATCH /api/scim/v2/Users/:id    — Update user
 * - DELETE /api/scim/v2/Users/:id   — Delete user (deprovision)
 * - GET  /api/scim/v2/Groups        — List groups
 * - POST /api/scim/v2/Groups        — Create group
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644
 */

import { NextResponse } from 'next/server';

const SCIM_CONTENT_TYPE = 'application/scim+json';

/**
 * Verify SCIM bearer token
 */
const verifyScimToken = (request: Request): boolean => {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  // TODO: Validate against workspace SCIM token stored in workspace settings
  // For now, check against env var
  const expectedToken = process.env.SCIM_BEARER_TOKEN;
  return !!expectedToken && token === expectedToken;
};

const scimError = (status: number, detail: string) => {
  return NextResponse.json(
    {
      detail,
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
    },
    {
      headers: { 'Content-Type': SCIM_CONTENT_TYPE },
      status,
    },
  );
};

/**
 * GET /api/scim/v2 — Service Provider Config / Users / Groups
 */
export async function GET(request: Request) {
  if (!verifyScimToken(request)) {
    return scimError(401, 'Unauthorized');
  }

  const url = new URL(request.url);
  const path = url.pathname.replace('/api/scim/v2', '');

  // Service Provider Config
  if (path === '' || path === '/') {
    return NextResponse.json(
      {
        authenticationSchemes: [
          {
            description: 'OAuth Bearer Token',
            name: 'OAuth Bearer Token',
            type: 'oauthbearertoken',
          },
        ],
        bulk: { maxOperations: 0, maxPayloadSize: 0, supported: false },
        changePassword: { supported: false },
        etag: { supported: false },
        filter: { maxResults: 100, supported: true },
        patch: { supported: true },
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
        sort: { supported: false },
      },
      { headers: { 'Content-Type': SCIM_CONTENT_TYPE } },
    );
  }

  // TODO: Implement /Users and /Groups list endpoints
  return scimError(501, `SCIM endpoint ${path} not yet implemented`);
}

/**
 * POST /api/scim/v2/Users — Create/provision user
 */
export async function POST(request: Request) {
  if (!verifyScimToken(request)) {
    return scimError(401, 'Unauthorized');
  }

  // TODO: Implement user provisioning
  return scimError(501, 'User provisioning not yet implemented');
}

/**
 * PATCH /api/scim/v2/Users/:id — Update user
 */
export async function PATCH(request: Request) {
  if (!verifyScimToken(request)) {
    return scimError(401, 'Unauthorized');
  }

  // TODO: Implement user update
  return scimError(501, 'User update not yet implemented');
}

/**
 * DELETE /api/scim/v2/Users/:id — Deprovision user
 */
export async function DELETE(request: Request) {
  if (!verifyScimToken(request)) {
    return scimError(401, 'Unauthorized');
  }

  // TODO: Implement user deprovisioning
  return scimError(501, 'User deprovisioning not yet implemented');
}
