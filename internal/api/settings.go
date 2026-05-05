package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldaps"
)

// ---- SMTP settings ----
//
// GET  /api/settings/smtp        — sanitized view (no password)
// PUT  /api/settings/smtp        — update; password optional
// POST /api/settings/smtp/test   — body { "to": "..." } gönderir test maili

func (s *Server) handleGetSMTPSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.audit.GetSMTPSettings(s.cfg.JWTSecret)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings.View())
}

func (s *Server) handleUpdateSMTPSettings(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in struct {
		Enabled  bool   `json:"enabled"`
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		// Password boş bırakılırsa mevcut şifre korunur (UI'da boş şu input
		// "değiştirme" anlamı taşır).
		Password string `json:"password"`
		From     string `json:"from"`
		ReplyTo  string `json:"replyTo"`
		StartTLS bool   `json:"startTLS"`
		// "clearPassword" tıklanırsa true gel — açıkça şifreyi siler
		ClearPassword bool `json:"clearPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	current, err := s.audit.GetSMTPSettings(s.cfg.JWTSecret)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	current.Enabled = in.Enabled
	current.Host = in.Host
	current.Port = in.Port
	current.Username = in.Username
	current.From = in.From
	current.ReplyTo = in.ReplyTo
	current.StartTLS = in.StartTLS

	if in.ClearPassword {
		current.PasswordEncrypted = ""
	} else if in.Password != "" {
		enc, err := audit.EncryptSecret(in.Password, s.cfg.JWTSecret)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "encrypt: "+err.Error())
			return
		}
		current.PasswordEncrypted = enc
	}

	if err := s.audit.SetSMTPSettings(current); err != nil {
		s.auditLog(actor, audit.SettingsUpdate, "smtp", ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditLog(actor, audit.SettingsUpdate, "smtp", ip, audit.StatusOK,
		fmt.Sprintf("host=%s port=%d enabled=%v", in.Host, in.Port, in.Enabled))
	writeJSON(w, http.StatusOK, current.View())
}

func (s *Server) handleTestSMTP(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in struct {
		To string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.To == "" {
		writeErr(w, http.StatusBadRequest, "to zorunlu")
		return
	}
	if err := s.mailDB.SendTest(in.To); err != nil {
		s.auditLog(actor, audit.SMTPTest, in.To, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.SMTPTest, in.To, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

// ---- SMS settings ----

func (s *Server) handleGetSMSSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.audit.GetSMSSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, settings.View())
}

func (s *Server) handleUpdateSMSSettings(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in struct {
		Enabled          bool   `json:"enabled"`
		Method           string `json:"method"`
		URLTemplate      string `json:"urlTemplate"`
		BodyTemplate     string `json:"bodyTemplate"`
		ContentType      string `json:"contentType"`
		AuthHeader       string `json:"authHeader"`      // plain — encrypt edilecek
		ClearAuthHeader  bool   `json:"clearAuthHeader"` // explicit silme
		SuccessSubstring string `json:"successSubstring"`
		MessageTemplate  string `json:"messageTemplate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	current, err := s.audit.GetSMSSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	current.Enabled = in.Enabled
	current.Method = in.Method
	current.URLTemplate = in.URLTemplate
	current.BodyTemplate = in.BodyTemplate
	current.ContentType = in.ContentType
	current.SuccessSubstring = in.SuccessSubstring
	current.MessageTemplate = in.MessageTemplate

	if in.ClearAuthHeader {
		current.AuthHeaderEncrypted = ""
	} else if in.AuthHeader != "" {
		enc, err := audit.EncryptSecret(in.AuthHeader, s.cfg.JWTSecret)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "encrypt: "+err.Error())
			return
		}
		current.AuthHeaderEncrypted = enc
	}
	if err := s.audit.SetSMSSettings(current); err != nil {
		s.auditLog(actor, audit.SettingsUpdate, "sms", ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditLog(actor, audit.SettingsUpdate, "sms", ip, audit.StatusOK,
		fmt.Sprintf("method=%s enabled=%v", in.Method, in.Enabled))
	writeJSON(w, http.StatusOK, current.View())
}

func (s *Server) handleTestSMS(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Phone == "" {
		writeErr(w, http.StatusBadRequest, "phone zorunlu")
		return
	}
	if err := s.smsDB.SendTest(in.Phone); err != nil {
		s.auditLog(actor, audit.SMSTest, in.Phone, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.SMSTest, in.Phone, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

// ---- LDAPS settings ----
//
// LDAPS yönetimi en hassas operasyon — yanlış yapılırsa slapd cert dosyalarını
// okuyamaz veya cn=config bozulur.
//
// Akış:
//   1. UI cert + key dosyalarını base64 olarak gönderir
//   2. Backend PEM parse eder, validate eder (cert tipi + key tipi)
//   3. /etc/mtl-ldap-admin/ssl/ altına atomic write
//   4. cn=config'e olcTLSCertificateFile vs. ile modify
//   5. Hata olursa lastApplyError'a yaz, eski state korunur
//
// LISTEN URL ekleme (slapd -h "ldap:/// ldaps:///") UI'da YAPILMAZ —
// /etc/sysconfig/slapd dosyasını edit etmek root + restart gerektirir; ops
// runbook'ta açıklanır.

func (s *Server) handleGetLDAPSStatus(w http.ResponseWriter, r *http.Request) {
	status, err := s.audit.GetLDAPSStatus()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleUploadLDAPSCert(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	// Body limit — abuse önle (büyük dosya gönderme)
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024) // 256 KB cert/key dosyaları için yeterli

	var in struct {
		CertPEM string `json:"certPEM"` // raw text (base64 değil — UI textarea'dan gelir)
		KeyPEM  string `json:"keyPEM"`
		CAPEM   string `json:"caPEM,omitempty"`
		// "applyConfig": dosyaları yaz + cn=config update tek seferde
		ApplyConfig bool `json:"applyConfig"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON: "+err.Error())
		return
	}
	if in.CertPEM == "" || in.KeyPEM == "" {
		writeErr(w, http.StatusBadRequest, "certPEM ve keyPEM zorunlu")
		return
	}

	// 1. Validate
	parsed, err := ldaps.ParseCertPEM([]byte(in.CertPEM))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cert: "+err.Error())
		return
	}
	if err := ldaps.ValidateKeyPEM([]byte(in.KeyPEM)); err != nil {
		writeErr(w, http.StatusBadRequest, "key: "+err.Error())
		return
	}

	// 2. Atomic write
	certPath, keyPath, caPath, err := ldaps.WriteCerts([]byte(in.CertPEM), []byte(in.KeyPEM), []byte(in.CAPEM))
	if err != nil {
		s.auditLog(actor, audit.LDAPSCertUpload, "", ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// 3. Status DB'sine yaz
	status := &audit.LDAPSStatus{
		CertPath:      certPath,
		KeyPath:       keyPath,
		CACertPath:    caPath,
		CertSubject:   parsed.Subject,
		CertIssuer:    parsed.Issuer,
		CertNotBefore: parsed.NotBefore.Format("2006-01-02T15:04:05Z"),
		CertNotAfter:  parsed.NotAfter.Format("2006-01-02T15:04:05Z"),
		UploadedAt:    nowMillis(),
	}
	s.auditLog(actor, audit.LDAPSCertUpload, parsed.Subject, ip, audit.StatusOK,
		fmt.Sprintf("notAfter=%s", parsed.NotAfter.Format("2006-01-02")))

	// 4. Apply edilsin mi?
	if in.ApplyConfig {
		if err := ldaps.ApplyConfig(s.cfg.LDAP.URL, s.cfg.LDAP.BindDN, s.cfg.LDAP.BindPassword, certPath, keyPath, caPath); err != nil {
			status.LastApplyError = err.Error()
			_ = s.audit.SetLDAPSStatus(status)
			s.auditLog(actor, audit.LDAPSConfigApply, "", ip, audit.StatusFail, err.Error())
			writeErr(w, http.StatusBadRequest, "cert kaydedildi ama cn=config apply başarısız: "+err.Error())
			return
		}
		status.Enabled = true
		s.auditLog(actor, audit.LDAPSConfigApply, "", ip, audit.StatusOK, "")
	}
	if err := s.audit.SetLDAPSStatus(status); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

// ---- External audit (slapd accesslog) ----

func (s *Server) handleExternalAudit(w http.ResponseWriter, r *http.Request) {
	snap := s.extAudit.Get()
	writeJSON(w, http.StatusOK, snap)
}
