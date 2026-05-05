// JWT'i localStorage'da tutuyoruz; refresh token akışı v0.5'te eklenecek.

const TOKEN_KEY = 'mtl-ldap-admin:token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...init, headers })

  if (res.status === 401) {
    setToken(null)
    if (location.pathname !== '/login') location.href = '/login'
    throw new ApiError('oturum süresi doldu', 401)
  }

  if (res.status === 204) return undefined as T

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    const text = await res.text()
    if (!res.ok) throw new ApiError(text || res.statusText, res.status)
    return text as unknown as T
  }

  const body = await res.json()
  if (!res.ok) throw new ApiError(body.error || res.statusText, res.status)
  return body as T
}

// ---- Types ----
export type User = {
  dn: string
  uid: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  groups: string[]
  passwordChangedAt?: string
  accountLocked: boolean
  accountLockedTime?: string
  recentFailures: number
  disabled: boolean
}

export type Group = {
  dn: string
  cn: string
  description: string
  members: string[]
}

export type ConnectionInfo = {
  url: string
  type: 'ldaps' | 'starttls' | 'plain'
  tls: boolean
  warning?: string
}

export type Me = { user: User; role: 'admin' | 'user'; connection: ConnectionInfo }

export type AuditEntry = {
  id: number
  timestamp: string
  actor: string
  action: string
  target?: string
  ip?: string
  status: 'ok' | 'fail'
  details?: string
}

export type AuditList = { items: AuditEntry[]; total: number }

export type BulkResult = {
  uid: string
  status: 'ok' | 'failed'
  dn?: string
  error?: string
  generatedPassword?: string
}

export type BulkSummary = {
  results: BulkResult[]
  ok: number
  failed: number
}

export type TemplateConfig = {
  description?: string
  groups?: string[]
  defaultEmailDomain?: string
  passwordStrategy?: 'manual' | 'random'
  passwordLength?: number
  extraAttributes?: Record<string, string>
}

export type Template = {
  name: string
  config: TemplateConfig
  createdAt: string
  updatedAt: string
}

export type SchemaAttribute = {
  oid: string
  names: string[]
  description: string
  syntax?: string
  equality?: string
  substring?: string
  singleValue: boolean
  noUserMod: boolean
  usage?: string
  superType?: string
}

export type SchemaObjectClass = {
  oid: string
  names: string[]
  description: string
  kind: 'STRUCTURAL' | 'AUXILIARY' | 'ABSTRACT'
  superClass?: string[]
  must?: string[]
  may?: string[]
}

export type Schema = {
  attributes: SchemaAttribute[]
  objectClasses: SchemaObjectClass[]
}

export type TreeNode = {
  dn: string
  rdn: string
  objectClass: string[]
  hasChildren: boolean
  isContainer: boolean
}

export type RawEntry = {
  dn: string
  attributes: Record<string, string[]>
}

export type OU = {
  dn: string
  name: string
  description?: string
  parentDN: string
}

export type PosixInfo = {
  hasPosix: boolean
  uidNumber?: number
  gidNumber?: number
  homeDirectory?: string
  loginShell?: string
  gecos?: string
}

export type MFAStatus = {
  enabled: boolean
  hasSecret: boolean
  backupCodesRemaining: number
  required: boolean
}

export type MFAEnrollResponse = {
  secret: string
  otpauth: string
  issuer: string
  account: string
}

export type SelfServiceConfig = {
  methods: Array<'email' | 'sms' | 'questions'>
  enabled: boolean
}

export type SecurityQuestion = {
  index: number
  question: string
}

export type LoginResponse = {
  token?: string
  uid?: string
  role?: 'admin' | 'user'
  mfaRequired?: boolean
  challenge?: string
}

export type MonitorInfo = {
  available: boolean
  error?: string
  currentConnections: number
  totalConnections: number
  operations?: Record<string, number>
  statistics?: Record<string, number>
  threads?: { max: number; open: number; active: number; pending: number }
  replication?: Array<{
    dn: string
    description?: string
    uri?: string
    state?: string
    lastCSN?: string
    raw?: string[]
  }>
  contextCSN?: string
}

export type DashboardStats = {
  windowDays: number
  totalEvents: number
  loginSuccess: number
  loginFailed: number
  userCreated: number
  userDeleted: number
  passwordResets: number
  timeline: Array<{ date: string; logins: number; failures: number; mutations: number }>
  topActors: Array<{ actor: string; count: number }>
  recentFailures: AuditEntry[]
  actions: Array<{ action: string; count: number }>
  topFailedIPs: Array<{ ip: string; count: number }>
}

export type Webhook = {
  id: number
  name: string
  url: string
  kind: 'generic' | 'slack' | 'discord'
  events: string
  enabled: boolean
  createdAt: string
}

export type WebhookDelivery = {
  id: number
  webhookId: number
  timestamp: string
  action: string
  status: 'ok' | 'failed'
  httpStatus: number
  error?: string
}

// ---- Endpoints ----
export const api = {
  login: (uid: string, password: string) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ uid, password }),
    }),
  mfaVerify: (challenge: string, code?: string, backupCode?: string) =>
    request<LoginResponse>('/api/auth/mfa-verify', {
      method: 'POST',
      body: JSON.stringify({ challenge, code, backupCode }),
    }),

  // Self-service (public)
  selfServiceConfig: () => request<SelfServiceConfig>('/api/password-reset/config'),
  requestReset: (uid: string, method: 'email' | 'sms') =>
    request<{ status: string; message: string }>('/api/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ uid, method }),
    }),
  resetWithToken: (token: string, newPassword: string) =>
    request<void>('/api/password-reset/reset', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
  getPublicQuestions: (uid: string) =>
    request<{ items: SecurityQuestion[] }>(
      `/api/password-reset/questions?uid=${encodeURIComponent(uid)}`
    ),
  verifyQuestions: (uid: string, answers: string[], newPassword: string) =>
    request<void>('/api/password-reset/verify-questions', {
      method: 'POST',
      body: JSON.stringify({ uid, answers, newPassword }),
    }),

  // MFA (self)
  mfaStatus: () => request<MFAStatus>('/api/me/mfa'),
  mfaEnroll: () => request<MFAEnrollResponse>('/api/me/mfa/enroll', { method: 'POST' }),
  mfaEnable: (code: string) =>
    request<{ backupCodes: string[] }>('/api/me/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  mfaDisable: () => request<void>('/api/me/mfa', { method: 'DELETE' }),
  adminMFADisable: (uid: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/mfa`, { method: 'DELETE' }),

  // Security questions (self)
  myQuestions: () =>
    request<{ items: SecurityQuestion[] }>('/api/me/questions'),
  setMyQuestions: (questions: { question: string; answer: string }[]) =>
    request<void>('/api/me/questions', {
      method: 'PUT',
      body: JSON.stringify({ questions }),
    }),

  me: () => request<Me>('/api/me'),
  changeOwnPassword: (oldPassword: string, newPassword: string) =>
    request<void>('/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  listUsers: (q?: string) =>
    request<{ items: User[]; count: number }>(`/api/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getUser: (uid: string) => request<User>(`/api/users/${encodeURIComponent(uid)}`),
  createUser: (input: {
    uid: string
    firstName: string
    lastName: string
    email: string
    password: string
  }) =>
    request<{ dn: string; uid: string }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateUser: (
    uid: string,
    input: { firstName?: string; lastName?: string; email?: string }
  ) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  modifyUserAttributes: (
    uid: string,
    mod: {
      add?: Record<string, string[]>
      replace?: Record<string, string[]>
      delete?: Record<string, string[]>
    }
  ) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/attributes`, {
      method: 'PATCH',
      body: JSON.stringify(mod),
    }),
  deleteUser: (uid: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
  setUserPassword: (uid: string, newPassword: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  unlockUser: (uid: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/unlock`, { method: 'POST' }),
  // v0.9: kalıcı disable + OU taşıma + objectClass yönetimi
  disableUser: (uid: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/disable`, { method: 'POST' }),
  enableUser: (uid: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/enable`, { method: 'POST' }),
  moveUser: (uid: string, newParent: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/move`, {
      method: 'POST',
      body: JSON.stringify({ newParent }),
    }),
  modifyEntryObjectClasses: (
    dn: string,
    change: { add?: string[]; remove?: string[] }
  ) =>
    request<void>(
      `/api/entries/objectClasses?dn=${encodeURIComponent(dn)}`,
      { method: 'POST', body: JSON.stringify(change) }
    ),
  modifyEntry: (
    dn: string,
    mod: {
      add?: Record<string, string[]>
      replace?: Record<string, string[]>
      delete?: Record<string, string[]>
    }
  ) =>
    request<void>(`/api/entries/attributes?dn=${encodeURIComponent(dn)}`, {
      method: 'PATCH',
      body: JSON.stringify(mod),
    }),
  listContainerOUs: () =>
    request<{ items: string[] }>('/api/tree/containers'),
  replicationStatus: () =>
    request<{
      configured: boolean
      message: string
      providers: unknown[]
      consumers: unknown[]
    }>('/api/replication/status'),

  listGroups: (q?: string) =>
    request<{ items: Group[]; count: number }>(`/api/groups${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getGroup: (cn: string) => request<Group>(`/api/groups/${encodeURIComponent(cn)}`),
  createGroup: (input: { cn: string; description: string }) =>
    request<{ dn: string; cn: string }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteGroup: (cn: string) =>
    request<void>(`/api/groups/${encodeURIComponent(cn)}`, { method: 'DELETE' }),
  addGroupMember: (cn: string, uid: string) =>
    request<void>(`/api/groups/${encodeURIComponent(cn)}/members`, {
      method: 'POST',
      body: JSON.stringify({ uid }),
    }),
  removeGroupMember: (cn: string, uid: string) =>
    request<void>(`/api/groups/${encodeURIComponent(cn)}/members/${encodeURIComponent(uid)}`, {
      method: 'DELETE',
    }),

  importLDIF: async (file: File) => {
    const token = getToken()
    const res = await fetch('/api/ldif/import', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: file,
    })
    if (!res.ok) throw new ApiError(await res.text(), res.status)
    return res.json() as Promise<{ added: number; failed: number; errors?: string[] }>
  },
  exportLDIFUrl: () => '/api/ldif/export',

  serverInfo: () =>
    request<{ connection: ConnectionInfo; baseDN: string; version: string }>('/api/server-info'),

  listAudit: (params: {
    limit?: number
    offset?: number
    actor?: string
    action?: string
    status?: string
  } = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) q.set(k, String(v))
    })
    const qs = q.toString()
    return request<AuditList>(`/api/audit${qs ? `?${qs}` : ''}`)
  },

  // Bulk
  bulkCreateUsers: (
    users: Array<{
      uid: string
      firstName: string
      lastName: string
      email: string
      password: string
    }>,
    groupsToAddTo?: string[]
  ) =>
    request<BulkSummary>('/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({ users, groupsToAddTo }),
    }),
  bulkDeleteUsers: (uids: string[]) =>
    request<BulkSummary>('/api/users/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ uids }),
    }),
  bulkAddToGroup: (group: string, uids: string[]) =>
    request<BulkSummary>('/api/users/bulk-group-add', {
      method: 'POST',
      body: JSON.stringify({ group, uids }),
    }),
  bulkRemoveFromGroup: (group: string, uids: string[]) =>
    request<BulkSummary>('/api/users/bulk-group-remove', {
      method: 'POST',
      body: JSON.stringify({ group, uids }),
    }),
  bulkResetPasswords: (uids: string[], passwordLength = 16) =>
    request<BulkSummary>('/api/users/bulk-password-reset', {
      method: 'POST',
      body: JSON.stringify({ uids, passwordLength }),
    }),

  // Templates
  listTemplates: () =>
    request<{ items: Template[]; count: number }>('/api/templates'),
  getTemplate: (name: string) =>
    request<Template>(`/api/templates/${encodeURIComponent(name)}`),
  saveTemplate: (name: string, config: TemplateConfig) =>
    request<{ name: string }>(`/api/templates/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, config }),
    }),
  deleteTemplate: (name: string) =>
    request<void>(`/api/templates/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  applyTemplate: (
    name: string,
    input: { uid: string; firstName: string; lastName: string; email?: string; password?: string }
  ) =>
    request<{
      dn: string
      uid: string
      generatedPassword?: string
      groupsAdded?: string[]
      groupErrors?: Record<string, string>
    }>(`/api/templates/${encodeURIComponent(name)}/apply`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Schema
  getSchema: () => request<Schema>('/api/schema'),
  refreshSchema: () => request<void>('/api/schema/refresh', { method: 'POST' }),

  // Tree
  treeChildren: (dn?: string) => {
    const qs = dn ? `?dn=${encodeURIComponent(dn)}` : ''
    return request<{ items: TreeNode[]; count: number }>(`/api/tree/children${qs}`)
  },
  getEntry: (dn: string) =>
    request<RawEntry>(`/api/tree/entry?dn=${encodeURIComponent(dn)}`),

  // OU
  listOUs: () => request<{ items: OU[]; count: number }>('/api/ous'),
  createOU: (input: { name: string; parentDN?: string; description?: string }) =>
    request<{ dn: string }>('/api/ous', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteOU: (dn: string) =>
    request<void>('/api/ous', {
      method: 'DELETE',
      body: JSON.stringify({ dn }),
    }),

  // Posix
  getPosix: (uid: string) =>
    request<PosixInfo>(`/api/users/${encodeURIComponent(uid)}/posix`),
  setPosix: (
    uid: string,
    input: {
      uidNumber?: number
      gidNumber?: number
      homeDirectory?: string
      loginShell?: string
      gecos?: string
    }
  ) =>
    request<PosixInfo>(`/api/users/${encodeURIComponent(uid)}/posix`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  removePosix: (uid: string) =>
    request<void>(`/api/users/${encodeURIComponent(uid)}/posix`, { method: 'DELETE' }),
  nextUIDNumber: () => request<{ next: number }>('/api/posix/next-uid'),

  // Monitor & dashboard
  monitor: () => request<MonitorInfo>('/api/monitor'),
  stats: (days = 7) => request<DashboardStats>(`/api/stats?days=${days}`),

  // Webhooks
  listWebhooks: () => request<{ items: Webhook[] }>('/api/webhooks'),
  saveWebhook: (input: {
    name: string
    url: string
    kind: 'generic' | 'slack' | 'discord'
    secret?: string
    events?: string
    enabled: boolean
  }) =>
    request<Webhook>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteWebhook: (name: string) =>
    request<void>(`/api/webhooks/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  testWebhook: (name: string) =>
    request<void>(`/api/webhooks/${encodeURIComponent(name)}/test`, {
      method: 'POST',
    }),
  webhookDeliveries: (id: number, limit = 50) =>
    request<{ items: WebhookDelivery[] }>(`/api/webhooks/${id}/deliveries?limit=${limit}`),

  // ---- v0.10: SMTP / SMS / LDAPS / External audit ----
  getSMTPSettings: () =>
    request<SMTPSettingsView>('/api/settings/smtp'),
  updateSMTPSettings: (input: {
    enabled: boolean
    host: string
    port: number
    username: string
    password?: string
    from: string
    replyTo?: string
    startTLS: boolean
    clearPassword?: boolean
  }) =>
    request<SMTPSettingsView>('/api/settings/smtp', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  testSMTP: (to: string) =>
    request<void>('/api/settings/smtp/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  getSMSSettings: () => request<SMSSettingsView>('/api/settings/sms'),
  updateSMSSettings: (input: {
    enabled: boolean
    method: string
    urlTemplate: string
    bodyTemplate?: string
    contentType?: string
    authHeader?: string
    clearAuthHeader?: boolean
    successSubstring?: string
    messageTemplate: string
  }) =>
    request<SMSSettingsView>('/api/settings/sms', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  testSMS: (phone: string) =>
    request<void>('/api/settings/sms/test', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  getLDAPSStatus: () => request<LDAPSStatus>('/api/settings/ldaps'),
  uploadLDAPSCert: (input: {
    certPEM: string
    keyPEM: string
    caPEM?: string
    applyConfig: boolean
  }) =>
    request<LDAPSStatus>('/api/settings/ldaps/cert', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  externalAudit: () => request<ExternalAuditSnapshot>('/api/external-audit'),
}

// ---- v0.10 types ----

export type SMTPSettingsView = {
  enabled: boolean
  host: string
  port: number
  username: string
  hasPassword: boolean
  from: string
  replyTo?: string
  startTLS: boolean
}

export type SMSSettingsView = {
  enabled: boolean
  method: string
  urlTemplate: string
  bodyTemplate?: string
  contentType?: string
  hasAuthHeader: boolean
  successSubstring?: string
  messageTemplate: string
}

export type LDAPSStatus = {
  enabled: boolean
  certPath?: string
  keyPath?: string
  caCertPath?: string
  certSubject?: string
  certIssuer?: string
  certNotBefore?: string
  certNotAfter?: string
  uploadedAt?: number
  lastApplyError?: string
}

export type ExternalAuditEvent = {
  timestamp: string
  op: string
  reqDN: string
  reqAuthz: string
  result: string
  source: 'internal' | 'external'
}

export type ExternalAuditSnapshot = {
  available: boolean
  error?: string
  last24h: number
  last1h: number
  writeOps: number
  readOps: number
  recent: ExternalAuditEvent[]
  updatedAt: string
}
