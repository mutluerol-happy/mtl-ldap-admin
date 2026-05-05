package ldap

import (
	"fmt"
	"strings"

	goldap "github.com/go-ldap/ldap/v3"
)

// User UI'a verilen temiz DTO. LDAP iç attribute'larını sızdırmaz.
type User struct {
	DN        string   `json:"dn"`
	UID       string   `json:"uid"`
	FirstName string   `json:"firstName"`
	LastName  string   `json:"lastName"`
	Email     string   `json:"email"`
	Phone     string   `json:"phone,omitempty"` // mobile attribute
	Groups    []string `json:"groups"`

	// ppolicy operational attributes (overlay aktifse dolu)
	PasswordChangedAt string `json:"passwordChangedAt,omitempty"`
	AccountLocked     bool   `json:"accountLocked"`
	AccountLockedTime string `json:"accountLockedTime,omitempty"`
	RecentFailures    int    `json:"recentFailures"`

	// v0.9: kalıcı disable. AccountLocked = ppolicy geçici lock; Disabled = admin
	// tarafından kalıcı pasifleştirme. İkisi farklı semantic.
	Disabled bool `json:"disabled"`
}

// ListUsers q boşsa tüm inetOrgPerson'ları döndürür, doluysa uid/cn/mail'de
// substring araması yapar. ldap.EscapeFilter ile injection güvenli.
func (p *Pool) ListUsers(q string) ([]User, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	var filter string
	if q == "" {
		filter = "(objectClass=inetOrgPerson)"
	} else {
		esc := goldap.EscapeFilter(q)
		filter = fmt.Sprintf("(&(objectClass=inetOrgPerson)(|(uid=*%s*)(cn=*%s*)(mail=*%s*)))",
			esc, esc, esc)
	}

	req := goldap.NewSearchRequest(
		p.cfg.UsersDN(),
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		500, 0, false,
		filter,
		// v0.8.1: ppolicy operational attr'ları (lock state).
		// v0.9: shadowExpire ve pwdAccountLockedTime'ın "ebedi" sentinel'ı
		// (000001010000Z) kalıcı disable işareti olarak kullanılır.
		[]string{"uid", "givenName", "sn", "mail", "memberOf",
			"pwdAccountLockedTime", "pwdFailureTime", "shadowExpire"},
		nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}

	out := make([]User, 0, len(res.Entries))
	for _, e := range res.Entries {
		locked := e.GetAttributeValue("pwdAccountLockedTime")
		shadow := e.GetAttributeValue("shadowExpire")
		// Disabled = sonsuz lockedTime sentinel'ı veya shadowExpire=0.
		// Geçici ppolicy lock'ları için locked değeri farklı (mevcut zaman damgası).
		disabled := locked == disabledSentinel || shadow == "0"
		// Eğer sadece sentinel ise AccountLocked'ı false yap — UI iki durumu
		// ayrı göstersin (disable chip'i vs. lock chip'i).
		isPpolicyLock := locked != "" && locked != disabledSentinel
		out = append(out, User{
			DN:                e.DN,
			UID:               e.GetAttributeValue("uid"),
			FirstName:         e.GetAttributeValue("givenName"),
			LastName:          e.GetAttributeValue("sn"),
			Email:             e.GetAttributeValue("mail"),
			Groups:            e.GetAttributeValues("memberOf"),
			AccountLockedTime: locked,
			AccountLocked:     isPpolicyLock,
			RecentFailures:    len(e.GetAttributeValues("pwdFailureTime")),
			Disabled:          disabled,
		})
	}
	return out, nil
}

// FindUserDN uid'den DN bulur (login için).
func (p *Pool) FindUserDN(uid string) (string, error) {
	c, err := p.Get()
	if err != nil {
		return "", err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		p.cfg.UsersDN(),
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		2, 0, false,
		fmt.Sprintf("(&(objectClass=inetOrgPerson)(uid=%s))", goldap.EscapeFilter(uid)),
		[]string{"dn"},
		nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return "", err
	}
	if len(res.Entries) == 0 {
		return "", fmt.Errorf("kullanıcı bulunamadı")
	}
	if len(res.Entries) > 1 {
		return "", fmt.Errorf("birden fazla kullanıcı eşleşti, uid benzersiz olmalı")
	}
	return res.Entries[0].DN, nil
}

// CreateUserInput UI'dan gelen form. UID otomatik DN'e çevrilir.
type CreateUserInput struct {
	UID       string `json:"uid"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Email     string `json:"email"`
	Password  string `json:"password"` // {SSHA} hash'lemeyi sunucu yapacaksa düz metin gönder
}

func (p *Pool) CreateUser(in CreateUserInput) (string, error) {
	if in.UID == "" || in.FirstName == "" || in.LastName == "" {
		return "", fmt.Errorf("uid, firstName, lastName zorunlu")
	}

	c, err := p.Get()
	if err != nil {
		return "", err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("uid=%s,%s", in.UID, p.cfg.UsersDN())
	req := goldap.NewAddRequest(dn, nil)
	req.Attribute("objectClass", []string{"inetOrgPerson", "organizationalPerson", "person", "top"})
	req.Attribute("uid", []string{in.UID})
	req.Attribute("cn", []string{in.FirstName + " " + in.LastName})
	req.Attribute("givenName", []string{in.FirstName})
	req.Attribute("sn", []string{in.LastName})
	if in.Email != "" {
		req.Attribute("mail", []string{in.Email})
	}
	if in.Password != "" {
		// OpenLDAP ppolicy/pw-sha2 modülü varsa düz metin gelse de sunucu hash'ler.
		// Yoksa client-side {SSHA} üretmek gerekir; ileri iterasyonda eklenecek.
		req.Attribute("userPassword", []string{in.Password})
	}

	if err := c.Add(req); err != nil {
		return "", fmt.Errorf("ldap add: %w", err)
	}
	return dn, nil
}

// GetUser tek kullanıcıyı uid ile getirir. ppolicy operational attribute'ları dahil.
func (p *Pool) GetUser(uid string) (*User, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		p.cfg.UsersDN(),
		goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		2, 0, false,
		fmt.Sprintf("(&(objectClass=inetOrgPerson)(uid=%s))", goldap.EscapeFilter(uid)),
		[]string{
			"uid", "givenName", "sn", "mail", "mobile", "memberOf",
			// operational (ppolicy overlay) — sunucu desteklemiyorsa boş döner
			"pwdChangedTime", "pwdAccountLockedTime", "pwdFailureTime",
			// v0.9: shadowExpire (kalıcı disable işareti)
			"shadowExpire",
		},
		nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, err
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("kullanıcı bulunamadı")
	}
	e := res.Entries[0]
	locked := e.GetAttributeValue("pwdAccountLockedTime")
	shadow := e.GetAttributeValue("shadowExpire")
	u := &User{
		DN:                e.DN,
		UID:               e.GetAttributeValue("uid"),
		FirstName:         e.GetAttributeValue("givenName"),
		LastName:          e.GetAttributeValue("sn"),
		Email:             e.GetAttributeValue("mail"),
		Phone:             e.GetAttributeValue("mobile"),
		Groups:            e.GetAttributeValues("memberOf"),
		PasswordChangedAt: e.GetAttributeValue("pwdChangedTime"),
		AccountLockedTime: locked,
		RecentFailures:    len(e.GetAttributeValues("pwdFailureTime")),
		Disabled:          locked == disabledSentinel || shadow == "0",
	}
	// AccountLocked sadece geçici ppolicy lock'ı belirtir, kalıcı disable'ı değil.
	u.AccountLocked = locked != "" && locked != disabledSentinel
	return u, nil
}

// UnlockAccount admin tarafından çağrılır; pwdAccountLockedTime'ı kaldırır.
// Sunucuda ppolicy overlay yoksa "no such attribute" döner; bu durumda işlem
// gerekmez sayılır.
func (p *Pool) UnlockAccount(uid string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)
	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	req := goldap.NewModifyRequest(dn, nil)
	req.Delete("pwdAccountLockedTime", []string{})
	if err := c.Modify(req); err != nil {
		// "No Such Attribute" → zaten kilitli değil, başarı say
		if strings.Contains(strings.ToLower(err.Error()), "no such attribute") {
			return nil
		}
		return err
	}
	return nil
}

// UpdateUserInput alanları opsiyonel; nil olanlar değiştirilmez.
type UpdateUserInput struct {
	FirstName *string `json:"firstName,omitempty"`
	LastName  *string `json:"lastName,omitempty"`
	Email     *string `json:"email,omitempty"`
}

func (p *Pool) UpdateUser(uid string, in UpdateUserInput) error {
	if in.FirstName == nil && in.LastName == nil && in.Email == nil {
		return fmt.Errorf("güncellenecek alan yok")
	}
	current, err := p.GetUser(uid)
	if err != nil {
		return err
	}

	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	req := goldap.NewModifyRequest(dn, nil)

	first := current.FirstName
	last := current.LastName
	cnChanged := false
	if in.FirstName != nil && *in.FirstName != first {
		first = *in.FirstName
		req.Replace("givenName", []string{first})
		cnChanged = true
	}
	if in.LastName != nil && *in.LastName != last {
		last = *in.LastName
		req.Replace("sn", []string{last})
		cnChanged = true
	}
	if cnChanged {
		req.Replace("cn", []string{first + " " + last})
	}
	if in.Email != nil {
		if *in.Email == "" && current.Email != "" {
			req.Delete("mail", nil)
		} else if *in.Email != "" {
			req.Replace("mail", []string{*in.Email})
		}
	}
	return c.Modify(req)
}

func (p *Pool) DeleteUser(uid string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)
	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	return c.Del(goldap.NewDelRequest(dn, nil))
}

// SetPassword admin parola sıfırlama (eski parola istenmez).
func (p *Pool) SetPassword(uid, newPassword string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)
	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	req := goldap.NewPasswordModifyRequest(dn, "", newPassword)
	_, err = c.PasswordModify(req)
	return err
}

// ChangeOwnPassword kullanıcının kendi parolasını değiştirmesi (eski parola gerekli).
// Pool kullanmaz, taze bağlantıda kullanıcı olarak bind eder.
func (p *Pool) ChangeOwnPassword(uid, oldPassword, newPassword string) error {
	dn, err := p.FindUserDN(uid)
	if err != nil {
		return err
	}
	c, err := p.connect()
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.Bind(dn, oldPassword); err != nil {
		return fmt.Errorf("eski parola hatalı")
	}
	req := goldap.NewPasswordModifyRequest("", oldPassword, newPassword)
	_, err = c.PasswordModify(req)
	return err
}

// AttributeModification PATCH /api/users/{uid}/attributes body'sinin server-side karşılığı.
// Üç moddan biri kullanılır:
//   - add: belirtilen değerleri attribute'a ekler (multi-valued ise)
//   - replace: attribute'ın tüm değerlerini bu listeyle değiştirir; boş liste = sil
//   - delete: belirtilen değerleri attribute'tan siler; boş liste = tüm değerleri sil
type AttributeModification struct {
	Add     map[string][]string `json:"add,omitempty"`
	Replace map[string][]string `json:"replace,omitempty"`
	Delete  map[string][]string `json:"delete,omitempty"`
}

// protectedAttrs DN'i tanımlayan, parola yöneten veya operational/ppolicy
// attribute'larını listeler. Bu jenerik editörden edit edilemezler.
//   - uid: DN parçası, RDN değişikliği ayrı flow
//   - userPassword: özel /password endpoint'i var
//   - objectClass: aux class eklemek farklı bir UI/iş akışı gerektirir
//   - pwd<operational>: ppolicy server-managed (pwdChangedTime, pwdHistory, vb)
//   - create/modify timestamp: operational
//
// Önemli: pwd* prefix'iyle başlayan TÜM attribute'lar korumalı DEĞİLDİR —
// pwdPolicy objectClass'ının MUST/MAY üyeleri (pwdMaxFailure, pwdMinLength,
// pwdLockout vs.) policy entry'lerinde edit edilebilir olmalı. Sadece
// "server-managed" olanlar listede.
var protectedAttrs = map[string]bool{
	"uid":                   true,
	"userpassword":          true,
	"objectclass":           true,
	"creatorsname":          true,
	"createtimestamp":       true,
	"modifiersname":         true,
	"modifytimestamp":       true,
	"entryuuid":             true,
	"entrycsn":              true,
	"structuralobjectclass": true,
}

// pwdProtectedOperational ppolicy'nin server tarafından yönettiği ve user/admin
// tarafından elle değiştirilmemesi gereken pwd* attribute'ları. Bunlar bir user
// entry'sinde otomatik dolar (login fail sayacı, son değişim zamanı vs).
//
// pwdMaxFailure, pwdMinLength, pwdLockout, pwdMaxAge gibi POLICY attribute'ları
// burada DEĞİL — onlar pwdPolicy objectClass'ının config alanları, edit'lenmeli.
var pwdProtectedOperational = map[string]bool{
	"pwdchangedtime":       true,
	"pwdaccountlockedtime": true, // disable/enable endpoint'i kullanılmalı
	"pwdfailuretime":       true,
	"pwdhistory":           true, // server otomatik tutar
	"pwdreset":             true,
	"pwdpolicysubentry":    true, // policy ataması ayrı
	"pwdgraceusetime":      true,
}

func isProtectedAttr(name string) bool {
	ln := strings.ToLower(strings.TrimSpace(name))
	if protectedAttrs[ln] {
		return true
	}
	if pwdProtectedOperational[ln] {
		return true
	}
	return false
}

// ModifyAttributes inetOrgPerson user entry'sine generic LDAP modify uygular.
// Aynı request içinde add + replace + delete birlikte gelebilir; tek bir
// ldap.ModifyRequest'e paketlenir, atomik uygulanır (LDAP modify zaten atomik).
//
// Hatalar:
//   - protected attr → 400
//   - boş request → 400
//   - LDAP "no such attribute" delete'te → success sayılır (idempotent)
func (p *Pool) ModifyAttributes(uid string, mod AttributeModification) error {
	if len(mod.Add) == 0 && len(mod.Replace) == 0 && len(mod.Delete) == 0 {
		return fmt.Errorf("güncellenecek alan yok")
	}
	for attr := range mod.Add {
		if isProtectedAttr(attr) {
			return fmt.Errorf("attribute %q jenerik editörden değiştirilemez", attr)
		}
	}
	for attr := range mod.Replace {
		if isProtectedAttr(attr) {
			return fmt.Errorf("attribute %q jenerik editörden değiştirilemez", attr)
		}
	}
	for attr := range mod.Delete {
		if isProtectedAttr(attr) {
			return fmt.Errorf("attribute %q jenerik editörden değiştirilemez", attr)
		}
	}

	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	req := goldap.NewModifyRequest(dn, nil)
	for attr, vals := range mod.Add {
		if len(vals) == 0 {
			continue
		}
		req.Add(attr, vals)
	}
	for attr, vals := range mod.Replace {
		// boş liste = "tüm değerleri sil" anlamına geliyor; LDAP replace ile uyumlu
		req.Replace(attr, vals)
	}
	for attr, vals := range mod.Delete {
		// boş liste → attribute'ın tüm değerlerini sil
		req.Delete(attr, vals)
	}

	if err := c.Modify(req); err != nil {
		// idempotent delete: yoksa OK say
		if strings.Contains(strings.ToLower(err.Error()), "no such attribute") &&
			len(mod.Add) == 0 && len(mod.Replace) == 0 {
			return nil
		}
		return err
	}
	return nil
}

// IsAdmin kullanıcının yapılandırılmış admin grubuna üye olup olmadığını döner.
// AdminGroupDN boşsa her zaman false.
func (p *Pool) IsAdmin(uid string) (bool, error) {
	if p.cfg.AdminGroupDN == "" {
		return false, nil
	}
	c, err := p.Get()
	if err != nil {
		return false, err
	}
	defer p.Put(c)

	userDN := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	req := goldap.NewSearchRequest(
		p.cfg.AdminGroupDN,
		goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false,
		fmt.Sprintf("(|(member=%s)(uniqueMember=%s))", goldap.EscapeFilter(userDN), goldap.EscapeFilter(userDN)),
		[]string{"dn"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		// admin grubu yoksa veya erişilemiyorsa: admin değil (panel kilitli kalmasın)
		return false, nil
	}
	return len(res.Entries) > 0, nil
}

// disabledSentinel "ebedi kilit" işareti olarak kullanılan zaman damgası.
// LDAPv3 generalizedTime formatında geçmişte sabit bir tarih: 0001-01-01 00:00.
// Bu değer pwdAccountLockedTime'a yazıldığında ppolicy hesabı süresiz kilitler;
// "true" sentinel olarak da kullanılır — yani UI bu değeri görünce "Disabled"
// chip'i basar, geçici lock'tan ayırt eder.
const disabledSentinel = "000001010000Z"

// SetDisabled kullanıcıyı kalıcı pasifleştirir veya tekrar aktive eder.
// Defansif strateji (v0.9): pwdAccountLockedTime + shadowExpire ikisini de set
// eder/siler. Birinin overlay'i yüklü değilse diğeri kalkış noktası olur.
//
// Disable yan etkileri:
//   - shadowAccount aux objectClass yoksa otomatik eklenir (shadowExpire için zorunlu).
//   - ppolicy yüklüyse kullanıcı bind atamaz (Account locked).
//   - sssd/ssh shadowExpire=0'ı görüp girişi reddeder.
//
// Enable: ikisini de siler. shadowAccount aux class kalır (zararsız).
func (p *Pool) SetDisabled(uid string, disabled bool) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	dn := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())

	if disabled {
		// shadowAccount aux class var mı? Yoksa önce ekle, sonra shadowExpire set et.
		hasShadow, err := p.entryHasObjectClass(c, dn, "shadowAccount")
		if err != nil {
			return fmt.Errorf("aux check: %w", err)
		}
		if !hasShadow {
			addReq := goldap.NewModifyRequest(dn, nil)
			addReq.Add("objectClass", []string{"shadowAccount"})
			if err := c.Modify(addReq); err != nil {
				// Eğer schema'da shadowAccount yoksa devam ederiz (sadece ppolicy lock
				// kalır), kritik değil — yine de logla.
				if !strings.Contains(strings.ToLower(err.Error()), "object class") {
					return fmt.Errorf("aux ekle shadowAccount: %w", err)
				}
			}
		}
		mod := goldap.NewModifyRequest(dn, nil)
		mod.Replace("pwdAccountLockedTime", []string{disabledSentinel})
		// shadowAccount eklenebildiyse shadowExpire'ı da set et
		if hasShadow {
			mod.Replace("shadowExpire", []string{"0"})
		} else {
			// Aux class yeni eklendi varsayalım — yine de set et, çalışırsa süper
			mod.Replace("shadowExpire", []string{"0"})
		}
		if err := c.Modify(mod); err != nil {
			// Aux class yoksa shadowExpire set edilemiyor — ama lockedTime başarılı
			// olmuşsa hesap zaten kilitli, smooth devam edelim.
			if !strings.Contains(strings.ToLower(err.Error()), "shadowexpire") {
				return fmt.Errorf("disable: %w", err)
			}
		}
		return nil
	}

	// Enable: ikisini de sil
	mod := goldap.NewModifyRequest(dn, nil)
	mod.Delete("pwdAccountLockedTime", []string{})
	mod.Delete("shadowExpire", []string{})
	if err := c.Modify(mod); err != nil {
		// "no such attribute" → biri yoktu zaten, idempotent OK
		lerr := strings.ToLower(err.Error())
		if strings.Contains(lerr, "no such attribute") {
			// İkisini ayrı ayrı dene; bir tanesi vardır:
			for _, attr := range []string{"pwdAccountLockedTime", "shadowExpire"} {
				m2 := goldap.NewModifyRequest(dn, nil)
				m2.Delete(attr, []string{})
				_ = c.Modify(m2) // hata olursa görmezden gel — zaten yoktu
			}
			return nil
		}
		return fmt.Errorf("enable: %w", err)
	}
	return nil
}

// entryHasObjectClass DN'i okuyup objectClass listesinde verilen class var mı kontrol eder.
func (p *Pool) entryHasObjectClass(c *goldap.Conn, dn, oc string) (bool, error) {
	req := goldap.NewSearchRequest(
		dn, goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)", []string{"objectClass"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return false, err
	}
	if len(res.Entries) == 0 {
		return false, fmt.Errorf("entry yok")
	}
	want := strings.ToLower(oc)
	for _, v := range res.Entries[0].GetAttributeValues("objectClass") {
		if strings.ToLower(v) == want {
			return true, nil
		}
	}
	return false, nil
}

// ObjectClassChange aux class ekleme/kaldırma için generic mod.
type ObjectClassChange struct {
	Add    []string `json:"add,omitempty"`
	Remove []string `json:"remove,omitempty"`
}

// ModifyObjectClasses entry'nin objectClass listesini günceller.
// Kullanım: shadowAccount eklemek (shadowExpire için), pwdReset eklemek, vb.
//
// Kısıtlar:
//   - Structural class kaldırılamaz (LDAP semantiği — entry tipini değiştirmez).
//     Backend bu denetimi yapmaz; sunucu reddedince hatayı UI'a iletir.
//   - Aux class kaldırırken o class'ın MUST attribute'ları varsa ayrıca silinmeli;
//     sunucu schema-violation atar, mesaj UI'da görünür.
func (p *Pool) ModifyObjectClasses(dn string, change ObjectClassChange) error {
	if len(change.Add) == 0 && len(change.Remove) == 0 {
		return fmt.Errorf("değişiklik yok")
	}
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	mod := goldap.NewModifyRequest(dn, nil)
	for _, oc := range change.Add {
		mod.Add("objectClass", []string{oc})
	}
	for _, oc := range change.Remove {
		mod.Delete("objectClass", []string{oc})
	}
	if err := c.Modify(mod); err != nil {
		return fmt.Errorf("modify objectClass: %w", err)
	}
	return nil
}

// MoveUser bir user entry'sini başka bir parent OU'ya taşır (LDAP modDN).
// Yeni parent users OU olmayabilir (örn. ou=archive,dc=...), ama UI tipik
// olarak kullanıcı taşıması için OU listesi gösterir. Yeni RDN aynı kalır
// (uid=...). DN'in formatı bozulmaz.
//
// Önemli: memberOf otomatik refresh OLMAZ. Eski DN'i referans veren grup
// üyelikleri kırılır. v0.9 bunu çağıran katmanda halletmiyor — çağıran (UI/API)
// kullanıcıyı önce gruplardan çıkarmalı, taşımalı, sonra geri eklemeli.
// Bu basit kısıt yerine refint overlay kullanılırsa otomatik halledilir;
// senin kurulumunda refint zaten yüklü, member referansları otomatik güncellenir.
func (p *Pool) MoveUser(uid, newParentDN string) error {
	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	oldDN := fmt.Sprintf("uid=%s,%s", uid, p.cfg.UsersDN())
	newRDN := fmt.Sprintf("uid=%s", uid)

	// Hedef parent gerçekten var mı? Yoksa LDAP "no such object" verir; UI'a
	// daha açık mesaj dönmek için önden kontrol.
	checkReq := goldap.NewSearchRequest(
		newParentDN, goldap.ScopeBaseObject, goldap.NeverDerefAliases,
		1, 0, false, "(objectClass=*)", []string{"dn"}, nil,
	)
	if _, err := c.Search(checkReq); err != nil {
		return fmt.Errorf("hedef parent bulunamadı: %s", newParentDN)
	}

	// LDAP modDN: deleteOldRDN=true (eski uid attr'ını sil; yeni RDN aynı zaten)
	req := goldap.NewModifyDNRequest(oldDN, newRDN, true, newParentDN)
	if err := c.ModifyDN(req); err != nil {
		return fmt.Errorf("modDN: %w", err)
	}
	return nil
}

// ListContainerOUs DN tree'den container tipindeki entry'leri çeker. Yeni OU
// picker dialog'unda kullanılır — sadece organizationalUnit ve organization gösterilir.
func (p *Pool) ListContainerOUs() ([]string, error) {
	c, err := p.Get()
	if err != nil {
		return nil, err
	}
	defer p.Put(c)

	req := goldap.NewSearchRequest(
		p.cfg.BaseDN, goldap.ScopeWholeSubtree, goldap.NeverDerefAliases,
		1000, 0, false,
		"(|(objectClass=organizationalUnit)(objectClass=organization))",
		[]string{"dn"}, nil,
	)
	res, err := c.Search(req)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(res.Entries))
	for _, e := range res.Entries {
		out = append(out, e.DN)
	}
	return out, nil
}

// ModifyEntry generic LDAP modify — DN Tree edit için. ModifyAttributes (uid'e
// özel) ile aynı semantic ama keyfi DN üstünde çalışır. Korumalı attr listesi
// ortak — protectedAttrs.
func (p *Pool) ModifyEntry(dn string, mod AttributeModification) error {
	if len(mod.Add) == 0 && len(mod.Replace) == 0 && len(mod.Delete) == 0 {
		return fmt.Errorf("güncellenecek alan yok")
	}
	for attr := range mod.Add {
		if isProtectedAttr(attr) {
			return fmt.Errorf("attribute %q jenerik editörden değiştirilemez", attr)
		}
	}
	for attr := range mod.Replace {
		if isProtectedAttr(attr) {
			return fmt.Errorf("attribute %q jenerik editörden değiştirilemez", attr)
		}
	}
	for attr := range mod.Delete {
		if isProtectedAttr(attr) {
			return fmt.Errorf("attribute %q jenerik editörden değiştirilemez", attr)
		}
	}

	c, err := p.Get()
	if err != nil {
		return err
	}
	defer p.Put(c)

	req := goldap.NewModifyRequest(dn, nil)
	for attr, vals := range mod.Add {
		if len(vals) == 0 {
			continue
		}
		req.Add(attr, vals)
	}
	for attr, vals := range mod.Replace {
		req.Replace(attr, vals)
	}
	for attr, vals := range mod.Delete {
		req.Delete(attr, vals)
	}
	if err := c.Modify(req); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such attribute") &&
			len(mod.Add) == 0 && len(mod.Replace) == 0 {
			return nil
		}
		return err
	}
	return nil
}
