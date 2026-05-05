package audit

import "time"

type DashboardStats struct {
	WindowDays int `json:"windowDays"`

	// Counts
	TotalEvents    int `json:"totalEvents"`
	LoginSuccess   int `json:"loginSuccess"`
	LoginFailed    int `json:"loginFailed"`
	UserCreated    int `json:"userCreated"`
	UserDeleted    int `json:"userDeleted"`
	PasswordResets int `json:"passwordResets"`

	// Per-day timeline
	Timeline []TimelinePoint `json:"timeline"`

	// Top actors
	TopActors []ActorCount `json:"topActors"`

	// Recent failures
	RecentFailures []Entry `json:"recentFailures"`

	// Action breakdown
	Actions []ActionCount `json:"actions"`

	// Failed logins by IP (brute-force radar)
	TopFailedIPs []IPCount `json:"topFailedIPs"`
}

type TimelinePoint struct {
	Date      string `json:"date"` // YYYY-MM-DD
	Logins    int    `json:"logins"`
	Failures  int    `json:"failures"`
	Mutations int    `json:"mutations"` // user/group create/update/delete
}

type ActorCount struct {
	Actor string `json:"actor"`
	Count int    `json:"count"`
}

type ActionCount struct {
	Action string `json:"action"`
	Count  int    `json:"count"`
}

type IPCount struct {
	IP    string `json:"ip"`
	Count int    `json:"count"`
}

// Stats son N gün için dashboard agregat verisi üretir.
func (s *Store) Stats(days int) (*DashboardStats, error) {
	if days <= 0 || days > 90 {
		days = 7
	}
	cutoff := time.Now().AddDate(0, 0, -days).UnixMilli()

	out := &DashboardStats{WindowDays: days}

	// Toplamlar
	row := s.db.QueryRow(`
SELECT
	COUNT(*),
	COALESCE(SUM(CASE WHEN action = 'auth.login' AND status = 'ok' THEN 1 ELSE 0 END), 0),
	COALESCE(SUM(CASE WHEN action = 'auth.login.fail' THEN 1 ELSE 0 END), 0),
	COALESCE(SUM(CASE WHEN action = 'user.create' AND status = 'ok' THEN 1 ELSE 0 END), 0),
	COALESCE(SUM(CASE WHEN action = 'user.delete' AND status = 'ok' THEN 1 ELSE 0 END), 0),
	COALESCE(SUM(CASE WHEN action IN ('user.password.reset', 'self.password.change', 'self.reset.success') AND status = 'ok' THEN 1 ELSE 0 END), 0)
FROM audit WHERE ts >= ?`, cutoff)
	if err := row.Scan(
		&out.TotalEvents, &out.LoginSuccess, &out.LoginFailed,
		&out.UserCreated, &out.UserDeleted, &out.PasswordResets,
	); err != nil {
		return nil, err
	}

	// Timeline (per day)
	rows, err := s.db.Query(`
SELECT
	strftime('%Y-%m-%d', datetime(ts/1000, 'unixepoch')) AS day,
	SUM(CASE WHEN action = 'auth.login' AND status = 'ok' THEN 1 ELSE 0 END),
	SUM(CASE WHEN action = 'auth.login.fail' THEN 1 ELSE 0 END),
	SUM(CASE WHEN action LIKE 'user.%' OR action LIKE 'group.%' OR action LIKE 'bulk.%' THEN 1 ELSE 0 END)
FROM audit WHERE ts >= ?
GROUP BY day ORDER BY day`, cutoff)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p TimelinePoint
		if err := rows.Scan(&p.Date, &p.Logins, &p.Failures, &p.Mutations); err != nil {
			rows.Close()
			return nil, err
		}
		out.Timeline = append(out.Timeline, p)
	}
	rows.Close()

	// Top actors
	rows, err = s.db.Query(`
SELECT actor, COUNT(*) c FROM audit
WHERE ts >= ? AND actor != ''
GROUP BY actor ORDER BY c DESC LIMIT 10`, cutoff)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var a ActorCount
		if err := rows.Scan(&a.Actor, &a.Count); err != nil {
			rows.Close()
			return nil, err
		}
		out.TopActors = append(out.TopActors, a)
	}
	rows.Close()

	// Action breakdown
	rows, err = s.db.Query(`
SELECT action, COUNT(*) c FROM audit
WHERE ts >= ? GROUP BY action ORDER BY c DESC LIMIT 15`, cutoff)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var a ActionCount
		if err := rows.Scan(&a.Action, &a.Count); err != nil {
			rows.Close()
			return nil, err
		}
		out.Actions = append(out.Actions, a)
	}
	rows.Close()

	// Top failed IPs
	rows, err = s.db.Query(`
SELECT ip, COUNT(*) c FROM audit
WHERE ts >= ? AND status = 'fail' AND ip != ''
GROUP BY ip ORDER BY c DESC LIMIT 10`, cutoff)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var ic IPCount
		if err := rows.Scan(&ic.IP, &ic.Count); err != nil {
			rows.Close()
			return nil, err
		}
		out.TopFailedIPs = append(out.TopFailedIPs, ic)
	}
	rows.Close()

	// Recent failures (audit list reuse with status filter)
	res, err := s.List(ListOpts{Limit: 10, Status: string(StatusFail)})
	if err == nil {
		out.RecentFailures = res.Items
	}

	return out, nil
}
