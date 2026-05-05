package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr         string
	JWTSecret          []byte
	LDAP               LDAPConfig
	AllowedOrigins     []string
	AuditDBPath        string
	LoginRateLimit     int
	LoginRateWindowSec int

	PublicURL string // http://localhost:8080 — reset linklerinde kullanılır

	// Self-service password reset
	SelfServiceMethods []string // "email", "sms", "questions" — boşsa devre dışı
	ResetTokenTTLMin   int      // varsayılan 30
	ResetRateLimit     int      // IP başına token isteme limiti / pencere
	ResetRateWindowSec int

	// SMTP — email reset için
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string
	SMTPStartTLS bool

	// SMS provider — generic webhook; özel provider modülleri internal/sms'te
	SMSProvider   string // "webhook" | "twilio" | "" (devre dışı)
	SMSWebhookURL string // POST {to, message} JSON
	SMSAuthHeader string // opsiyonel: "Bearer xxx"
	TwilioSID     string
	TwilioToken   string
	TwilioFrom    string

	// MFA
	MFARequired bool   // tüm kullanıcılar için zorunlu
	MFAIssuer   string // TOTP issuer (Google Authenticator vs.'de görünür)
}

type LDAPConfig struct {
	URL          string // ldap://host:389 or ldaps://host:636
	BindDN       string // cn=admin,dc=example,dc=org (panelin kendi servis hesabı)
	BindPassword string
	BaseDN       string // dc=example,dc=org
	UsersOU      string // ou=users (BaseDN'e göre relative)
	GroupsOU     string // ou=groups
	AdminGroupDN string // tam DN: bu gruba üye olan kullanıcılar admin rolü alır
	StartTLS     bool
	InsecureTLS  bool
}

func (l LDAPConfig) UsersDN() string  { return l.UsersOU + "," + l.BaseDN }
func (l LDAPConfig) GroupsDN() string { return l.GroupsOU + "," + l.BaseDN }

func Load() (*Config, error) {
	secret, err := mustEnv("JWT_SECRET")
	if err != nil {
		return nil, err
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET en az 32 karakter olmalı")
	}

	url, err := mustEnv("LDAP_URL")
	if err != nil {
		return nil, err
	}
	bindDN, err := mustEnv("LDAP_BIND_DN")
	if err != nil {
		return nil, err
	}
	bindPw, err := mustEnv("LDAP_BIND_PASSWORD")
	if err != nil {
		return nil, err
	}
	baseDN, err := mustEnv("LDAP_BASE_DN")
	if err != nil {
		return nil, err
	}

	return &Config{
		ListenAddr: getEnv("LISTEN_ADDR", ":8080"),
		JWTSecret:  []byte(secret),
		LDAP: LDAPConfig{
			URL:          url,
			BindDN:       bindDN,
			BindPassword: bindPw,
			BaseDN:       baseDN,
			UsersOU:      getEnv("LDAP_USERS_OU", "ou=users"),
			GroupsOU:     getEnv("LDAP_GROUPS_OU", "ou=groups"),
			AdminGroupDN: getEnv("LDAP_ADMIN_GROUP_DN", ""),
			StartTLS:     getEnv("LDAP_STARTTLS", "false") == "true",
			InsecureTLS:  getEnv("LDAP_INSECURE_TLS", "false") == "true",
		},
		AllowedOrigins:     splitCSV(getEnv("ALLOWED_ORIGINS", "")),
		AuditDBPath:        getEnv("AUDIT_DB_PATH", "audit.db"),
		LoginRateLimit:     mustAtoi(getEnv("LOGIN_RATE_LIMIT", "10")),
		LoginRateWindowSec: mustAtoi(getEnv("LOGIN_RATE_WINDOW_SEC", "900")),

		PublicURL: getEnv("PUBLIC_URL", "http://localhost:8080"),

		SelfServiceMethods: splitCSV(getEnv("SELF_SERVICE_METHODS", "")),
		ResetTokenTTLMin:   mustAtoi(getEnv("RESET_TOKEN_TTL_MIN", "30")),
		ResetRateLimit:     mustAtoi(getEnv("RESET_RATE_LIMIT", "5")),
		ResetRateWindowSec: mustAtoi(getEnv("RESET_RATE_WINDOW_SEC", "3600")),

		SMTPHost:     getEnv("SMTP_HOST", ""),
		SMTPPort:     mustAtoi(getEnv("SMTP_PORT", "587")),
		SMTPUser:     getEnv("SMTP_USER", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:     getEnv("SMTP_FROM", ""),
		SMTPStartTLS: getEnv("SMTP_STARTTLS", "true") == "true",

		SMSProvider:   getEnv("SMS_PROVIDER", ""),
		SMSWebhookURL: getEnv("SMS_WEBHOOK_URL", ""),
		SMSAuthHeader: getEnv("SMS_AUTH_HEADER", ""),
		TwilioSID:     getEnv("TWILIO_SID", ""),
		TwilioToken:   getEnv("TWILIO_TOKEN", ""),
		TwilioFrom:    getEnv("TWILIO_FROM", ""),

		MFARequired: getEnv("MFA_REQUIRED", "false") == "true",
		MFAIssuer:   getEnv("MFA_ISSUER", "mtl-ldap-admin"),
	}, nil
}

func splitCSV(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func mustAtoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

func getEnv(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func mustEnv(k string) (string, error) {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return "", fmt.Errorf("zorunlu env değişkeni boş: %s", k)
	}
	return v, nil
}
