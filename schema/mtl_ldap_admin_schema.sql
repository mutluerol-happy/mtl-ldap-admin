-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Mutlu Erol
--
-- ============================================================
-- MTL LDAP Admin — Master PostgreSQL Şeması
-- ============================================================
-- Bu dosya master sunucusu için tüm tabloları oluşturur.
-- Önkoşul: 
--   CREATE DATABASE mtl_admin;
--   CREATE USER mtl_admin WITH PASSWORD '...';
--   GRANT ALL ON DATABASE mtl_admin TO mtl_admin;
-- ============================================================

-- Schemas
CREATE SCHEMA IF NOT EXISTS mtl_core;
CREATE SCHEMA IF NOT EXISTS mtl_audit;
CREATE SCHEMA IF NOT EXISTS mtl_signal;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- mtl_core
-- ============================================================

-- Uygulama yöneticileri
CREATE TABLE mtl_core.admin_account (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username              text NOT NULL UNIQUE,
    display_name          text NOT NULL,
    email                 text NOT NULL UNIQUE,
    password_hash         text NOT NULL,
    mfa_enabled           boolean NOT NULL DEFAULT false,
    mfa_secret_encrypted  text,
    is_active             boolean NOT NULL DEFAULT true,
    last_login_at         timestamptz,
    failed_login_count    integer NOT NULL DEFAULT 0,
    locked_until          timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_account_email ON mtl_core.admin_account (email);
CREATE INDEX idx_admin_account_active ON mtl_core.admin_account (is_active);

-- Roller
CREATE TABLE mtl_core.role (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL UNIQUE,
    description  text,
    is_system    boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Yetkiler
CREATE TABLE mtl_core.permission (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL UNIQUE,
    module       text NOT NULL,
    description  text
);
CREATE INDEX idx_permission_module ON mtl_core.permission (module);

-- Rol-Yetki ilişkisi
CREATE TABLE mtl_core.role_permission (
    role_id        uuid NOT NULL REFERENCES mtl_core.role(id) ON DELETE CASCADE,
    permission_id  uuid NOT NULL REFERENCES mtl_core.permission(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Yönetici-Rol ataması
CREATE TABLE mtl_core.admin_role (
    admin_id   uuid NOT NULL REFERENCES mtl_core.admin_account(id) ON DELETE CASCADE,
    role_id    uuid NOT NULL REFERENCES mtl_core.role(id) ON DELETE CASCADE,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (admin_id, role_id)
);

-- Oturumlar (Redis ile paralel, kalıcı kayıt için)
CREATE TABLE mtl_core.session (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type  text NOT NULL CHECK (subject_type IN ('ADMIN', 'END_USER')),
    subject_id    text NOT NULL,
    token_hash    text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    ip_address    inet,
    user_agent    text,
    country_code  char(2),
    is_revoked    boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_session_subject ON mtl_core.session (subject_type, subject_id);
CREATE INDEX idx_session_token_hash ON mtl_core.session (token_hash);
CREATE INDEX idx_session_expires ON mtl_core.session (expires_at);

-- MFA bekleyen kayıtlar
CREATE TABLE mtl_core.mfa_pending_enrollment (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type    text NOT NULL,
    subject_id      text NOT NULL,
    secret_encrypted text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL
);

-- Parola sıfırlama tokenleri
CREATE TABLE mtl_core.password_reset_token (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_dn  text NOT NULL,
    channel     text NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'OTP')),
    token_hash  text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    ip_address  inet
);
CREATE INDEX idx_pwd_reset_subject ON mtl_core.password_reset_token (subject_dn);

-- Ayarlar
CREATE TABLE mtl_core.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    category    text NOT NULL,
    is_secret   boolean NOT NULL DEFAULT false,
    description text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid REFERENCES mtl_core.admin_account(id)
);
CREATE INDEX idx_settings_category ON mtl_core.settings (category);

-- IP erişim listesi
CREATE TABLE mtl_core.ip_access_list (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cidr       cidr NOT NULL,
    mode       text NOT NULL CHECK (mode IN ('ALLOW', 'BLOCK')),
    reason     text,
    expires_at timestamptz,
    created_by uuid REFERENCES mtl_core.admin_account(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ip_access_mode ON mtl_core.ip_access_list (mode);

-- Cluster topolojisi
CREATE TABLE mtl_core.cluster_node (
    node_id           text PRIMARY KEY,
    role              text NOT NULL CHECK (role IN ('MASTER', 'SLAVE')),
    host              text NOT NULL,
    ldap_port         integer NOT NULL DEFAULT 389,
    ldaps_port        integer NOT NULL DEFAULT 636,
    api_url           text,
    last_seen_at      timestamptz,
    last_context_csn  text,
    health_status     text NOT NULL DEFAULT 'UNKNOWN' 
                      CHECK (health_status IN ('HEALTHY', 'DEGRADED', 'UNREACHABLE', 'UNKNOWN')),
    is_self           boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Sertifika envanteri
CREATE TABLE mtl_core.certificate_inventory (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text NOT NULL,
    type                text NOT NULL CHECK (type IN ('SERVER', 'CA', 'CLIENT')),
    pem_data            text NOT NULL,
    serial_number       text NOT NULL,
    subject             text NOT NULL,
    issuer              text NOT NULL,
    not_before          timestamptz NOT NULL,
    not_after           timestamptz NOT NULL,
    fingerprint_sha256  text NOT NULL UNIQUE,
    is_active           boolean NOT NULL DEFAULT false,
    uploaded_by         uuid REFERENCES mtl_core.admin_account(id),
    uploaded_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cert_active ON mtl_core.certificate_inventory (is_active);
CREATE INDEX idx_cert_expiry ON mtl_core.certificate_inventory (not_after);

-- API token'lar
CREATE TABLE mtl_core.api_token (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    token_hash   text NOT NULL UNIQUE,
    prefix       text NOT NULL,
    scopes       text[] NOT NULL DEFAULT '{}',
    created_by   uuid REFERENCES mtl_core.admin_account(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz,
    last_used_at timestamptz,
    is_revoked   boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_api_token_revoked ON mtl_core.api_token (is_revoked);

-- Webhook abonelikleri
CREATE TABLE mtl_core.webhook_subscription (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url             text NOT NULL,
    events          text[] NOT NULL DEFAULT '{}',
    secret          text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    last_status     integer,
    last_attempt_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Yedek kayıtları
CREATE TABLE mtl_core.backup_record (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type            text NOT NULL CHECK (type IN ('MANUAL', 'SCHEDULED')),
    scope           text NOT NULL CHECK (scope IN ('LDAP_ONLY', 'DB_ONLY', 'FULL')),
    file_path       text,
    file_size_bytes bigint,
    sha256          text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid REFERENCES mtl_core.admin_account(id),
    status          text NOT NULL DEFAULT 'RUNNING'
                    CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED'))
);
CREATE INDEX idx_backup_created ON mtl_core.backup_record (created_at DESC);

-- Metrik örnekleri (time-series)
CREATE TABLE mtl_core.metric_sample (
    metric_name  text NOT NULL,
    labels       jsonb NOT NULL DEFAULT '{}'::jsonb,
    sampled_at   timestamptz NOT NULL,
    value        double precision NOT NULL,
    server_node  text NOT NULL
);
CREATE INDEX idx_metric_name_time ON mtl_core.metric_sample (metric_name, sampled_at DESC);
CREATE INDEX idx_metric_node_time ON mtl_core.metric_sample (server_node, sampled_at DESC);
CREATE INDEX idx_metric_labels ON mtl_core.metric_sample USING GIN (labels);

-- Alarm kuralları
CREATE TABLE mtl_core.alert_rule (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL,
    metric_name       text NOT NULL,
    label_filters     jsonb NOT NULL DEFAULT '{}'::jsonb,
    condition         text NOT NULL CHECK (condition IN ('gt', 'lt', 'eq', 'absent')),
    threshold         double precision NOT NULL,
    duration_seconds  integer NOT NULL DEFAULT 60,
    severity          text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    channels          text[] NOT NULL DEFAULT '{INAPP}',
    template_code     text,
    is_active         boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Aktif alarmlar
CREATE TABLE mtl_core.alert (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id          uuid REFERENCES mtl_core.alert_rule(id),
    started_at       timestamptz NOT NULL DEFAULT now(),
    resolved_at      timestamptz,
    acknowledged_at  timestamptz,
    acknowledged_by  uuid REFERENCES mtl_core.admin_account(id),
    severity         text NOT NULL,
    title            text NOT NULL,
    details          jsonb NOT NULL DEFAULT '{}'::jsonb,
    server_node      text NOT NULL
);
CREATE INDEX idx_alert_active ON mtl_core.alert (resolved_at) WHERE resolved_at IS NULL;

-- Çift onay gerektiren işlemler
CREATE TABLE mtl_core.approval_request (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation           text NOT NULL,
    payload             jsonb NOT NULL,
    requested_by        uuid NOT NULL REFERENCES mtl_core.admin_account(id),
    requested_at        timestamptz NOT NULL DEFAULT now(),
    approved_by         uuid REFERENCES mtl_core.admin_account(id),
    approved_at         timestamptz,
    status              text NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED')),
    expires_at          timestamptz NOT NULL,
    result_details      jsonb
);

-- ============================================================
-- mtl_audit
-- ============================================================

CREATE TABLE mtl_audit.event_log (
    id               bigserial PRIMARY KEY,
    occurred_at      timestamptz NOT NULL,
    received_at      timestamptz NOT NULL DEFAULT now(),
    server_node      text NOT NULL,
    category         text NOT NULL,
    event_code       text NOT NULL,
    severity         text NOT NULL DEFAULT 'INFO'
                     CHECK (severity IN ('INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL')),
    actor_type       text CHECK (actor_type IN ('ADMIN', 'END_USER', 'SERVICE', 'SYSTEM')),
    actor_id         text,
    actor_display    text,
    target_type      text,
    target_id        text,
    target_display   text,
    ip_address       inet,
    user_agent       text,
    country_code     char(2),
    request_id       uuid,
    details          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_audit_occurred ON mtl_audit.event_log (occurred_at DESC);
CREATE INDEX idx_audit_server_time ON mtl_audit.event_log (server_node, occurred_at DESC);
CREATE INDEX idx_audit_category_time ON mtl_audit.event_log (category, occurred_at DESC);
CREATE INDEX idx_audit_code ON mtl_audit.event_log (event_code);
CREATE INDEX idx_audit_actor ON mtl_audit.event_log (actor_id);
CREATE INDEX idx_audit_target ON mtl_audit.event_log (target_id);
CREATE INDEX idx_audit_request ON mtl_audit.event_log (request_id);
CREATE INDEX idx_audit_details ON mtl_audit.event_log USING GIN (details);

-- Append-only zorunlama
CREATE OR REPLACE FUNCTION mtl_audit.prevent_event_modifications()
RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION 'mtl_audit.event_log kayıtları append-only''dir';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_modify
BEFORE UPDATE OR DELETE ON mtl_audit.event_log
FOR EACH ROW EXECUTE FUNCTION mtl_audit.prevent_event_modifications();

-- Arşiv işaretleyici
CREATE TABLE mtl_audit.event_log_archive (
    partition_name  text PRIMARY KEY,
    period_start    timestamptz NOT NULL,
    period_end      timestamptz NOT NULL,
    file_path       text,
    sha256          text,
    archived_at     timestamptz NOT NULL DEFAULT now(),
    record_count    bigint NOT NULL
);

-- ============================================================
-- mtl_signal
-- ============================================================

CREATE TABLE mtl_signal.notification_template (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL,
    channel     text NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'INAPP')),
    language    text NOT NULL CHECK (language IN ('tr', 'en')),
    subject     text,
    body        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid REFERENCES mtl_core.admin_account(id),
    UNIQUE (code, channel, language)
);

CREATE TABLE mtl_signal.notification_queue (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code   text NOT NULL,
    channel         text NOT NULL,
    recipient       text NOT NULL,
    context         jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'RETRYING')),
    attempts        integer NOT NULL DEFAULT 0,
    last_error      text,
    scheduled_for   timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_queue_status_scheduled 
  ON mtl_signal.notification_queue (status, scheduled_for) 
  WHERE status IN ('PENDING', 'RETRYING');

CREATE TABLE mtl_signal.inapp_notification (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_admin_id  uuid REFERENCES mtl_core.admin_account(id) ON DELETE CASCADE,
    severity            text NOT NULL DEFAULT 'INFO'
                        CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    title               text NOT NULL,
    body                text,
    link                text,
    is_read             boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inapp_recipient_unread 
  ON mtl_signal.inapp_notification (recipient_admin_id, is_read, created_at DESC);

-- ============================================================
-- Seed: Sistem Rolleri ve Yetkileri
-- ============================================================

INSERT INTO mtl_core.role (name, description, is_system) VALUES
    ('mtl.super_admin',       'Tüm yetkilere sahip süper yönetici', true),
    ('mtl.identity_manager',  'Kullanıcı, grup ve OU yönetimi',     true),
    ('mtl.security_officer',  'Güvenlik politikaları ve denetim',   true),
    ('mtl.infra_operator',    'Replikasyon, sertifika, yedek',      true),
    ('mtl.read_only_auditor', 'Sadece okuma — denetim için',        true),
    ('mtl.helpdesk',          'Yardım masası — kullanıcı destek',   true)
ON CONFLICT (name) DO NOTHING;

-- Yetki kataloğu (kısaltılmış; tam liste docs/07-rbac-design.md içinde)
INSERT INTO mtl_core.permission (code, module, description) VALUES
    -- identity
    ('identity.user.read',                'identity',  'Kullanıcı görüntüleme'),
    ('identity.user.create',              'identity',  'Kullanıcı oluşturma'),
    ('identity.user.update',              'identity',  'Kullanıcı güncelleme'),
    ('identity.user.delete',              'identity',  'Kullanıcı silme'),
    ('identity.user.lock',                'identity',  'Kullanıcı kilitleme'),
    ('identity.user.unlock',              'identity',  'Kullanıcı kilidini açma'),
    ('identity.user.set_password',        'identity',  'Parola atama'),
    ('identity.user.force_password_change','identity', 'Parola değişimi zorlaması'),
    ('identity.user.disable',             'identity',  'Kullanıcı pasif yapma'),
    ('identity.user.enable',              'identity',  'Kullanıcı aktif yapma'),
    ('identity.user.terminate_sessions',  'identity',  'Oturum sonlandırma'),
    ('identity.user.bulk_import',         'identity',  'Toplu içe aktarım'),
    ('identity.user.bulk_export',         'identity',  'Toplu dışa aktarım'),
    ('identity.group.read',               'identity',  'Grup görüntüleme'),
    ('identity.group.create',             'identity',  'Grup oluşturma'),
    ('identity.group.update',             'identity',  'Grup güncelleme'),
    ('identity.group.delete',             'identity',  'Grup silme'),
    ('identity.group.manage_members',     'identity',  'Grup üyelik yönetimi'),
    ('identity.ou.read',                  'identity',  'OU görüntüleme'),
    ('identity.ou.create',                'identity',  'OU oluşturma'),
    ('identity.ou.update',                'identity',  'OU güncelleme'),
    ('identity.ou.delete',                'identity',  'OU silme'),
    ('identity.ou.move',                  'identity',  'OU taşıma'),
    -- explorer
    ('explorer.browse',                   'explorer',  'LDAP ağaç gezinme'),
    ('explorer.query',                    'explorer',  'Özel LDAP sorgu çalıştırma'),
    -- policies
    ('policies.password.read',            'policies',  'Parola politikası görüntüleme'),
    ('policies.password.update',          'policies',  'Parola politikası güncelleme'),
    ('policies.lockout.read',             'policies',  'Kilit politikası görüntüleme'),
    ('policies.lockout.update',           'policies',  'Kilit politikası güncelleme'),
    ('policies.schema.read',              'policies',  'LDAP şeması görüntüleme'),
    ('policies.schema.update',            'policies',  'LDAP şeması güncelleme'),
    -- shield
    ('shield.cert.read',                  'shield',    'Sertifika görüntüleme'),
    ('shield.cert.upload',                'shield',    'Sertifika yükleme'),
    ('shield.cert.activate',              'shield',    'Sertifika aktive etme'),
    ('shield.cert.delete',                'shield',    'Sertifika silme'),
    ('shield.ldaps.toggle',               'shield',    'LDAPS aç/kapa'),
    ('shield.ports.update',               'shield',    'LDAP port değişikliği'),
    -- sync
    ('sync.topology.read',                'sync',      'Replikasyon topolojisi görüntüleme'),
    ('sync.peer.create',                  'sync',      'Slave node kaydetme'),
    ('sync.peer.delete',                  'sync',      'Slave node kaldırma'),
    ('sync.failover.promote',             'sync',      'Slave promote etme'),
    ('sync.failover.restore',             'sync',      'Master geri getirme'),
    -- pulse
    ('pulse.dashboard.read',              'pulse',     'Dashboard görüntüleme'),
    ('pulse.sessions.read',               'pulse',     'Aktif oturumları görüntüleme'),
    ('pulse.sessions.terminate',          'pulse',     'Oturum sonlandırma'),
    ('pulse.alerts.read',                 'pulse',     'Alarmları görüntüleme'),
    ('pulse.alerts.acknowledge',          'pulse',     'Alarm onaylama'),
    ('pulse.metrics.read',                'pulse',     'Metrikleri görüntüleme'),
    -- audit
    ('audit.events.read',                 'audit',     'Denetim olaylarını görüntüleme'),
    ('audit.events.export',               'audit',     'Denetim olaylarını dışa aktarma'),
    -- signal
    ('signal.template.read',              'signal',    'Bildirim şablonu görüntüleme'),
    ('signal.template.update',            'signal',    'Bildirim şablonu güncelleme'),
    ('signal.queue.read',                 'signal',    'Bildirim kuyruğu görüntüleme'),
    ('signal.queue.retry',                'signal',    'Başarısız bildirimi yeniden gönderme'),
    ('signal.test_send',                  'signal',    'Bildirim test gönderimi'),
    -- backup
    ('backup.read',                       'backup',    'Yedek listesini görüntüleme'),
    ('backup.run',                        'backup',    'Yedek başlatma'),
    ('backup.download',                   'backup',    'Yedek indirme'),
    ('backup.restore',                    'backup',    'Yedekten geri yükleme'),
    ('backup.schedule.update',            'backup',    'Yedek zamanlaması güncelleme'),
    -- api_token
    ('api_token.read',                    'api_token', 'API token listesi'),
    ('api_token.create',                  'api_token', 'API token oluşturma'),
    ('api_token.revoke',                  'api_token', 'API token iptal'),
    -- webhook
    ('webhook.read',                      'webhook',   'Webhook listesi'),
    ('webhook.create',                    'webhook',   'Webhook oluşturma'),
    ('webhook.update',                    'webhook',   'Webhook güncelleme'),
    ('webhook.delete',                    'webhook',   'Webhook silme'),
    -- rbac
    ('rbac.admin.read',                   'rbac',      'Yönetici listesi'),
    ('rbac.admin.create',                 'rbac',      'Yönetici oluşturma'),
    ('rbac.admin.update',                 'rbac',      'Yönetici güncelleme'),
    ('rbac.admin.delete',                 'rbac',      'Yönetici silme'),
    ('rbac.admin.assign_roles',           'rbac',      'Yöneticiye rol atama'),
    ('rbac.role.read',                    'rbac',      'Rol listesi'),
    ('rbac.role.create',                  'rbac',      'Rol oluşturma'),
    ('rbac.role.update',                  'rbac',      'Rol güncelleme'),
    ('rbac.role.delete',                  'rbac',      'Rol silme'),
    -- settings
    ('settings.ldap.read',                'settings',  'LDAP ayarları görüntüleme'),
    ('settings.ldap.update',              'settings',  'LDAP ayarları güncelleme'),
    ('settings.tls.read',                 'settings',  'TLS ayarları görüntüleme'),
    ('settings.tls.update',               'settings',  'TLS ayarları güncelleme'),
    ('settings.smtp.read',                'settings',  'SMTP ayarları görüntüleme'),
    ('settings.smtp.update',              'settings',  'SMTP ayarları güncelleme'),
    ('settings.sms.read',                 'settings',  'SMS ayarları görüntüleme'),
    ('settings.sms.update',               'settings',  'SMS ayarları güncelleme'),
    ('settings.security.read',            'settings',  'Güvenlik ayarları görüntüleme'),
    ('settings.security.update',          'settings',  'Güvenlik ayarları güncelleme'),
    ('settings.replication.read',         'settings',  'Replikasyon ayarları görüntüleme'),
    ('settings.replication.update',       'settings',  'Replikasyon ayarları güncelleme'),
    ('settings.branding.read',            'settings',  'Markalama ayarları görüntüleme'),
    ('settings.branding.update',          'settings',  'Markalama ayarları güncelleme'),
    -- system
    ('system.version.read',               'system',    'Sürüm bilgisi'),
    ('system.health.read',                'system',    'Sistem sağlığı'),
    ('system.config.export',              'system',    'Yapılandırma dışa aktarma'),
    ('system.config.import',              'system',    'Yapılandırma içe aktarma')
ON CONFLICT (code) DO NOTHING;

-- mtl.super_admin'e tüm yetkileri ver (wildcard işareti)
INSERT INTO mtl_core.permission (code, module, description) VALUES
    ('*', 'system', 'Tüm yetkiler (yalnızca super_admin için)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO mtl_core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM mtl_core.role r, mtl_core.permission p
WHERE r.name = 'mtl.super_admin' AND p.code = '*'
ON CONFLICT DO NOTHING;

-- mtl.identity_manager için yetkiler
INSERT INTO mtl_core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM mtl_core.role r, mtl_core.permission p
WHERE r.name = 'mtl.identity_manager'
  AND (p.module = 'identity' OR p.code IN ('explorer.browse','explorer.query','audit.events.read'))
ON CONFLICT DO NOTHING;

-- mtl.security_officer
INSERT INTO mtl_core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM mtl_core.role r, mtl_core.permission p
WHERE r.name = 'mtl.security_officer'
  AND (p.module IN ('audit','policies')
       OR p.code IN ('pulse.alerts.read','pulse.alerts.acknowledge',
                     'pulse.sessions.read','pulse.sessions.terminate',
                     'settings.security.read','settings.security.update'))
ON CONFLICT DO NOTHING;

-- mtl.infra_operator
INSERT INTO mtl_core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM mtl_core.role r, mtl_core.permission p
WHERE r.name = 'mtl.infra_operator'
  AND (p.module IN ('sync','shield','pulse','backup','system')
       OR p.code IN ('settings.ldap.read','settings.ldap.update',
                     'settings.tls.read','settings.tls.update',
                     'settings.replication.read','settings.replication.update'))
ON CONFLICT DO NOTHING;

-- mtl.read_only_auditor — sadece *.read
INSERT INTO mtl_core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM mtl_core.role r, mtl_core.permission p
WHERE r.name = 'mtl.read_only_auditor'
  AND p.code LIKE '%.read'
ON CONFLICT DO NOTHING;

-- mtl.helpdesk
INSERT INTO mtl_core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM mtl_core.role r, mtl_core.permission p
WHERE r.name = 'mtl.helpdesk'
  AND p.code IN (
    'identity.user.read',
    'identity.user.update',
    'identity.user.set_password',
    'identity.user.unlock',
    'identity.user.terminate_sessions',
    'audit.events.read'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- Varsayılan ayarlar
-- ============================================================

INSERT INTO mtl_core.settings (key, value, category, is_secret, description) VALUES
    ('security.password_min_length',          '12'::jsonb, 'security', false, 'Minimum parola uzunluğu'),
    ('security.password_history_count',       '5'::jsonb,  'security', false, 'Tekrar kullanılmasın diye saklanacak parola sayısı'),
    ('security.brute_force_threshold',        '5'::jsonb,  'security', false, 'Başarısız giriş eşiği'),
    ('security.brute_force_window_seconds',   '900'::jsonb,'security', false, 'Eşik pencere süresi (sn)'),
    ('security.lockout_duration_seconds',     '900'::jsonb,'security', false, 'Otomatik kilit süresi (sn)'),
    ('security.session_idle_timeout_minutes', '30'::jsonb, 'security', false, 'Boş kalma oturum süresi (dk)'),
    ('security.session_absolute_timeout_hours','12'::jsonb,'security', false, 'Mutlak oturum süresi (saat)'),
    ('security.mfa_enforcement',              '"OPTIONAL"'::jsonb, 'security', false, 'OPTIONAL veya REQUIRED'),
    ('replication.auto_failover_enabled',     'false'::jsonb, 'replication', false, 'Otomatik failover (üretimde KAPALI)'),
    ('replication.sync_lag_warning_seconds',  '60'::jsonb,  'replication', false, 'Replikasyon gecikme uyarı eşiği'),
    ('replication.sync_lag_critical_seconds', '600'::jsonb, 'replication', false, 'Replikasyon gecikme kritik eşiği'),
    ('branding.product_display_name',         '"MTL LDAP Admin"'::jsonb, 'branding', false, 'Görünen ürün adı'),
    ('branding.primary_color',                '"#2563eb"'::jsonb, 'branding', false, 'Ana marka rengi'),
    ('branding.logo_url',                     '"/assets/mtl-logo.svg"'::jsonb, 'branding', false, 'Logo yolu'),
    ('i18n.default_language',                 '"tr"'::jsonb, 'branding', false, 'Varsayılan dil')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Varsayılan alarm kuralları
-- ============================================================

INSERT INTO mtl_core.alert_rule (name, metric_name, condition, threshold, duration_seconds, severity, channels) VALUES
    ('LDAP erişilemez',         'ldap_probe_success',        'lt',  1,     60,   'CRITICAL', '{INAPP,EMAIL}'),
    ('LDAP yüksek gecikme',     'ldap_probe_latency_ms',     'gt',  500,   300,  'WARNING',  '{INAPP}'),
    ('Replikasyon gecikmesi',   'replication_lag_seconds',   'gt',  60,    120,  'WARNING',  '{INAPP}'),
    ('Replikasyon kritik',      'replication_lag_seconds',   'gt',  600,   300,  'CRITICAL', '{INAPP,EMAIL}'),
    ('Disk doluyor (uyarı)',    'disk_used_percent',         'gt',  85,    300,  'WARNING',  '{INAPP}'),
    ('Disk doluyor (kritik)',   'disk_used_percent',         'gt',  95,    60,   'CRITICAL', '{INAPP,EMAIL}'),
    ('Yüksek başarısız giriş',  'failed_logins_per_minute',  'gt',  50,    180,  'WARNING',  '{INAPP}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Varsayılan bildirim şablonları (TR)
-- ============================================================

INSERT INTO mtl_signal.notification_template (code, channel, language, subject, body) VALUES
    ('welcome_email', 'EMAIL', 'tr', 
     'MTL LDAP Hesabınız Oluşturuldu',
     'Merhaba {{display_name}},

MTL LDAP sisteminde hesabınız oluşturuldu.

Kullanıcı adınız: {{username}}
İlk giriş için aşağıdaki bağlantıyı kullanın:
{{login_url}}

İlk girişte parolanızı değiştirmeniz istenecektir.

İyi çalışmalar.'),

    ('password_reset_email', 'EMAIL', 'tr',
     'Parola Sıfırlama Talebi',
     'Merhaba {{display_name}},

Hesabınız için parola sıfırlama talep edildi.

Doğrulama kodunuz: {{otp}}

Bu kod 10 dakika geçerlidir. Bu talebi siz yapmadıysanız bu e-postayı yok sayın.'),

    ('password_reset_sms', 'SMS', 'tr', NULL,
     'MTL LDAP parola sıfırlama kodu: {{otp}} - 10 dakika geçerlidir.'),

    ('mfa_enrolled_email', 'EMAIL', 'tr',
     'İki Aşamalı Doğrulama Aktive Edildi',
     'Merhaba {{display_name}},

Hesabınızda iki aşamalı doğrulama (MFA) başarıyla aktive edildi.

Bundan sonraki girişlerinizde doğrulama uygulamanızdaki kodu kullanmanız istenecektir.

Bu işlemi siz yapmadıysanız derhal sistem yöneticisine bildirin.'),

    ('account_locked_email', 'EMAIL', 'tr',
     'Hesabınız Geçici Olarak Kilitlendi',
     'Merhaba {{display_name}},

Hesabınız çok sayıda başarısız giriş denemesi nedeniyle geçici olarak kilitlendi.

Kilit {{unlock_time}} tarihinde otomatik kalkacaktır. Acil durumlar için yardım masasına ulaşabilirsiniz.')
ON CONFLICT DO NOTHING;

-- İngilizce eşdeğerleri
INSERT INTO mtl_signal.notification_template (code, channel, language, subject, body) VALUES
    ('welcome_email', 'EMAIL', 'en', 
     'Your MTL LDAP Account Has Been Created',
     'Hello {{display_name}},

Your account has been created in the MTL LDAP system.

Username: {{username}}
Please use the link below for your first login:
{{login_url}}

You will be asked to change your password on first login.

Best regards.'),

    ('password_reset_email', 'EMAIL', 'en',
     'Password Reset Request',
     'Hello {{display_name}},

A password reset has been requested for your account.

Verification code: {{otp}}

This code is valid for 10 minutes. If you did not request this, please ignore this email.'),

    ('password_reset_sms', 'SMS', 'en', NULL,
     'MTL LDAP password reset code: {{otp}} - valid for 10 minutes.')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Bilgi
-- ============================================================
COMMENT ON SCHEMA mtl_core   IS 'MTL LDAP Admin — yönetim, RBAC, oturum, ayarlar';
COMMENT ON SCHEMA mtl_audit  IS 'MTL LDAP Admin — denetim olayları (append-only)';
COMMENT ON SCHEMA mtl_signal IS 'MTL LDAP Admin — bildirim şablonları ve gönderim kuyruğu';
