package api

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
)

// handleMFAStatus kullanıcının MFA durumunu döner.
func (s *Server) handleMFAStatus(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	rec, err := s.audit.GetMFA(claims.UID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rec == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled":              false,
			"hasSecret":            false,
			"backupCodesRemaining": 0,
			"required":             s.cfg.MFARequired,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":              rec.Enabled,
		"hasSecret":            rec.HasSecret,
		"backupCodesRemaining": rec.BackupCodes,
		"required":             s.cfg.MFARequired,
	})
}

// handleMFAEnroll yeni TOTP secret üretir; URL ve secret'ı döner. Henüz aktif değil.
func (s *Server) handleMFAEnroll(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	ip := clientIP(r)

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      s.cfg.MFAIssuer,
		AccountName: claims.UID,
		Algorithm:   otp.AlgorithmSHA1,
		Digits:      otp.DigitsSix,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.audit.SetMFASecret(claims.UID, key.Secret()); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditLog(claims.UID, audit.MFAEnroll, claims.UID, ip, audit.StatusOK, "")

	writeJSON(w, http.StatusOK, map[string]string{
		"secret":  key.Secret(),
		"otpauth": key.URL(),
		"issuer":  s.cfg.MFAIssuer,
		"account": claims.UID,
	})
}

type verifyMFAReq struct {
	Code string `json:"code"`
}

// handleMFAEnable kayıtlı secret ile gelen kodu doğrular, başarılıysa enable eder
// ve yedek kodları üretir. Yedek kodlar bir kerelik gösterilir.
func (s *Server) handleMFAEnable(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	ip := clientIP(r)

	var req verifyMFAReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
		writeErr(w, http.StatusBadRequest, "code zorunlu")
		return
	}

	rec, err := s.audit.GetMFA(claims.UID)
	if err != nil || rec == nil || !rec.HasSecret {
		writeErr(w, http.StatusBadRequest, "önce enroll edin")
		return
	}
	if !totp.Validate(strings.TrimSpace(req.Code), rec.Secret()) {
		s.auditLog(claims.UID, audit.MFAFail, claims.UID, ip, audit.StatusFail, "wrong code at enable")
		writeErr(w, http.StatusUnauthorized, "kod hatalı")
		return
	}

	codes, hashes := generateBackupCodes(8)
	if err := s.audit.EnableMFA(claims.UID, hashes); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditLog(claims.UID, audit.MFAEnable, claims.UID, ip, audit.StatusOK, "")
	writeJSON(w, http.StatusOK, map[string]any{
		"backupCodes": codes,
	})
}

// handleMFADisable kullanıcı kendi MFA'sını kapatır — TOTP kodu istemiyoruz
// çünkü bu authed bir endpoint; oturumlu kullanıcı zaten kim olduğunu kanıtladı.
// Daha sıkı politika için: parolayı tekrar iste — bunu v0.6'da ekleriz.
func (s *Server) handleMFADisable(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	ip := clientIP(r)
	if err := s.audit.DisableMFA(claims.UID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditLog(claims.UID, audit.MFADisable, claims.UID, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminMFADisable admin başka bir kullanıcının MFA'sını sıfırlar (lost device).
func (s *Server) handleAdminMFADisable(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")
	if err := s.audit.DisableMFA(uid); err != nil {
		s.auditLog(actor, audit.MFADisableAdmin, uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditLog(actor, audit.MFADisableAdmin, uid, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

// generateBackupCodes 8 yedek kod üretir; kullanıcıya raw, DB'ye hash gider.
// Format: 4-4-4 (12 char total) — okunması ve girilmesi kolay.
func generateBackupCodes(n int) ([]string, []string) {
	codes := make([]string, n)
	hashes := make([]string, n)
	for i := range codes {
		raw := make([]byte, 8) // 8 byte → ~13 char base32
		_, _ = rand.Read(raw)
		s := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw))
		// formatla: xxxx-xxxx-xxxx
		s = s[:12]
		codes[i] = fmt.Sprintf("%s-%s-%s", s[0:4], s[4:8], s[8:12])
		hashes[i] = audit.HashCode(codes[i])
	}
	return codes, hashes
}
