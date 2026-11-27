package handlers

import (
	"sort"
	"sync"

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

// ConcurrencyTracker counts the inference requests currently in flight, keyed by
// the virtual key the caller presented. The counter is decremented when the
// handler returns, which for a streaming request is when the stream ends, so the
// figure reflects real concurrency rather than request starts.
type ConcurrencyTracker struct {
	mu     sync.Mutex
	active map[string]int
	total  int
}

// NewConcurrencyTracker returns an empty tracker.
func NewConcurrencyTracker() *ConcurrencyTracker {
	return &ConcurrencyTracker{active: make(map[string]int)}
}

// Middleware counts the wrapped request for its whole lifetime.
func (t *ConcurrencyTracker) Middleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			key := unknownVirtualKeyLabel
			if vk := governance.ParseVirtualKeyFromFastHTTPRequest(ctx); vk != nil && *vk != "" {
				key = *vk
			}
			t.add(key, 1)
			defer t.add(key, -1)
			next(ctx)
		}
	}
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
		return
	}
	t.active[key] = next
}

// snapshot returns the total and a copy of the per-key counters.
func (t *ConcurrencyTracker) snapshot() (int, map[string]int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	counts := make(map[string]int, len(t.active))
	for key, count := range t.active {
		counts[key] = count
	}
	return t.total, counts
}

// ConcurrencyKey is one virtual key's share of the in-flight requests.
type ConcurrencyKey struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Value  string `json:"value"`
	Active int    `json:"active"`
}

// ConcurrencyResponse is the GET /api/concurrency payload.
type ConcurrencyResponse struct {
	Total int              `json:"total"`
	Keys  []ConcurrencyKey `json:"keys"`
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
	total, counts := h.tracker.snapshot()
	keys := make([]ConcurrencyKey, 0, len(counts))
	for value, active := range counts {
		keys = append(keys, h.describe(ctx, value, active))
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Active != keys[j].Active {
			return keys[i].Active > keys[j].Active
		}
		return keys[i].Name < keys[j].Name
	})
	SendJSON(ctx, ConcurrencyResponse{Total: total, Keys: keys})
}

// describe resolves a raw virtual key value to its row. A key that cannot be
// resolved (persistence off, or a key deleted mid-flight) is reported masked.
func (h *ConcurrencyHandler) describe(ctx *fasthttp.RequestCtx, value string, active int) ConcurrencyKey {
	if value == unknownVirtualKeyLabel {
		return ConcurrencyKey{Value: "", Active: active}
	}
	key := ConcurrencyKey{Value: maskVirtualKeyValue(value), Active: active}
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
