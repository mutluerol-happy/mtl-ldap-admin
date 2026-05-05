package api

import (
	"encoding/json"
	"net/http"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
)

const (
	OUCreate audit.Action = "ou.create"
	OUDelete audit.Action = "ou.delete"
)

func (s *Server) handleListOUs(w http.ResponseWriter, r *http.Request) {
	ous, err := s.ldap.ListOUs()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": ous,
		"count": len(ous),
	})
}

func (s *Server) handleCreateOU(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in ldap.CreateOUInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	dn, err := s.ldap.CreateOU(in)
	if err != nil {
		s.auditLog(actor, OUCreate, in.Name, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, OUCreate, dn, ip, audit.StatusOK, "")
	writeJSON(w, http.StatusCreated, map[string]string{"dn": dn})
}

type deleteOUReq struct {
	DN string `json:"dn"`
}

func (s *Server) handleDeleteOU(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var req deleteOUReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DN == "" {
		writeErr(w, http.StatusBadRequest, "dn zorunlu")
		return
	}
	if err := s.ldap.DeleteOU(req.DN); err != nil {
		s.auditLog(actor, OUDelete, req.DN, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, OUDelete, req.DN, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}
