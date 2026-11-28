package handlers

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// unknownVirtualKeyLabel groups requests that carried no virtual key, so the
// dashboard can account for every in-flight request instead of dropping them.
const unknownVirtualKeyLabel = "unknown"

// tokenRateBuckets and tokenRateBucketMS define the sliding window the live
// token rate averages over: 8 half-second buckets, i.e. the last 4 seconds.
// Shorter hides a stalled key for too little time; longer makes the figure feel
// laggy while a stream starts or ends.
const (
	tokenRateBuckets  = 8
	tokenRateBucketMS = 500
)

// tokenRate counts tokens per half-second bucket and reports their rate over
// the sliding window. Buckets are addressed by absolute bucket number, so
// pruning is O(buckets) with no per-event allocation.
type tokenRate struct {
	counts [tokenRateBuckets]int64
	stamps [tokenRateBuckets]int64
	last   int64
}

func (r *tokenRate) add(n int, now time.Time) {
	if n <= 0 {
		return
	}
	bucket := now.UnixMilli() / tokenRateBucketMS
	r.advance(bucket)
	index := int(bucket % tokenRateBuckets)
	if r.stamps[index] != bucket {
		r.stamps[index] = bucket
		r.counts[index] = 0
	}
	r.counts[index] += int64(n)
}

// advance clears the buckets skipped since the last add, so a key that paused
// does not keep reporting its stale tokens.
func (r *tokenRate) advance(bucket int64) {
	if r.last == 0 {
		r.last = bucket
		return
	}
	if bucket <= r.last {
		return
	}
	if bucket-r.last >= tokenRateBuckets {
		r.counts = [tokenRateBuckets]int64{}
		r.stamps = [tokenRateBuckets]int64{}
		r.last = bucket
		return
	}
	for skipped := r.last + 1; skipped <= bucket; skipped++ {
		index := int(skipped % tokenRateBuckets)
		r.counts[index] = 0
		r.stamps[index] = skipped
	}
	r.last = bucket
}

func (r *tokenRate) perSecond(now time.Time) float64 {
	bucket := now.UnixMilli() / tokenRateBucketMS
	var total int64
	for index := 0; index < tokenRateBuckets; index++ {
		if r.stamps[index] > bucket-tokenRateBuckets && r.stamps[index] <= bucket {
			total += r.counts[index]
		}
	}
	return float64(total) / (tokenRateBuckets * tokenRateBucketMS / 1000.0)
}

// concurrencyLimitTTL bounds how long a resolved per-key concurrency limit is
// cached. Inference requests resolve their key's limit at most once per TTL, so
// the limiter costs no database round-trip on the hot path; an edit applies
// within this window even without an explicit invalidation.
const concurrencyLimitTTL = 15 * time.Second

// concurrencyLimitEntry is one cached limit. limit == 0 means unlimited, and
// unknown virtual keys are cached the same way so a caller cannot turn a
// made-up key into a database query per request.
type concurrencyLimitEntry struct {
	limit   int
	expires time.Time
}

// ConcurrencyTracker counts the inference requests currently in flight, keyed by
// the virtual key the caller presented, and the tokens those streams generate.
type ConcurrencyTracker struct {
	mu          sync.Mutex
	active      map[string]int
	total       int
	tokens      map[string]*tokenRate
	totalTokens tokenRate

	// store resolves each key's max_concurrency. nil disables enforcement.
	store configstore.ConfigStore

	limitsMu sync.Mutex
	limits   map[string]concurrencyLimitEntry
}

// NewConcurrencyTracker returns an empty tracker. A nil store keeps counting
// but leaves every key unlimited.
func NewConcurrencyTracker(store configstore.ConfigStore) *ConcurrencyTracker {
	return &ConcurrencyTracker{
		active: make(map[string]int),
		tokens: make(map[string]*tokenRate),
		store:  store,
		limits: make(map[string]concurrencyLimitEntry),
	}
}

// Middleware counts the wrapped request for its whole lifetime. A streamed
// response outlives the handler — the handler returns as soon as it hands
// fasthttp a body stream, and the tokens are written afterwards — so a
// streaming handler claims the request's lib.ConcurrencySlot through its stream
// reader, and the count drops when the stream ends instead.
//
// A key whose max_concurrency is already reached is rejected here with 429
// before any provider work happens.
func (t *ConcurrencyTracker) Middleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			key := unknownVirtualKeyLabel
			if vk := governance.ParseVirtualKeyFromFastHTTPRequest(ctx); vk != nil && *vk != "" {
				key = *vk
			}
			if !t.acquire(key, t.limitFor(ctx, key)) {
				ctx.Response.Header.Set("Retry-After", "1")
				SendError(ctx, fasthttp.StatusTooManyRequests, "Virtual key concurrency limit reached")
				return
			}
			var once sync.Once
			slot := lib.NewConcurrencySlot(
				func() { once.Do(func() { t.add(key, -1) }) },
				func(n int) { t.addTokens(key, n) },
			)
			lib.SetConcurrencySlot(ctx, slot)
			// Everything that is not streamed finishes when the handler returns.
			// A streamed response claims the slot, which hands the release to the
			// stream reader instead.
			defer func() {
				if slot.Claimed() {
					return
				}
				slot.Claim()()
			}()
			next(ctx)
		}
	}
}

// acquire claims a slot for key unless its limit is already reached. limit == 0
// means unlimited. It reports whether the request may proceed.
func (t *ConcurrencyTracker) acquire(key string, limit int) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if limit > 0 && t.active[key] >= limit {
		return false
	}
	t.total++
	t.active[key]++
	return true
}

// limitFor resolves a key's max_concurrency through a short-lived cache. A nil
// store, an empty key or a failed lookup all mean unlimited.
func (t *ConcurrencyTracker) limitFor(ctx context.Context, value string) int {
	if value == "" || value == unknownVirtualKeyLabel {
		return 0
	}
	now := time.Now()
	t.limitsMu.Lock()
	if entry, ok := t.limits[value]; ok && now.Before(entry.expires) {
		t.limitsMu.Unlock()
		return entry.limit
	}
	t.limitsMu.Unlock()
	if t.store == nil {
		return 0
	}

	limit := 0
	if vk, err := t.store.GetVirtualKeyByValue(ctx, value); err == nil && vk != nil {
		if vk.MaxConcurrency != nil && *vk.MaxConcurrency > 0 {
			limit = int(*vk.MaxConcurrency)
		}
	}

	t.limitsMu.Lock()
	t.limits[value] = concurrencyLimitEntry{limit: limit, expires: now.Add(concurrencyLimitTTL)}
	t.limitsMu.Unlock()
	return limit
}

// InvalidateLimit drops the cached limit for one key value, so an edit applies
// to the next request instead of after the cache expires.
func (t *ConcurrencyTracker) InvalidateLimit(value string) {
	if t == nil || value == "" {
		return
	}
	t.limitsMu.Lock()
	delete(t.limits, value)
	t.limitsMu.Unlock()
}

func (t *ConcurrencyTracker) add(key string, delta int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.total += delta
	if t.total < 0 {
		t.total = 0
	}
	next := t.active[key] + delta
	if next <= 0 {
		delete(t.active, key)
		delete(t.tokens, key)
		return
	}
	t.active[key] = next
}

// addTokens records generated output tokens against one key. The total window is
// fed as well so the card's overall rate includes every stream.
func (t *ConcurrencyTracker) addTokens(key string, n int) {
	if n <= 0 {
		return
	}
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	rate := t.tokens[key]
	if rate == nil {
		rate = &tokenRate{}
		t.tokens[key] = rate
	}
	rate.add(n, now)
	t.totalTokens.add(n, now)
}

// snapshot returns the total and a copy of the per-key counters, plus the live
// token rate overall and per key.
func (t *ConcurrencyTracker) snapshot(now time.Time) (int, map[string]int, float64, map[string]float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	counts := make(map[string]int, len(t.active))
	rates := make(map[string]float64, len(t.active))
	for key, count := range t.active {
		counts[key] = count
		if rate := t.tokens[key]; rate != nil {
			rates[key] = rate.perSecond(now)
		}
	}
	return t.total, counts, t.totalTokens.perSecond(now), rates
}

// ConcurrencyKey is one virtual key's share of the in-flight requests and the
// tokens those requests are generating.
type ConcurrencyKey struct {
	ID              string  `json:"id,omitempty"`
	Name            string  `json:"name,omitempty"`
	Value           string  `json:"value"`
	Active          int     `json:"active"`
	TokensPerSecond float64 `json:"tokens_per_second"`
}

// ConcurrencyResponse is the GET /api/concurrency payload.
type ConcurrencyResponse struct {
	Total           int              `json:"total"`
	TokensPerSecond float64          `json:"tokens_per_second"`
	Keys            []ConcurrencyKey `json:"keys"`
}

// ConcurrencyHandler serves GET /api/concurrency: the live in-flight request
// count, overall and per virtual key.
type ConcurrencyHandler struct {
	tracker *ConcurrencyTracker
	store   configstore.ConfigStore
}

// NewConcurrencyHandler returns the handler. store may be nil when persistence
// is disabled, in which case keys are reported by their masked value only.
func NewConcurrencyHandler(tracker *ConcurrencyTracker, store configstore.ConfigStore) *ConcurrencyHandler {
	return &ConcurrencyHandler{tracker: tracker, store: store}
}

// RegisterRoutes registers GET /api/concurrency.
func (h *ConcurrencyHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/concurrency", lib.ChainMiddlewares(h.getConcurrency, middlewares...))
}

func (h *ConcurrencyHandler) getConcurrency(ctx *fasthttp.RequestCtx) {
	total, counts, totalRate, rates := h.tracker.snapshot(time.Now())
	keys := make([]ConcurrencyKey, 0, len(counts))
	for value, active := range counts {
		keys = append(keys, h.describe(ctx, value, active, rates[value]))
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Active != keys[j].Active {
			return keys[i].Active > keys[j].Active
		}
		return keys[i].Name < keys[j].Name
	})
	SendJSON(ctx, ConcurrencyResponse{Total: total, TokensPerSecond: totalRate, Keys: keys})
}

// describe resolves a raw virtual key value to its row. A key that cannot be
// resolved (persistence off, or a key deleted mid-flight) is reported masked.
func (h *ConcurrencyHandler) describe(ctx *fasthttp.RequestCtx, value string, active int, tokensPerSecond float64) ConcurrencyKey {
	if value == unknownVirtualKeyLabel {
		return ConcurrencyKey{Value: "", Active: active, TokensPerSecond: tokensPerSecond}
	}
	key := ConcurrencyKey{Value: maskVirtualKeyValue(value), Active: active, TokensPerSecond: tokensPerSecond}
	if h.store == nil {
		return key
	}
	vk, err := h.store.GetVirtualKeyByValue(ctx, value)
	if err != nil || vk == nil {
		return key
	}
	key.ID = vk.ID
	key.Name = vk.Name
	return key
}

// maskVirtualKeyValue keeps enough of the key to tell two of them apart without
// publishing a usable credential.
func maskVirtualKeyValue(value string) string {
	const visible = 12
	if len(value) <= visible {
		return value
	}
	return value[:visible] + "…"
}
