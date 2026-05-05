package api

import (
	"encoding/json"
	"net/http"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
)

const (
	PosixSet    audit.Action = "user.posix.set"
	PosixRemove audit.Action = "user.posix.remove"
)

func (s *Server) handleGetPosix(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	info, err := s.ldap.GetPosix(uid)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleSetPosix(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")

	var in ldap.SetPosixInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if err := s.ldap.SetPosix(uid, in); err != nil {
		s.auditLog(actor, PosixSet, uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, PosixSet, uid, ip, audit.StatusOK, "")
	// Güncel hali geri döndür ki frontend yeni atanan UID'yi görebilsin
	info, _ := s.ldap.GetPosix(uid)
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleRemovePosix(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	uid := r.PathValue("uid")

	if err := s.ldap.RemovePosix(uid); err != nil {
		s.auditLog(actor, PosixRemove, uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, PosixRemove, uid, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleNextUIDNumber(w http.ResponseWriter, r *http.Request) {
	n, err := s.ldap.NextUIDNumber()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"next": n})
}
