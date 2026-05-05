package api

import (
	"encoding/json"
	"net/http"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
)

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	groups, err := s.ldap.ListGroups(q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": groups,
		"count": len(groups),
	})
}

func (s *Server) handleGetGroup(w http.ResponseWriter, r *http.Request) {
	cn := r.PathValue("cn")
	g, err := s.ldap.GetGroup(cn)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var in ldap.CreateGroupInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	dn, err := s.ldap.CreateGroup(in)
	if err != nil {
		s.auditLog(actor, audit.GroupCreate, in.CN, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.GroupCreate, dn, ip, audit.StatusOK, "")
	writeJSON(w, http.StatusCreated, map[string]string{"dn": dn, "cn": in.CN})
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	cn := r.PathValue("cn")

	if err := s.ldap.DeleteGroup(cn); err != nil {
		s.auditLog(actor, audit.GroupDelete, cn, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.GroupDelete, cn, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

type memberReq struct {
	UID string `json:"uid"`
}

func (s *Server) handleAddGroupMember(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	cn := r.PathValue("cn")

	var req memberReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UID == "" {
		writeErr(w, http.StatusBadRequest, "uid zorunlu")
		return
	}
	if err := s.ldap.AddGroupMember(cn, req.UID); err != nil {
		s.auditLog(actor, audit.GroupAddMember, cn+"/"+req.UID, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.GroupAddMember, cn+"/"+req.UID, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	cn := r.PathValue("cn")
	uid := r.PathValue("uid")

	if err := s.ldap.RemoveGroupMember(cn, uid); err != nil {
		s.auditLog(actor, audit.GroupRemoveMember, cn+"/"+uid, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.GroupRemoveMember, cn+"/"+uid, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}
