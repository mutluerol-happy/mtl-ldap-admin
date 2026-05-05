package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
)

// handleSelfServiceConfig hangi reset metodlarının aktif olduğunu public olarak döner.
// (Frontend forgot sayfasının ne göstereceğini belirler.)
func (s *Server) handleSelfServiceConfig(w http.ResponseWriter, r *http.Request) {
	methods := []string{}
	for _, m := range s.cfg.SelfServiceMethods {
		ml := strings.ToLower(strings.TrimSpace(m))
		switch ml {
		case "email":
			// v0.10: önce DB-backed (UI'dan yapılan ayar), sonra .env fallback
			if s.mailDB.IsConfigured() || s.mail.IsConfigured() {
				methods = append(methods, "email")
			}
		case "sms":
			if s.smsDB.IsConfigured() || s.smsSender.IsConfigured() {
				methods = append(methods, "sms")
			}
		case "questions":
			methods = append(methods, "questions")
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"methods": methods,
		"enabled": len(methods) > 0,
	})
}

// requestResetReq forgot password ilk adım request.
type requestResetReq struct {
	UID    string `json:"uid"`
	Method string `json:"method"`
}

// handleRequestReset email/sms metodları için token üretir ve gönderir.
// "questions" metodu farklı bir akış: önce soruları getir, cevapları doğrula,
// sonra direkt yeni parolayı set et — handleVerifyQuestions'a bakın.
//
// **Enumeration koruması**: kullanıcı yoksa veya email/phone yoksa bile
// 200 ok dön ve aynı süreyi taklit et. UI her zaman generic mesaj gösterir.
func (s *Server) handleRequestReset(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)

	if ok, _ := s.resetRate.Allow(ip); !ok {
		writeErr(w, http.StatusTooManyRequests, "çok fazla istek; daha sonra deneyin")
		return
	}

	var req requestResetReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UID == "" || req.Method == "" {
		writeErr(w, http.StatusBadRequest, "uid ve method zorunlu")
		return
	}
	if err := audit.EnsureMethodAllowed(s.cfg.SelfServiceMethods, req.Method); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Method == "questions" {
		writeErr(w, http.StatusBadRequest, "questions metodu için /api/password-reset/questions kullanın")
		return
	}

	// Generic OK mesajı — hangi durumda olduğumuzdan bağımsız.
	finish := func() {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "ok",
			"message": "Eğer bu kullanıcı için kayıtlı bir " + req.Method + " bulunduysa, talimatlar gönderildi.",
		})
	}

	user, err := s.ldap.GetUser(req.UID)
	if err != nil {
		s.auditLog(req.UID, audit.SelfResetRequest, "", ip, audit.StatusFail, "user not found")
		// Kasıtlı gecikme — timing attack engelleme
		time.Sleep(150 * time.Millisecond)
		finish()
		return
	}

	ttl := time.Duration(s.cfg.ResetTokenTTLMin) * time.Minute
	token, err := s.audit.IssueResetToken(req.UID, req.Method, ip, ttl)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token üretilemedi")
		return
	}
	resetURL := fmt.Sprintf("%s/reset?token=%s", strings.TrimRight(s.cfg.PublicURL, "/"), token)

	switch req.Method {
	case "email":
		if user.Email == "" {
			s.auditLog(req.UID, audit.SelfResetRequest, "", ip, audit.StatusFail, "no email")
			finish()
			return
		}
		text := fmt.Sprintf("Merhaba,\n\nMTL Password Reset talebiniz alındı.\nAşağıdaki linke tıklayarak yeni parolanızı belirleyin:\n\n%s\n\nLink %d dakika geçerlidir. Bu talebi siz yapmadıysanız mesajı yok sayın.\n", resetURL, s.cfg.ResetTokenTTLMin)
		html := fmt.Sprintf(`<p>Merhaba,</p><p>MTL Password Reset talebiniz alındı.</p><p><a href="%s">Yeni parolayı belirle</a></p><p style="color:#666;font-size:12px">Link %d dakika geçerlidir. Bu talebi siz yapmadıysanız mesajı yok sayın.</p>`, resetURL, s.cfg.ResetTokenTTLMin)
		// v0.10: DB-backed mailer öncelikli; .env fallback
		var sendErr error
		if s.mailDB.IsConfigured() {
			sendErr = s.mailDB.Send(user.Email, "MTL Password Reset", text, html)
		} else {
			sendErr = s.mail.Send(user.Email, "MTL Password Reset", text, html)
		}
		if sendErr != nil {
			s.auditLog(req.UID, audit.SelfResetRequest, user.Email, ip, audit.StatusFail, sendErr.Error())
			finish() // hala generic dön, hatayı sızdırma
			return
		}
		s.auditLog(req.UID, audit.SelfResetRequest, user.Email, ip, audit.StatusOK, "email")

	case "sms":
		if user.Phone == "" {
			s.auditLog(req.UID, audit.SelfResetRequest, "", ip, audit.StatusFail, "no phone")
			finish()
			return
		}
		// v0.10: DB-backed sender template kullanır ({{phone}}, {{otp}},
		// {{message}}). otp olarak kısa bir kod yerine reset link'i gönderiyoruz
		// — caller template'i istediği gibi yazabilir.
		var sendErr error
		if s.smsDB.IsConfigured() {
			sendErr = s.smsDB.Send(user.Phone, map[string]string{
				"uid":  req.UID,
				"otp":  token, // template "{{otp}}" yerine token koyacak
				"link": resetURL,
				"ttl":  fmt.Sprintf("%d", s.cfg.ResetTokenTTLMin),
			})
		} else {
			body := fmt.Sprintf("MTL Password Reset: %s (link %d dk geçerli)", resetURL, s.cfg.ResetTokenTTLMin)
			sendErr = s.smsSender.Send(user.Phone, body)
		}
		if sendErr != nil {
			s.auditLog(req.UID, audit.SelfResetRequest, user.Phone, ip, audit.StatusFail, sendErr.Error())
			finish()
			return
		}
		s.auditLog(req.UID, audit.SelfResetRequest, user.Phone, ip, audit.StatusOK, "sms")
	}

	finish()
}

// handleResetWithToken token ile gelen yeni parolayı set eder.
type resetWithTokenReq struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

func (s *Server) handleResetWithToken(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)

	var req resetWithTokenReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" || req.NewPassword == "" {
		writeErr(w, http.StatusBadRequest, "token ve newPassword zorunlu")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "parola en az 8 karakter olmalı")
		return
	}

	tok, err := s.audit.VerifyResetToken(req.Token)
	if err != nil {
		s.auditLog("", audit.SelfResetVerify, "", ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.ldap.SetPassword(tok.UID, req.NewPassword); err != nil {
		s.auditLog(tok.UID, audit.SelfResetSuccess, tok.UID, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(tok.UID, audit.SelfResetSuccess, tok.UID, ip, audit.StatusOK, "via "+tok.Method)
	w.WriteHeader(http.StatusNoContent)
}

// ---- Security questions akışı ----

// handleListMyQuestions kullanıcının kayıtlı sorularını döner (oturumlu kullanıcı).
func (s *Server) handleListMyQuestions(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	qs, err := s.audit.ListSecurityQuestions(claims.UID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": qs, "count": len(qs)})
}

type setQuestionsReq struct {
	Questions []struct {
		Question string `json:"question"`
		Answer   string `json:"answer"`
	} `json:"questions"`
}

// handleSetMyQuestions kullanıcı kendi sorularını set eder.
func (s *Server) handleSetMyQuestions(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	ip := clientIP(r)

	var req setQuestionsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if len(req.Questions) < 3 {
		writeErr(w, http.StatusBadRequest, "en az 3 soru gerekli")
		return
	}
	hashed := make([]audit.SecurityQuestionInput, 0, len(req.Questions))
	for i, q := range req.Questions {
		if strings.TrimSpace(q.Question) == "" || strings.TrimSpace(q.Answer) == "" {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("soru %d boş olamaz", i+1))
			return
		}
		// Cevabı normalize et: lowercase + trim. Tutarlılık için.
		norm := strings.ToLower(strings.TrimSpace(q.Answer))
		hash, err := bcrypt.GenerateFromPassword([]byte(norm), bcrypt.DefaultCost)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		hashed = append(hashed, audit.SecurityQuestionInput{
			Question: strings.TrimSpace(q.Question), AnswerHash: string(hash),
		})
	}
	if err := s.audit.SetSecurityQuestions(claims.UID, hashed); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.auditLog(claims.UID, audit.SecurityQuestionsSet, claims.UID, ip, audit.StatusOK,
		fmt.Sprintf("count=%d", len(hashed)))
	w.WriteHeader(http.StatusNoContent)
}

// handleListPublicQuestions self-service akışı — uid verir, sorularını döner.
// Cevap içermez. Enumeration koruması yok burada çünkü kullanıcının uid'i
// zaten girildi ve bu akış public; soru metni zaten sadece sahibine anlamlı.
func (s *Server) handleListPublicQuestions(w http.ResponseWriter, r *http.Request) {
	uid := r.URL.Query().Get("uid")
	if uid == "" {
		writeErr(w, http.StatusBadRequest, "uid zorunlu")
		return
	}
	qs, err := s.audit.ListSecurityQuestions(uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Boş listeyi de aynen döner — enumeration için ek koruma yok bu akışta.
	writeJSON(w, http.StatusOK, map[string]any{"items": qs})
}

type verifyQuestionsReq struct {
	UID         string   `json:"uid"`
	Answers     []string `json:"answers"` // soruların index'lerine göre sıralı
	NewPassword string   `json:"newPassword"`
}

// handleVerifyQuestions cevapları doğrular ve direkt yeni parolayı set eder.
// 3 sorudan en az 2'sini doğru bilmek gerekir (configurable yapmadık;
// production için ekstra config eklenecek).
func (s *Server) handleVerifyQuestions(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)

	if ok, _ := s.resetRate.Allow(ip); !ok {
		writeErr(w, http.StatusTooManyRequests, "çok fazla deneme")
		return
	}

	var req verifyQuestionsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UID == "" || len(req.Answers) == 0 || req.NewPassword == "" {
		writeErr(w, http.StatusBadRequest, "uid, answers ve newPassword zorunlu")
		return
	}
	if err := audit.EnsureMethodAllowed(s.cfg.SelfServiceMethods, "questions"); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "parola en az 8 karakter olmalı")
		return
	}

	hashes, err := s.audit.GetSecurityQuestionHashes(req.UID)
	if err != nil || len(hashes) == 0 {
		s.auditLog(req.UID, audit.SelfResetFail, "", ip, audit.StatusFail, "no questions")
		writeErr(w, http.StatusUnauthorized, "doğrulama başarısız")
		return
	}
	if len(req.Answers) != len(hashes) {
		writeErr(w, http.StatusBadRequest, "cevap sayısı uyuşmuyor")
		return
	}

	correct := 0
	for i, h := range hashes {
		norm := strings.ToLower(strings.TrimSpace(req.Answers[i]))
		if err := bcrypt.CompareHashAndPassword([]byte(h), []byte(norm)); err == nil {
			correct++
		}
	}
	required := len(hashes) - 1 // 3 sorudan 2 doğru → en az "toplam-1"
	if required < 2 {
		required = 2
	}
	if correct < required {
		s.auditLog(req.UID, audit.SelfResetFail, "", ip, audit.StatusFail,
			fmt.Sprintf("only %d of %d correct", correct, len(hashes)))
		writeErr(w, http.StatusUnauthorized, "doğrulama başarısız")
		return
	}

	if err := s.ldap.SetPassword(req.UID, req.NewPassword); err != nil {
		s.auditLog(req.UID, audit.SelfResetSuccess, req.UID, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(req.UID, audit.SelfResetSuccess, req.UID, ip, audit.StatusOK, "via questions")
	w.WriteHeader(http.StatusNoContent)
}
