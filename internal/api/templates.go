package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
)

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	tpls, err := s.audit.ListTemplates()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": tpls, "count": len(tpls)})
}

func (s *Server) handleGetTemplate(w http.ResponseWriter, r *http.Request) {
	t, err := s.audit.GetTemplate(r.PathValue("name"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type saveTemplateReq struct {
	Name   string               `json:"name"`
	Config audit.TemplateConfig `json:"config"`
}

func (s *Server) handleSaveTemplate(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	pathName := r.PathValue("name") // PUT için doluyu kullan

	var req saveTemplateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	name := req.Name
	if pathName != "" {
		name = pathName
	}
	if name == "" {
		writeErr(w, http.StatusBadRequest, "isim zorunlu")
		return
	}

	existing, _ := s.audit.GetTemplate(name)
	if err := s.audit.SaveTemplate(name, req.Config); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	action := audit.TemplateCreate
	if existing != nil {
		action = audit.TemplateUpdate
	}
	s.auditLog(actor, action, name, ip, audit.StatusOK, "")
	writeJSON(w, http.StatusOK, map[string]string{"name": name})
}

func (s *Server) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	name := r.PathValue("name")

	if err := s.audit.DeleteTemplate(name); err != nil {
		s.auditLog(actor, audit.TemplateDelete, name, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.auditLog(actor, audit.TemplateDelete, name, ip, audit.StatusOK, "")
	w.WriteHeader(http.StatusNoContent)
}

type applyTemplateReq struct {
	UID       string `json:"uid"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Email     string `json:"email,omitempty"` // boşsa template default'undan üretilir
	Password  string `json:"password,omitempty"`
}

type applyTemplateResp struct {
	DN                string            `json:"dn"`
	UID               string            `json:"uid"`
	GeneratedPassword string            `json:"generatedPassword,omitempty"`
	GroupsAdded       []string          `json:"groupsAdded,omitempty"`
	GroupErrors       map[string]string `json:"groupErrors,omitempty"`
}

func (s *Server) handleApplyTemplate(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)
	name := r.PathValue("name")

	tpl, err := s.audit.GetTemplate(name)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}

	var req applyTemplateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if req.UID == "" || req.FirstName == "" || req.LastName == "" {
		writeErr(w, http.StatusBadRequest, "uid, firstName, lastName zorunlu")
		return
	}

	// Email default
	email := req.Email
	if email == "" && tpl.Config.DefaultEmailDomain != "" {
		email = req.UID + "@" + tpl.Config.DefaultEmailDomain
	}

	// Password
	password := req.Password
	resp := applyTemplateResp{}
	if password == "" && tpl.Config.PasswordStrategy == "random" {
		gen, err := ldap.GeneratePassword(tpl.Config.PasswordLength)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		password = gen
		resp.GeneratedPassword = gen
	}

	// Create user
	dn, err := s.ldap.CreateUser(ldap.CreateUserInput{
		UID: req.UID, FirstName: req.FirstName, LastName: req.LastName,
		Email: email, Password: password,
	})
	if err != nil {
		s.auditLog(actor, audit.TemplateApply, name, ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	resp.DN = dn
	resp.UID = req.UID

	// Add to groups
	resp.GroupErrors = map[string]string{}
	for _, cn := range tpl.Config.Groups {
		if err := s.ldap.AddGroupMember(cn, req.UID); err != nil {
			resp.GroupErrors[cn] = err.Error()
			continue
		}
		resp.GroupsAdded = append(resp.GroupsAdded, cn)
	}
	if len(resp.GroupErrors) == 0 {
		resp.GroupErrors = nil
	}

	s.auditLog(actor, audit.TemplateApply, name, ip, audit.StatusOK,
		fmt.Sprintf("uid=%s groups=%d", req.UID, len(resp.GroupsAdded)))
	writeJSON(w, http.StatusCreated, resp)
}
