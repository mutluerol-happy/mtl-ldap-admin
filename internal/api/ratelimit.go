package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimiter sliding window olmayan basit fixed-window limiter.
// Her IP için ayrı bucket; pencere bittiğinde sayaç sıfırlanır.
// Login endpoint'inde brute-force korumasıdır.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    int
	window  time.Duration
}

type bucket struct {
	count int
	reset time.Time
}

func NewRateLimiter(rate int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		window:  window,
	}
	if rate > 0 {
		go rl.gc()
	}
	return rl
}

func (rl *RateLimiter) gc() {
	t := time.NewTicker(rl.window)
	defer t.Stop()
	for range t.C {
		rl.mu.Lock()
		now := time.Now()
		for k, b := range rl.buckets {
			if now.After(b.reset) {
				delete(rl.buckets, k)
			}
		}
		rl.mu.Unlock()
	}
}

// Allow rate altındaysa true döner. Aşıldıysa false ve kalan süre.
// rate==0 ise her zaman izin verir (devre dışı).
func (rl *RateLimiter) Allow(key string) (bool, time.Duration) {
	if rl.rate <= 0 {
		return true, 0
	}
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok || now.After(b.reset) {
		rl.buckets[key] = &bucket{count: 1, reset: now.Add(rl.window)}
		return true, 0
	}
	if b.count >= rl.rate {
		return false, b.reset.Sub(now)
	}
	b.count++
	return true, 0
}

// clientIP X-Forwarded-For ve X-Real-IP başlıklarını dener, yoksa RemoteAddr'dan
// host kısmını alır. Trusted proxy varsayımı yapar; production'da reverse proxy
// arkasındadır.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.Index(xff, ","); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
