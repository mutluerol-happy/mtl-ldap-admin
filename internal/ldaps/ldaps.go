package ldaps

import (
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	goldap "github.com/go-ldap/ldap/v3"
)

// CertDir cert + key dosyalarının yazıldığı dizin.
// slapd bunları okuyabilmeli — RHEL/Rocky'de slapd "ldap" user altında çalışır.
//
// Path /etc/openldap/certs sadece bazı paketlerde NSS DB içeriyor; bizim file
// path'i kendi dizinimiz olsun. Permission 0750 (owner: root, group: ldap),
// dosyalar 0640.
const CertDir = "/etc/mtl-ldap-admin/ssl"

const (
	CertFileName   = "server.crt"
	KeyFileName    = "server.key"
	CACertFileName = "ca.crt"
)

// ParsedCert PEM-encoded cert'ten okunan kullanıcıya gösterilebilir alanlar.
type ParsedCert struct {
	Subject   string
	Issuer    string
	NotBefore time.Time
	NotAfter  time.Time
	Hostnames []string
}

// ParseCertPEM cert PEM bytes'tan x509 parse eder. Hatalıysa erken return.
// Bu fonksiyon ÖNCEDEN çağrılır — geçersiz bir PEM'i diske YAZMA.
func ParseCertPEM(certPEM []byte) (*ParsedCert, error) {
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return nil, fmt.Errorf("PEM decode başarısız (CERTIFICATE bloğu yok)")
	}
	if block.Type != "CERTIFICATE" {
		return nil, fmt.Errorf("PEM tipi CERTIFICATE değil: %s", block.Type)
	}
	c, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("x509 parse: %w", err)
	}
	hostnames := append([]string{}, c.DNSNames...)
	if c.Subject.CommonName != "" {
		hostnames = append(hostnames, c.Subject.CommonName)
	}
	return &ParsedCert{
		Subject:   c.Subject.String(),
		Issuer:    c.Issuer.String(),
		NotBefore: c.NotBefore,
		NotAfter:  c.NotAfter,
		Hostnames: hostnames,
	}, nil
}

// ValidateKeyPEM key bytes'in geçerli bir PEM private key olduğunu doğrular.
// Cert ile pair olduğunu buradan teyit etmiyoruz (matching için ekstra kod
// gerekir, başlangıç yeterli kontrol).
func ValidateKeyPEM(keyPEM []byte) error {
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return fmt.Errorf("PEM decode başarısız")
	}
	t := strings.ToUpper(block.Type)
	if !strings.Contains(t, "PRIVATE KEY") {
		return fmt.Errorf("PEM tipi private key değil: %s", block.Type)
	}
	return nil
}

// WriteCerts cert + key + (opsiyonel) ca'yı CertDir'a yazar.
// Önce temp dosyaya yazıp atomic rename — slapd okurken bozuk dosya görmesin.
func WriteCerts(certPEM, keyPEM, caPEM []byte) (certPath, keyPath, caPath string, err error) {
	if err = os.MkdirAll(CertDir, 0o750); err != nil {
		return "", "", "", fmt.Errorf("mkdir %s: %w", CertDir, err)
	}
	certPath = filepath.Join(CertDir, CertFileName)
	keyPath = filepath.Join(CertDir, KeyFileName)
	if err = atomicWrite(certPath, certPEM, 0o644); err != nil {
		return "", "", "", err
	}
	if err = atomicWrite(keyPath, keyPEM, 0o640); err != nil {
		return "", "", "", err
	}
	if len(caPEM) > 0 {
		caPath = filepath.Join(CertDir, CACertFileName)
		if err = atomicWrite(caPath, caPEM, 0o644); err != nil {
			return "", "", "", err
		}
	}
	return certPath, keyPath, caPath, nil
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	return os.Rename(tmp, path)
}

// ApplyConfig slapd cn=config'e olcTLS* attribute'larını yazar.
//
// Önemli detaylar:
//   - cn=config'e yazmak için bind hesabının yetkisi olmalı (genelde
//     SASL/EXTERNAL via ldapi:// yetkilidir). Burada normal LDAP bind
//     kullanıyoruz — config'te `LDAPS_ADMIN_DN` ayrı bind verirseniz onu
//     kullanın; yoksa ana bindDN cn=config'e access vermeli.
//   - olcTLSVerifyClient hardening için "demand" yapılır (mTLS); test/dev
//     ortamında "never" daha güvenli (client cert isteme).
//   - ApplyConfig sadece DOSYALAR yazıldıktan SONRA çağrılmalı — sırayı
//     bozmak slapd'ı bozar.
//
// Apply sonrası slapd cn=config değişikliklerini RUNTIME uygular; restart
// gerekmez. Ama listen URL ekleme (-h "ldap:/// ldaps:///") sysconfig
// dosyasında yapılır, bu UI'da değil — operasyonel adım, README'de.
func ApplyConfig(ldapURL, bindDN, bindPW, certPath, keyPath, caPath string) error {
	conn, err := goldap.DialURL(ldapURL)
	if err != nil {
		return fmt.Errorf("ldap dial: %w", err)
	}
	defer conn.Close()
	if err := conn.Bind(bindDN, bindPW); err != nil {
		return fmt.Errorf("ldap bind: %w", err)
	}

	// cn=config replace — her attribute önce mevcut mu kontrol et yapmıyoruz;
	// REPLACE create-or-update gibi davranır openldap'te.
	mod := goldap.NewModifyRequest("cn=config", nil)
	mod.Replace("olcTLSCertificateFile", []string{certPath})
	mod.Replace("olcTLSCertificateKeyFile", []string{keyPath})
	if caPath != "" {
		mod.Replace("olcTLSCACertificateFile", []string{caPath})
	}
	// CipherSuite belirleyebiliriz; varsayılan modern yeterli.
	if err := conn.Modify(mod); err != nil {
		return fmt.Errorf("modify cn=config: %w", err)
	}
	return nil
}
