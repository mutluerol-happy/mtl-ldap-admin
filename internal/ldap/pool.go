package ldap

import (
	"crypto/tls"
	"fmt"
	"strings"
	"sync"

	goldap "github.com/go-ldap/ldap/v3"
	"github.com/mutluerol-happy/mtl-ldap-admin/internal/config"
)

// Pool, admin servis hesabıyla bind edilmiş LDAP bağlantılarının havuzu.
// Get() ile alıp Put() ile geri ver. Sağlık kontrolü WhoAmI ile yapılır.
type Pool struct {
	cfg    config.LDAPConfig
	max    int
	mu     sync.Mutex
	free   []*goldap.Conn
	closed bool
}

func NewPool(cfg config.LDAPConfig, max int) (*Pool, error) {
	p := &Pool{cfg: cfg, max: max}
	c, err := p.dialAdmin()
	if err != nil {
		return nil, fmt.Errorf("başlangıç bağlantısı başarısız: %w", err)
	}
	p.Put(c)
	return p, nil
}

// connect yalnızca dial+TLS yapar, bind etmez. Login akışında kullanıcı
// kendi DN'iyle bind edebilsin diye.
func (p *Pool) connect() (*goldap.Conn, error) {
	var opts []goldap.DialOpt
	if p.cfg.InsecureTLS {
		opts = append(opts, goldap.DialWithTLSConfig(&tls.Config{InsecureSkipVerify: true}))
	}
	conn, err := goldap.DialURL(p.cfg.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}
	if p.cfg.StartTLS {
		if err := conn.StartTLS(&tls.Config{InsecureSkipVerify: p.cfg.InsecureTLS}); err != nil {
			conn.Close()
			return nil, fmt.Errorf("starttls: %w", err)
		}
	}
	return conn, nil
}

func (p *Pool) dialAdmin() (*goldap.Conn, error) {
	c, err := p.connect()
	if err != nil {
		return nil, err
	}
	if err := c.Bind(p.cfg.BindDN, p.cfg.BindPassword); err != nil {
		c.Close()
		return nil, fmt.Errorf("admin bind: %w", err)
	}
	return c, nil
}

func (p *Pool) Get() (*goldap.Conn, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, fmt.Errorf("pool kapalı")
	}
	if n := len(p.free); n > 0 {
		c := p.free[n-1]
		p.free = p.free[:n-1]
		p.mu.Unlock()
		// sağlık kontrolü; ölü bağlantıyı bırak yenisini aç
		if _, err := c.WhoAmI(nil); err != nil {
			c.Close()
			return p.dialAdmin()
		}
		return c, nil
	}
	p.mu.Unlock()
	return p.dialAdmin()
}

func (p *Pool) Put(c *goldap.Conn) {
	if c == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || len(p.free) >= p.max {
		c.Close()
		return
	}
	p.free = append(p.free, c)
}

func (p *Pool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	for _, c := range p.free {
		c.Close()
	}
	p.free = nil
}

// VerifyCredentials ayrı bir bağlantı açıp kullanıcı DN+parolasıyla bind dener.
// Login için kullanılır; havuza geri konmaz, tüketim sonu kapanır.
func (p *Pool) VerifyCredentials(dn, password string) error {
	c, err := p.connect()
	if err != nil {
		return err
	}
	defer c.Close()
	return c.Bind(dn, password)
}

// Cfg pool'un config'ini açığa çıkarır (handler'larda BaseDN gerekebilir).
func (p *Pool) Cfg() config.LDAPConfig { return p.cfg }

// ConnectionInfo bağlantının şifrelenme durumunu UI'a açıklamak için.
type ConnectionInfo struct {
	URL     string `json:"url"`
	Type    string `json:"type"` // ldaps | starttls | plain
	TLS     bool   `json:"tls"`
	Warning string `json:"warning,omitempty"`
}

func (p *Pool) ConnectionInfo() ConnectionInfo {
	url := strings.ToLower(p.cfg.URL)
	info := ConnectionInfo{URL: p.cfg.URL}
	switch {
	case strings.HasPrefix(url, "ldaps://"):
		info.Type = "ldaps"
		info.TLS = true
	case p.cfg.StartTLS:
		info.Type = "starttls"
		info.TLS = true
	default:
		info.Type = "plain"
		info.TLS = false
		info.Warning = "Connection is unencrypted. Use ldaps:// or enable StartTLS for production."
	}
	if p.cfg.InsecureTLS && info.TLS {
		info.Warning = "TLS is enabled but certificate verification is disabled."
	}
	return info
}
