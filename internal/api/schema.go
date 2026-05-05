package api

import (
	"net/http"
)

func (s *Server) handleGetSchema(w http.ResponseWriter, r *http.Request) {
	sch, err := s.ldap.LoadSchema()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sch)
}

func (s *Server) handleRefreshSchema(w http.ResponseWriter, r *http.Request) {
	s.ldap.RefreshSchema()
	w.WriteHeader(http.StatusNoContent)
}
