# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Mutlu Erol
"""Pydantic şema toplama — Tur 4 dahil."""

from app.schemas.admins import (
    AdminCreateRequest,
    AdminListResponse,
    AdminPublicFull,
    AdminRoleAssignRequest,
    AdminUpdateRequest,
)
from app.schemas.alert import (
    AlertAckRequest,
    AlertEventListResponse,
    AlertEventPublic,
    AlertResolveRequest,
    AlertRulePublic,
    AlertRuleUpdateRequest,
)
from app.schemas.audit import (
    AuditEventListResponse,
    AuditSummary,
    AuditSummaryBucket,
    EventLogPublic,
)
from app.schemas.auth import (
    AdminPublic,
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    MfaChallengeRequest,
    MfaSetupResponse,
    MfaVerifyRequest,
    RefreshRequest,
    RolePublic,
    TokenPair,
)
from app.schemas.cluster import (
    ClusterNodePublic,
    ClusterStatusSummary,
    HeartbeatRequest,
    HeartbeatResponse,
    NodeRegisterRequest,
    SyncQueueItem,
    SyncReceiveRequest,
)
from app.schemas.groups import (
    GroupCreateRequest,
    GroupListResponse,
    GroupMemberRequest,
    GroupPublic,
    GroupUpdateRequest,
)
from app.schemas.rbac import (
    ModuleGroupedPermissions,
    PermissionListResponse,
    PermissionPublic,
    RoleDetailPublic,
    RoleListResponse,
)
from app.schemas.rbac_mutation import (
    PermissionCreateRequest,
    RoleCreateRequest,
    RolePermissionLinkRequest,
    RoleUpdateRequest,
)
from app.schemas.sync import (
    SyncDiscrepancyPublic,
    SyncResolveRequest,
    SyncStatusSummary,
)
from app.schemas.users import (
    AdminPasswordResetRequest,
    BulkImportJobPublic,
    BulkUserCreateRequest,
    BulkUserItem,
    PasswordChangeRequest,
    UserCreateRequest,
    UserListResponse,
    UserPublic,
    UserUpdateRequest,
)
from app.schemas.password_reset import (
    EndUserChangePasswordRequest,
    EndUserLoginRequest,
    EndUserLoginResponse,
    EndUserMfaChallenge,
    EndUserMfaSetupResponse,
    EndUserMfaVerifyRequest,
    EndUserPublic,
    PasswordPolicy,
    ResetCompletePayload,
    ResetCompleteResponse,
    ResetRequestPayload,
    ResetRequestResponse,
    ResetVerifyPayload,
    ResetVerifyResponse,
)

from app.schemas.users_bulk import (
    BulkUserDeleteRequest,
    BulkUserUpdateItem,
    BulkUserUpdateRequest,
)

__all__ = [
    # auth
    "AdminPublic", "ChangePasswordRequest", "LoginRequest", "LoginResponse",
    "LogoutRequest", "MfaChallengeRequest", "MfaSetupResponse", "MfaVerifyRequest",
    "RefreshRequest", "RolePublic", "TokenPair",
    # users
    "AdminPasswordResetRequest", "BulkImportJobPublic", "BulkUserCreateRequest",
    "BulkUserItem", "PasswordChangeRequest", "UserCreateRequest",
    "UserListResponse", "UserPublic", "UserUpdateRequest",
    # users bulk (Tur 4)
    "BulkUserDeleteRequest", "BulkUserUpdateItem", "BulkUserUpdateRequest",
    # groups
    "GroupCreateRequest", "GroupListResponse", "GroupMemberRequest",
    "GroupPublic", "GroupUpdateRequest",
    # admins
    "AdminCreateRequest", "AdminListResponse", "AdminPublicFull",
    "AdminRoleAssignRequest", "AdminUpdateRequest",
    # rbac
    "ModuleGroupedPermissions", "PermissionListResponse", "PermissionPublic",
    "RoleDetailPublic", "RoleListResponse",
    # rbac mutation (Tur 4)
    "PermissionCreateRequest", "RoleCreateRequest",
    "RolePermissionLinkRequest", "RoleUpdateRequest",
    # sync
    "SyncDiscrepancyPublic", "SyncResolveRequest", "SyncStatusSummary",
    # audit (Tur 4)
    "AuditEventListResponse", "AuditSummary", "AuditSummaryBucket", "EventLogPublic",
    # cluster (Tur 4)
    "ClusterNodePublic", "ClusterStatusSummary", "HeartbeatRequest",
    "HeartbeatResponse", "NodeRegisterRequest", "SyncQueueItem", "SyncReceiveRequest",
    # alert (Tur 4)
    "AlertAckRequest", "AlertEventListResponse", "AlertEventPublic",
    "AlertResolveRequest", "AlertRulePublic", "AlertRuleUpdateRequest",
]
