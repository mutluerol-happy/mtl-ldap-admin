package api

import (
	"net/http"
	"strconv"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
)

func (s *Server) handleAuditList(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		writeJSON(w, http.StatusOK, audit.ListResult{Items: []audit.Entry{}, Total: 0})
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	res, err := s.audit.List(audit.ListOpts{
		Limit:  limit,
		Offset: offset,
		Actor:  q.Get("actor"),
		Action: q.Get("action"),
		Status: q.Get("status"),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}
