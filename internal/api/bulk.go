package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
)

type bulkCreateReq struct {
	Users         []ldap.CreateUserInput `json:"users"`
	GroupsToAddTo []string               `json:"groupsToAddTo,omitempty"` // her başarılı kullanıcıyı bu CN'lere ekle
}

func (s *Server) handleBulkCreateUsers(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var req bulkCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "geçersiz JSON")
		return
	}
	if len(req.Users) == 0 {
		writeErr(w, http.StatusBadRequest, "users boş olamaz")
		return
	}
	if len(req.Users) > 1000 {
		writeErr(w, http.StatusBadRequest, "tek istekte en fazla 1000 kullanıcı")
		return
	}

	summary := s.ldap.BulkCreateUsers(req.Users)

	// Başarılıları gruplara ekle
	if len(req.GroupsToAddTo) > 0 {
		for i, res := range summary.Results {
			if res.Status != "ok" {
				continue
			}
			for _, cn := range req.GroupsToAddTo {
				if err := s.ldap.AddGroupMember(cn, res.UID); err != nil {
					summary.Results[i].Error = fmt.Sprintf("group add failed: %v", err)
				}
			}
		}
	}

	s.auditLog(actor, audit.BulkUserCreate, "", ip, statusForSummary(summary),
		fmt.Sprintf("ok=%d failed=%d", summary.OK, summary.Failed))
	writeJSON(w, http.StatusOK, summary)
}

type bulkUIDsReq struct {
	UIDs []string `json:"uids"`
}

func (s *Server) handleBulkDeleteUsers(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var req bulkUIDsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.UIDs) == 0 {
		writeErr(w, http.StatusBadRequest, "uids zorunlu")
		return
	}
	if len(req.UIDs) > 500 {
		writeErr(w, http.StatusBadRequest, "tek istekte en fazla 500 kullanıcı")
		return
	}
	summary := s.ldap.BulkDeleteUsers(req.UIDs)
	s.auditLog(actor, audit.BulkUserDelete, "", ip, statusForSummary(summary),
		fmt.Sprintf("ok=%d failed=%d uids=%v", summary.OK, summary.Failed, req.UIDs))
	writeJSON(w, http.StatusOK, summary)
}

type bulkGroupOpReq struct {
	UIDs  []string `json:"uids"`
	Group string   `json:"group"` // CN
}

func (s *Server) handleBulkGroupAdd(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var req bulkGroupOpReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.UIDs) == 0 || req.Group == "" {
		writeErr(w, http.StatusBadRequest, "uids ve group zorunlu")
		return
	}
	summary := s.ldap.BulkAddToGroup(req.Group, req.UIDs)
	s.auditLog(actor, audit.BulkGroupAdd, req.Group, ip, statusForSummary(summary),
		fmt.Sprintf("ok=%d failed=%d", summary.OK, summary.Failed))
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleBulkGroupRemove(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var req bulkGroupOpReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.UIDs) == 0 || req.Group == "" {
		writeErr(w, http.StatusBadRequest, "uids ve group zorunlu")
		return
	}
	summary := s.ldap.BulkRemoveFromGroup(req.Group, req.UIDs)
	s.auditLog(actor, audit.BulkGroupRemove, req.Group, ip, statusForSummary(summary),
		fmt.Sprintf("ok=%d failed=%d", summary.OK, summary.Failed))
	writeJSON(w, http.StatusOK, summary)
}

type bulkResetReq struct {
	UIDs           []string `json:"uids"`
	PasswordLength int      `json:"passwordLength"`
}

func (s *Server) handleBulkResetPasswords(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	var req bulkResetReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.UIDs) == 0 {
		writeErr(w, http.StatusBadRequest, "uids zorunlu")
		return
	}
	summary := s.ldap.BulkResetPasswords(req.UIDs, req.PasswordLength)
	// Detayda parolaları LOGLAMIYORUZ — yalnızca sayım.
	s.auditLog(actor, audit.BulkPasswordReset, "", ip, statusForSummary(summary),
		fmt.Sprintf("ok=%d failed=%d", summary.OK, summary.Failed))
	writeJSON(w, http.StatusOK, summary)
}

func statusForSummary(s ldap.BulkSummary) audit.Status {
	if s.Failed > 0 && s.OK == 0 {
		return audit.StatusFail
	}
	return audit.StatusOK
}
