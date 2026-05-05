package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
)

func (s *Server) handleExportLDIF(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	filename := time.Now().UTC().Format("ldap-export-2006-01-02-150405.ldif")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)

	if err := s.ldap.ExportLDIF(w); err != nil {
		s.auditLog(actor, audit.LDIFExport, "", ip, audit.StatusFail, err.Error())
		w.Write([]byte("\n# export error: " + err.Error() + "\n"))
		return
	}
	s.auditLog(actor, audit.LDIFExport, "", ip, audit.StatusOK, "")
}

func (s *Server) handleImportLDIF(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(ctxUser).(*auth.Claims).UID
	ip := clientIP(r)

	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
	defer r.Body.Close()

	res, err := s.ldap.ImportLDIF(r.Body)
	if err != nil && res == nil {
		s.auditLog(actor, audit.LDIFImport, "", ip, audit.StatusFail, err.Error())
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	status := audit.StatusOK
	if res.Failed > 0 {
		status = audit.StatusFail
	}
	s.auditLog(actor, audit.LDIFImport, "", ip, status,
		fmt.Sprintf("added=%d failed=%d", res.Added, res.Failed))
	writeJSON(w, http.StatusOK, res)
}
