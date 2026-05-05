package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/api"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/audit"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/config"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/ldap"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/webhooks"
	"github.com/mutluerol-happy/mtl-ldap-admin/web"
)

func main() {
	_ = godotenv.Load() // .env opsiyonel

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	pool, err := ldap.NewPool(cfg.LDAP, 10)
	if err != nil {
		slog.Error("ldap pool init failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	auditStore, err := audit.Open(cfg.AuditDBPath)
	if err != nil {
		slog.Error("audit store init failed", "err", err)
		os.Exit(1)
	}
	defer auditStore.Close()

	// Webhook dispatcher: audit eventlerini fan-out eder.
	dispatcher := webhooks.New(auditStore)
	auditStore.SetDispatcher(dispatcher.Dispatch)

	webFS, err := web.Dist()
	if err != nil {
		slog.Warn("embedded frontend okunamadı, sadece API çalışacak", "err", err)
	}

	srv := api.NewServer(cfg, pool, auditStore, webFS)

	httpSrv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      srv,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("server starting", "addr", cfg.ListenAddr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	slog.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
}
