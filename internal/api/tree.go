package api

import (
	"net/http"
)

func (s *Server) handleTreeChildren(w http.ResponseWriter, r *http.Request) {
	dn := r.URL.Query().Get("dn")
	children, err := s.ldap.ListChildren(dn)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": children,
		"count": len(children),
	})
}

func (s *Server) handleGetEntry(w http.ResponseWriter, r *http.Request) {
	dn := r.URL.Query().Get("dn")
	if dn == "" {
		writeErr(w, http.StatusBadRequest, "dn zorunlu")
		return
	}
	e, err := s.ldap.GetEntry(dn)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, e)
}
