package lib

import (
	"sync/atomic"

	"github.com/valyala/fasthttp"
)

// ConcurrencySlot is one request's place in the live concurrency counter. The
// tracker middleware creates it and releases it when the handler returns; a
// streaming handler claims the slot first so the release waits for the stream
// to finish instead.
type ConcurrencySlot struct {
	claimed atomic.Bool
	release func()
}

// Claim takes ownership of the release and returns it, so the caller can run it
// when the response is actually finished (for a stream, at end of stream).
func (s *ConcurrencySlot) Claim() func() {
	s.claimed.Store(true)
	return s.release
}

// Claimed reports whether a streaming handler took over the release.
func (s *ConcurrencySlot) Claimed() bool {
	return s.claimed.Load()
}

// concurrencySlotKey is the RequestCtx key holding this request's slot.
type concurrencySlotKey struct{}

// SetConcurrencySlot attaches the request's concurrency slot to its context.
func SetConcurrencySlot(ctx *fasthttp.RequestCtx, slot *ConcurrencySlot) {
	if ctx == nil || slot == nil {
		return
	}
	ctx.SetUserValue(concurrencySlotKey{}, slot)
}

// ConcurrencySlotFrom returns the slot installed for this request, or nil when
// the request is not counted.
func ConcurrencySlotFrom(ctx *fasthttp.RequestCtx) *ConcurrencySlot {
	if ctx == nil {
		return nil
	}
	slot, _ := ctx.UserValue(concurrencySlotKey{}).(*ConcurrencySlot)
	return slot
}

// NewConcurrencySlot builds a slot around release.
func NewConcurrencySlot(release func()) *ConcurrencySlot {
	return &ConcurrencySlot{release: release}
}
