package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/config"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/extaudit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/mail"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/sms"
)

type Server struct {
	cfg       *config.Config
	ldap      *ldap.Pool
	audit     *audit.Store
	mail      *mail.Sender   // legacy .env-based
	mailDB    *mail.DBSender // v0.10: DB-backed
	smsSender sms.Sender     // legacy .env-based
	smsDB     *sms.DBSender  // v0.10: DB-backed
	extAudit  *extaudit.ExternalAudit
	loginRate *RateLimiter
	resetRate *RateLimiter
	mux       *http.ServeMux
	webFS     fs.FS
}

func NewServer(cfg *config.Config, pool *ldap.Pool, auditStore *audit.Store, webFS fs.FS) *Server {
	s := &Server{
		cfg:       cfg,
		ldap:      pool,
		audit:     auditStore,
		mail:      mail.New(cfg),
		mailDB:    mail.NewDBSender(auditStore, cfg.JWTSecret, cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom, cfg.SMTPStartTLS),
		smsSender: sms.New(cfg),
		smsDB:     sms.NewDBSender(auditStore, cfg.JWTSecret),
		extAudit:  extaudit.New(cfg),
		loginRate: NewRateLimiter(
			cfg.LoginRateLimit,
			time.Duration(cfg.LoginRateWindowSec)*time.Second,
		),
		resetRate: NewRateLimiter(
			cfg.ResetRateLimit,
			time.Duration(cfg.ResetRateWindowSec)*time.Second,
		),
		mux:   http.NewServeMux(),
		webFS: webFS,
	}
	s.extAudit.StartBackground()
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.cors(s.mux).ServeHTTP(w, r)
}

func (s *Server) routes() {
	// public
	s.mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	s.mux.HandleFunc("POST /api/auth/mfa-verify", s.handleMFAVerify)
	s.mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// public self-service
	s.mux.HandleFunc("GET /api/password-reset/config", s.handleSelfServiceConfig)
	s.mux.HandleFunc("POST /api/password-reset/request", s.handleRequestReset)
	s.mux.HandleFunc("POST /api/password-reset/reset", s.handleResetWithToken)
	s.mux.HandleFunc("GET /api/password-reset/questions", s.handleListPublicQuestions)
	s.mux.HandleFunc("POST /api/password-reset/verify-questions", s.handleVerifyQuestions)

	// authenticated
	s.mux.Handle("GET /api/me", s.requireAuth(http.HandlerFunc(s.handleMe)))
	s.mux.Handle("POST /api/me/password", s.requireAuth(http.HandlerFunc(s.handleChangeOwnPassword)))
	s.mux.Handle("GET /api/server-info", s.requireAuth(http.HandlerFunc(s.handleServerInfo)))

	// MFA (self)
	s.mux.Handle("GET /api/me/mfa", s.requireAuth(http.HandlerFunc(s.handleMFAStatus)))
	s.mux.Handle("POST /api/me/mfa/enroll", s.requireAuth(http.HandlerFunc(s.handleMFAEnroll)))
	s.mux.Handle("POST /api/me/mfa/enable", s.requireAuth(http.HandlerFunc(s.handleMFAEnable)))
	s.mux.Handle("DELETE /api/me/mfa", s.requireAuth(http.HandlerFunc(s.handleMFADisable)))

	// Security questions (self)
	s.mux.Handle("GET /api/me/questions", s.requireAuth(http.HandlerFunc(s.handleListMyQuestions)))
	s.mux.Handle("PUT /api/me/questions", s.requireAuth(http.HandlerFunc(s.handleSetMyQuestions)))

	// admin (directory read + write)
	// v0.7: read endpoints'i de admin-only yaptık — Users/Groups sayfaları sadece admin'e açık.
	// Kendi profili için /api/me, /api/me/* var; normal kullanıcılar dizin listesini göremez.
	s.mux.Handle("GET /api/users", s.requireAdmin(http.HandlerFunc(s.handleListUsers)))
	s.mux.Handle("GET /api/users/{uid}", s.requireAdmin(http.HandlerFunc(s.handleGetUser)))
	s.mux.Handle("GET /api/groups", s.requireAdmin(http.HandlerFunc(s.handleListGroups)))
	s.mux.Handle("GET /api/groups/{cn}", s.requireAdmin(http.HandlerFunc(s.handleGetGroup)))

	s.mux.Handle("POST /api/users", s.requireAdmin(http.HandlerFunc(s.handleCreateUser)))
	s.mux.Handle("PUT /api/users/{uid}", s.requireAdmin(http.HandlerFunc(s.handleUpdateUser)))
	s.mux.Handle("PATCH /api/users/{uid}/attributes", s.requireAdmin(http.HandlerFunc(s.handleModifyUserAttributes)))
	s.mux.Handle("DELETE /api/users/{uid}", s.requireAdmin(http.HandlerFunc(s.handleDeleteUser)))
	s.mux.Handle("POST /api/users/{uid}/password", s.requireAdmin(http.HandlerFunc(s.handleSetUserPassword)))
	s.mux.Handle("POST /api/users/{uid}/unlock", s.requireAdmin(http.HandlerFunc(s.handleUnlockUser)))
	s.mux.Handle("DELETE /api/users/{uid}/mfa", s.requireAdmin(http.HandlerFunc(s.handleAdminMFADisable)))
	// v0.9: kalıcı disable + OU taşıma
	s.mux.Handle("POST /api/users/{uid}/disable", s.requireAdmin(s.handleSetUserDisabled(true)))
	s.mux.Handle("POST /api/users/{uid}/enable", s.requireAdmin(s.handleSetUserDisabled(false)))
	s.mux.Handle("POST /api/users/{uid}/move", s.requireAdmin(http.HandlerFunc(s.handleMoveUser)))

	s.mux.Handle("POST /api/groups", s.requireAdmin(http.HandlerFunc(s.handleCreateGroup)))
	s.mux.Handle("DELETE /api/groups/{cn}", s.requireAdmin(http.HandlerFunc(s.handleDeleteGroup)))
	s.mux.Handle("POST /api/groups/{cn}/members", s.requireAdmin(http.HandlerFunc(s.handleAddGroupMember)))
	s.mux.Handle("DELETE /api/groups/{cn}/members/{uid}", s.requireAdmin(http.HandlerFunc(s.handleRemoveGroupMember)))

	s.mux.Handle("GET /api/ldif/export", s.requireAdmin(http.HandlerFunc(s.handleExportLDIF)))
	s.mux.Handle("POST /api/ldif/import", s.requireAdmin(http.HandlerFunc(s.handleImportLDIF)))

	s.mux.Handle("POST /api/users/bulk", s.requireAdmin(http.HandlerFunc(s.handleBulkCreateUsers)))
	s.mux.Handle("POST /api/users/bulk-delete", s.requireAdmin(http.HandlerFunc(s.handleBulkDeleteUsers)))
	s.mux.Handle("POST /api/users/bulk-group-add", s.requireAdmin(http.HandlerFunc(s.handleBulkGroupAdd)))
	s.mux.Handle("POST /api/users/bulk-group-remove", s.requireAdmin(http.HandlerFunc(s.handleBulkGroupRemove)))
	s.mux.Handle("POST /api/users/bulk-password-reset", s.requireAdmin(http.HandlerFunc(s.handleBulkResetPasswords)))

	s.mux.Handle("GET /api/templates", s.requireAuth(http.HandlerFunc(s.handleListTemplates)))
	s.mux.Handle("GET /api/templates/{name}", s.requireAuth(http.HandlerFunc(s.handleGetTemplate)))
	s.mux.Handle("POST /api/templates", s.requireAdmin(http.HandlerFunc(s.handleSaveTemplate)))
	s.mux.Handle("PUT /api/templates/{name}", s.requireAdmin(http.HandlerFunc(s.handleSaveTemplate)))
	s.mux.Handle("DELETE /api/templates/{name}", s.requireAdmin(http.HandlerFunc(s.handleDeleteTemplate)))
	s.mux.Handle("POST /api/templates/{name}/apply", s.requireAdmin(http.HandlerFunc(s.handleApplyTemplate)))

	s.mux.Handle("GET /api/audit", s.requireAdmin(http.HandlerFunc(s.handleAuditList)))

	// v0.9: schema artık admin-only — normal user'lar zaten Profile dışında dizine bakmamalı.
	s.mux.Handle("GET /api/schema", s.requireAdmin(http.HandlerFunc(s.handleGetSchema)))
	s.mux.Handle("POST /api/schema/refresh", s.requireAdmin(http.HandlerFunc(s.handleRefreshSchema)))

	s.mux.Handle("GET /api/tree/children", s.requireAdmin(http.HandlerFunc(s.handleTreeChildren)))
	s.mux.Handle("GET /api/tree/entry", s.requireAdmin(http.HandlerFunc(s.handleGetEntry)))
	// v0.9: DN Tree generic edit + OU container listesi (move dialog için)
	s.mux.Handle("GET /api/tree/containers", s.requireAdmin(http.HandlerFunc(s.handleListContainerOUs)))
	s.mux.Handle("PATCH /api/entries/attributes", s.requireAdmin(http.HandlerFunc(s.handleModifyEntry)))
	s.mux.Handle("POST /api/entries/objectClasses", s.requireAdmin(http.HandlerFunc(s.handleModifyEntryObjectClasses)))

	s.mux.Handle("GET /api/ous", s.requireAuth(http.HandlerFunc(s.handleListOUs)))
	s.mux.Handle("POST /api/ous", s.requireAdmin(http.HandlerFunc(s.handleCreateOU)))
	s.mux.Handle("DELETE /api/ous", s.requireAdmin(http.HandlerFunc(s.handleDeleteOU)))

	s.mux.Handle("GET /api/users/{uid}/posix", s.requireAuth(http.HandlerFunc(s.handleGetPosix)))
	s.mux.Handle("PUT /api/users/{uid}/posix", s.requireAdmin(http.HandlerFunc(s.handleSetPosix)))
	s.mux.Handle("DELETE /api/users/{uid}/posix", s.requireAdmin(http.HandlerFunc(s.handleRemovePosix)))
	s.mux.Handle("GET /api/posix/next-uid", s.requireAdmin(http.HandlerFunc(s.handleNextUIDNumber)))

	// Monitor & dashboard
	s.mux.Handle("GET /api/monitor", s.requireAdmin(http.HandlerFunc(s.handleMonitor)))
	s.mux.Handle("GET /api/stats", s.requireAdmin(http.HandlerFunc(s.handleStats)))
	// v0.9: replication status (şimdilik placeholder; ikinci sunucu eklenince doldurulacak)
	s.mux.Handle("GET /api/replication/status", s.requireAdmin(http.HandlerFunc(s.handleReplicationStatus)))

	// Webhooks
	s.mux.Handle("GET /api/webhooks", s.requireAdmin(http.HandlerFunc(s.handleListWebhooks)))
	s.mux.Handle("POST /api/webhooks", s.requireAdmin(http.HandlerFunc(s.handleSaveWebhook)))
	s.mux.Handle("DELETE /api/webhooks/{name}", s.requireAdmin(http.HandlerFunc(s.handleDeleteWebhook)))
	s.mux.Handle("POST /api/webhooks/{name}/test", s.requireAdmin(http.HandlerFunc(s.handleTestWebhook)))
	s.mux.Handle("GET /api/webhooks/{id}/deliveries", s.requireAdmin(http.HandlerFunc(s.handleListDeliveries)))

	// v0.10: Settings (SMTP, SMS, LDAPS) — UI'dan yönetim
	s.mux.Handle("GET /api/settings/smtp", s.requireAdmin(http.HandlerFunc(s.handleGetSMTPSettings)))
	s.mux.Handle("PUT /api/settings/smtp", s.requireAdmin(http.HandlerFunc(s.handleUpdateSMTPSettings)))
	s.mux.Handle("POST /api/settings/smtp/test", s.requireAdmin(http.HandlerFunc(s.handleTestSMTP)))

	s.mux.Handle("GET /api/settings/sms", s.requireAdmin(http.HandlerFunc(s.handleGetSMSSettings)))
	s.mux.Handle("PUT /api/settings/sms", s.requireAdmin(http.HandlerFunc(s.handleUpdateSMSSettings)))
	s.mux.Handle("POST /api/settings/sms/test", s.requireAdmin(http.HandlerFunc(s.handleTestSMS)))

	s.mux.Handle("GET /api/settings/ldaps", s.requireAdmin(http.HandlerFunc(s.handleGetLDAPSStatus)))
	s.mux.Handle("POST /api/settings/ldaps/cert", s.requireAdmin(http.HandlerFunc(s.handleUploadLDAPSCert)))

	// v0.10: External audit (slapd accesslog) — dashboard counter + audit "external" filter
	s.mux.Handle("GET /api/external-audit", s.requireAdmin(http.HandlerFunc(s.handleExternalAudit)))

	s.mux.HandleFunc("/", s.handleSPA)
}

func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}
	if s.webFS == nil {
		http.Error(w, "frontend gömülü değil", http.StatusServiceUnavailable)
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}
	if f, err := s.webFS.Open(path); err == nil {
		f.Close()
		http.ServeFileFS(w, r, s.webFS, path)
		return
	}
	http.ServeFileFS(w, r, s.webFS, "index.html")
}

func (s *Server) cors(next http.Handler) http.Handler {
	allowAll := len(s.cfg.AllowedOrigins) == 0
	allowed := make(map[string]bool, len(s.cfg.AllowedOrigins))
	for _, o := range s.cfg.AllowedOrigins {
		allowed[o] = true
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if allowAll {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if allowed[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) auditLog(actor string, action audit.Action, target, ip string, status audit.Status, details string) {
	if s.audit == nil {
		return
	}
	s.audit.Log(actor, action, target, ip, status, details)
}

func (s *Server) handleServerInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"connection":         s.ldap.ConnectionInfo(),
		"baseDN":             s.ldap.Cfg().BaseDN,
		"version":            "0.6.0",
		"selfServiceMethods": s.cfg.SelfServiceMethods,
		"mfaRequired":        s.cfg.MFARequired,
	})
}
