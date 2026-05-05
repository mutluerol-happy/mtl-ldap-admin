package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/mutluerol-happy/mtl-ldap-admin/internal/auth"
)

type ctxKey string

const ctxUser ctxKey = "user"

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		claims, err := auth.Parse(s.cfg.JWTSecret, strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "invalid token")
			return
		}
		ctx := context.WithValue(r.Context(), ctxUser, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return s.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(ctxUser).(*auth.Claims)
		if !ok || claims.Role != "admin" {
			writeErr(w, http.StatusForbidden, "admin yetkisi gerekli")
			return
		}
		next.ServeHTTP(w, r)
	}))
}
