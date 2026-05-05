package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
)

type loginReq struct {
	UID      string `json:"uid"`
	Password string `json:"password"`
}

type loginResp struct {
	Token       string `json:"token,omitempty"`
	UID         string `json:"uid,omitempty"`
	Role        string `json:"role,omitempty"`
	MFARequired bool   `json:"mfaRequired,omitempty"` // true ise istemci challenge token ile MFA verify çağırmalı
	Challenge   string `json:"challenge,omitempty"`   // kısa-ömürlü intermediate JWT
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)

	if ok, retryAfter := s.loginRate.Allow(ip); !ok {
		s.auditLog("", audit.LoginRateLimit, "", ip, audit.StatusFail,
			fmt.Sprintf("retry after %s", retryAfter.Round(time.Second)))
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))
		writeErr(w, http.StatusTooManyRequests, "çok fazla başarısız deneme — daha sonra tekrar deneyin")
		return
	}

	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if req.UID == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "uid ve password zorunlu")
		return
	}

	dn, err := s.ldap.FindUserDN(req.UID)
	if err != nil {
		s.auditLog(req.UID, audit.LoginFail, "", ip, audit.StatusFail, "user not found")
		writeErr(w, http.StatusUnauthorized, "geçersiz kimlik bilgileri")
		return
	}
	if err := s.ldap.VerifyCredentials(dn, req.Password); err != nil {
		slog.Info("login fail", "uid", req.UID, "ip", ip)
		s.auditLog(req.UID, audit.LoginFail, dn, ip, audit.StatusFail, "bind failed")
		writeErr(w, http.StatusUnauthorized, "geçersiz kimlik bilgileri")
		return
	}

	role := "user"
	if isAdmin, _ := s.ldap.IsAdmin(req.UID); isAdmin {
		role = "admin"
	}

	// MFA kontrolü
	mfa, _ := s.audit.GetMFA(req.UID)
	mfaActive := mfa != nil && mfa.Enabled

	if mfaActive {
		// Challenge token ver — yalnızca /api/auth/mfa-verify çağrılabilir
		challenge, err := auth.Issue(s.cfg.JWTSecret, req.UID+":mfa-challenge", role, 5*time.Minute)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "challenge token üretilemedi")
			return
		}
		s.auditLog(req.UID, audit.MFAChallenge, dn, ip, audit.StatusOK, "")
		writeJSON(w, http.StatusOK, loginResp{
			MFARequired: true,
			UID:         req.UID,
			Challenge:   challenge,
		})
		return
	}

	// MFA zorunluysa ama kullanıcı henüz aktive etmediyse: yine token veriyoruz
	// ama frontend Profile sayfasında enrollment ekranı zorlar (mfa.required true).

	token, err := auth.Issue(s.cfg.JWTSecret, req.UID, role, 12*time.Hour)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token üretilemedi")
		return
	}
	slog.Info("login ok", "uid", req.UID, "role", role, "ip", ip)
	s.auditLog(req.UID, audit.Login, dn, ip, audit.StatusOK, "role="+role)
	writeJSON(w, http.StatusOK, loginResp{Token: token, UID: req.UID, Role: role})
}

type mfaVerifyReq struct {
	Challenge  string `json:"challenge"`
	Code       string `json:"code"`
	BackupCode string `json:"backupCode,omitempty"`
}

// handleMFAVerify challenge token'ı + TOTP kodu (veya backup code) ile
// gerçek oturum token'ını verir.
func (s *Server) handleMFAVerify(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)

	var req mfaVerifyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Challenge == "" {
		writeErr(w, http.StatusBadRequest, "challenge zorunlu")
		return
	}
	if req.Code == "" && req.BackupCode == "" {
		writeErr(w, http.StatusBadRequest, "code veya backupCode zorunlu")
		return
	}

	cc, err := auth.Parse(s.cfg.JWTSecret, req.Challenge)
	if err != nil || !strings.HasSuffix(cc.UID, ":mfa-challenge") {
		writeErr(w, http.StatusUnauthorized, "challenge geçersiz")
		return
	}
	uid := strings.TrimSuffix(cc.UID, ":mfa-challenge")

	rec, err := s.audit.GetMFA(uid)
	if err != nil || rec == nil || !rec.Enabled {
		writeErr(w, http.StatusUnauthorized, "mfa kayıtlı değil")
		return
	}

	verified := false
	if req.Code != "" {
		verified = totp.Validate(strings.TrimSpace(req.Code), rec.Secret())
	}
	if !verified && req.BackupCode != "" {
		ok, err := s.audit.ConsumeBackupCode(uid, audit.HashCode(strings.TrimSpace(req.BackupCode)))
		if err == nil && ok {
			verified = true
		}
	}
	if !verified {
		s.auditLog(uid, audit.MFAFail, "", ip, audit.StatusFail, "")
		writeErr(w, http.StatusUnauthorized, "kod hatalı")
		return
	}

	// Tam oturum token'ı
	token, err := auth.Issue(s.cfg.JWTSecret, uid, cc.Role, 12*time.Hour)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token üretilemedi")
		return
	}
	slog.Info("login ok via mfa", "uid", uid, "ip", ip)
	s.auditLog(uid, audit.Login, "", ip, audit.StatusOK, "via mfa role="+cc.Role)
	writeJSON(w, http.StatusOK, loginResp{Token: token, UID: uid, Role: cc.Role})
}
