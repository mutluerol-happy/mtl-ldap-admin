package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
)

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	users, err := s.ldap.ListUsers(q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": users,
		"count": len(users),
	})
}

func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	u, err := s.ldap.GetUser(uid)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in ldap.CreateUserInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	dn, err := s.ldap.CreateUser(in)
	if err != nil {
		s.auditLog(actor, audit.UserCreate, in.UID, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.UserCreate, dn, ip, audit.StatusOK, "")
	writeJSON(w, http.StatusCreated, map[string]string{"dn": dn, "uid": in.UID})
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")

	var in ldap.UpdateUserInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if err := s.ldap.UpdateUser(uid, in); err != nil {
		s.auditLog(actor, audit.UserUpdate, uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.UserUpdate, uid, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

// handleModifyUserAttributes generic LDAP modify (add/replace/delete) uygular.
// PUT /api/users/{uid} sadece firstName/lastName/email gibi sabit alanları
// değiştirir; bu endpoint herhangi bir attribute için kullanılır (telephoneNumber,
// title, departmentNumber, employeeNumber vs.). Schema kısıtları frontend'de
// uygulanır, backend protected attribute'ları (uid, userPassword, objectClass,
// pwd*) reddeder.
func (s *Server) handleModifyUserAttributes(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")

	var in ldap.AttributeModification
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if err := s.ldap.ModifyAttributes(uid, in); err != nil {
		s.auditLog(actor, audit.UserUpdate, uid, ip, audit.StatusFail, "attrs: "+err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// Detayda hangi attr'ları dokunduğumuzu kabaca yaz — audit için faydalı.
	touched := make([]string, 0, 8)
	for k := range in.Add {
		touched = append(touched, "+"+k)
	}
	for k := range in.Replace {
		touched = append(touched, "~"+k)
	}
	for k := range in.Delete {
		touched = append(touched, "-"+k)
	}
	s.auditLog(actor, audit.UserUpdate, uid, ip, audit.StatusOK, "attrs: "+strings.Join(touched, ","))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")

	if err := s.ldap.DeleteUser(uid); err != nil {
		s.auditLog(actor, audit.UserDelete, uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.UserDelete, uid, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

type setPasswordReq struct {
	NewPassword string `json:"newPassword"`
}

func (s *Server) handleSetUserPassword(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")

	var req setPasswordReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.NewPassword == "" {
		writeErr(w, http.StatusBadRequest, "newPassword zorunlu")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "parola en az 8 karakter olmalı")
		return
	}
	if err := s.ldap.SetPassword(uid, req.NewPassword); err != nil {
		s.auditLog(actor, audit.UserPasswordReset, uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.UserPasswordReset, uid, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnlockUser(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")

	if err := s.ldap.UnlockAccount(uid); err != nil {
		s.auditLog(actor, audit.UserUnlock, uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.UserUnlock, uid, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

type changePasswordReq struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

func (s *Server) handleChangeOwnPassword(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	ip := clientIP(r)

	var req changePasswordReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OldPassword == "" || req.NewPassword == "" {
		writeErr(w, http.StatusBadRequest, "oldPassword ve newPassword zorunlu")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "parola en az 8 karakter olmalı")
		return
	}
	if err := s.ldap.ChangeOwnPassword(claims.UID, req.OldPassword, req.NewPassword); err != nil {
		s.auditLog(claims.UID, audit.PasswordChange, claims.UID, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(claims.UID, audit.PasswordChange, claims.UID, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	claims := r.Context().Value(ctxUser).(*auth.Claims)
	u, err := s.ldap.GetUser(claims.UID)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":       u,
		"role":       claims.Role,
		"connection": s.ldap.ConnectionInfo(),
	})
}

// handleSetUserDisabled kullanıcıyı kalıcı pasifleştirir/aktive eder.
// POST /api/users/{uid}/disable     → disable
// POST /api/users/{uid}/enable      → enable
// İki ayrı route, body yok; idempotent.
func (s *Server) handleSetUserDisabled(disabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor := r.Context().Value(ctxUser).(*auth.Claims).UID
		ip := clientIP(r)
		uid := r.PathValue("uid")
		if err := s.ldap.SetDisabled(uid, disabled); err != nil {
			act := audit.Action("user.enable")
			if disabled {
				act = audit.Action("user.disable")
			}
			s.auditLog(actor, act, uid, ip, audit.StatusFail, err.Error())
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		act := audit.Action("user.enable")
		if disabled {
			act = audit.Action("user.disable")
		}
		s.auditLog(actor, act, uid, ip, audit.StatusOK, "")
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleModifyEntryObjectClasses entry'nin objectClass listesini günceller.
// POST /api/entries/objectClasses?dn=<DN>
// Body: { "add": ["shadowAccount"], "remove": ["pwdReset"] }
//
// Kullanım örnekleri:
//   - User'a shadowAccount eklemek (shadowExpire için)
//   - Group'a posixGroup eklemek (gidNumber için)
func (s *Server) handleModifyEntryObjectClasses(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	dn := r.URL.Query().Get("dn")
	if dn == "" {
		writeErr(w, http.StatusBadRequest, "dn zorunlu")
		return
	}
	var in ldap.ObjectClassChange
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if err := s.ldap.ModifyObjectClasses(dn, in); err != nil {
		s.auditLog(actor, audit.Action("entry.objectClass"), dn, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	detail := ""
	if len(in.Add) > 0 {
		detail += "+" + strings.Join(in.Add, ",")
	}
	if len(in.Remove) > 0 {
		if detail != "" {
			detail += " "
		}
		detail += "-" + strings.Join(in.Remove, ",")
	}
	s.auditLog(actor, audit.Action("entry.objectClass"), dn, ip, audit.StatusOK, detail)
	w.WriteHeader(http.StatusNoContent)
}

// handleMoveUser bir user'ı yeni parent OU'ya taşır.
// POST /api/users/{uid}/move
// Body: { "newParent": "ou=archive,dc=mtl,dc=com" }
func (s *Server) handleMoveUser(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")
	var in struct {
		NewParent string `json:"newParent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if in.NewParent == "" {
		writeErr(w, http.StatusBadRequest, "newParent zorunlu")
		return
	}
	if err := s.ldap.MoveUser(uid, in.NewParent); err != nil {
		s.auditLog(actor, audit.Action("user.move"), uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.Action("user.move"), uid, ip, audit.StatusOK, "→ "+in.NewParent)
	w.WriteHeader(http.StatusNoContent)
}

// handleListContainerOUs OU picker dialog'u için container DN'leri döner.
// GET /api/tree/containers
func (s *Server) handleListContainerOUs(w http.ResponseWriter, r *http.Request) {
	dns, err := s.ldap.ListContainerOUs()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": dns})
}

// handleModifyEntry generic entry edit (DN Tree'den çağrılır).
// PATCH /api/entries/attributes?dn=<DN>
// Body: AttributeModification (add/replace/delete)
func (s *Server) handleModifyEntry(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	dn := r.URL.Query().Get("dn")
	if dn == "" {
		writeErr(w, http.StatusBadRequest, "dn zorunlu")
		return
	}
	var in ldap.AttributeModification
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if err := s.ldap.ModifyEntry(dn, in); err != nil {
		s.auditLog(actor, audit.Action("entry.modify"), dn, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	touched := make([]string, 0, 8)
	for k := range in.Add {
		touched = append(touched, "+"+k)
	}
	for k := range in.Replace {
		touched = append(touched, "~"+k)
	}
	for k := range in.Delete {
		touched = append(touched, "-"+k)
	}
	s.auditLog(actor, audit.Action("entry.modify"), dn, ip, audit.StatusOK, strings.Join(touched, ","))
	w.WriteHeader(http.StatusNoContent)
}
