package handlers

import (
	"io"
	"testing"
	"time"

	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// A response written without a body stream is counted only while the handler
// runs.
func TestConcurrencyTrackerCountsHandlerLifetime(t *testing.T) {
	tracker := NewConcurrencyTracker(nil)
	handler := tracker.Middleware()(func(ctx *fasthttp.RequestCtx) {
		if total, _, _, _ := tracker.snapshot(time.Now()); total != 1 {
			t.Fatalf("in-flight during handler = %d, want 1", total)
		}
		ctx.SetBodyString("ok")
	})

	var ctx fasthttp.RequestCtx
	handler(&ctx)

	if total, _, _, _ := tracker.snapshot(time.Now()); total != 0 {
		t.Fatalf("in-flight after handler = %d, want 0", total)
	}
}

// A streamed response is written after the handler returns, so the request must
// keep its slot until the producer finishes the stream.
func TestConcurrencyTrackerHoldsCountUntilStreamDone(t *testing.T) {
	tracker := NewConcurrencyTracker(nil)
	var reader *lib.SSEStreamReader

	handler := tracker.Middleware()(func(ctx *fasthttp.RequestCtx) {
		reader = lib.NewTrackedSSEStreamReader(ctx)
		ctx.Response.SetBodyStream(reader, -1)
	})

	var ctx fasthttp.RequestCtx
	handler(&ctx)

	if total, _, _, _ := tracker.snapshot(time.Now()); total != 1 {
		t.Fatalf("in-flight after handler returned = %d, want 1", total)
	}

	reader.Send([]byte("data: {}\n\n"))
	reader.Done()

	if total, _, _, _ := tracker.snapshot(time.Now()); total != 0 {
		t.Fatalf("in-flight after Done = %d, want 0", total)
	}

	// Reading after Done drains the queued event and then reports EOF.
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	if string(body) != "data: {}\n\n" {
		t.Fatalf("body = %q", body)
	}
}

// A client disconnect closes the reader instead of ending the stream normally;
// the slot must be released either way.
func TestConcurrencyTrackerReleasesOnStreamClose(t *testing.T) {
	tracker := NewConcurrencyTracker(nil)
	var reader *lib.SSEStreamReader

	handler := tracker.Middleware()(func(ctx *fasthttp.RequestCtx) {
		reader = lib.NewTrackedSSEStreamReader(ctx)
		ctx.Response.SetBodyStream(reader, -1)
	})

	var ctx fasthttp.RequestCtx
	handler(&ctx)

	if err := reader.Close(); err != nil {
		t.Fatalf("close stream: %v", err)
	}
	if total, _, _, _ := tracker.snapshot(time.Now()); total != 0 {
		t.Fatalf("in-flight after Close = %d, want 0", total)
	}
}

// Token counts reported by a streamed request surface as a live rate, overall
// and against the key that generated them.
func TestConcurrencyTrackerReportsLiveTokenRate(t *testing.T) {
	tracker := NewConcurrencyTracker(nil)
	var reader *lib.SSEStreamReader

	handler := tracker.Middleware()(func(ctx *fasthttp.RequestCtx) {
		reader = lib.NewTrackedSSEStreamReader(ctx)
		ctx.Response.SetBodyStream(reader, -1)
		lib.ConcurrencySlotFrom(ctx).AddTokens(100)
	})

	var ctx fasthttp.RequestCtx
	handler(&ctx)

	_, counts, totalRate, keyRates := tracker.snapshot(time.Now())
	if counts[unknownVirtualKeyLabel] != 1 {
		t.Fatalf("in-flight count = %v, want one unknown-key request", counts)
	}
	// 100 tokens over the 4-second window is 25/s until they age out.
	if totalRate != 25 {
		t.Fatalf("total rate = %v, want 25", totalRate)
	}
	if keyRates[unknownVirtualKeyLabel] != 25 {
		t.Fatalf("key rate = %v, want 25", keyRates)
	}

	reader.Done()
	_, _, totalRate, _ = tracker.snapshot(time.Now())
	if totalRate != 25 {
		t.Fatalf("rate right after Done = %v, want the last window to persist", totalRate)
	}

	_, _, totalRate, _ = tracker.snapshot(time.Now().Add(5 * time.Second))
	if totalRate != 0 {
		t.Fatalf("rate after the window = %v, want 0", totalRate)
	}
}

// A key at its max_concurrency is refused, and the refusal does not consume a
// slot: the released slot serves the next request.
func TestConcurrencyTrackerEnforcesMaxConcurrency(t *testing.T) {
	tracker := NewConcurrencyTracker(nil)

	if !tracker.acquire("vk", 2) || !tracker.acquire("vk", 2) {
		t.Fatal("first two requests within the limit were refused")
	}
	if tracker.acquire("vk", 2) {
		t.Fatal("third request above the limit was admitted")
	}
	if total, counts, _, _ := tracker.snapshot(time.Now()); total != 2 || counts["vk"] != 2 {
		t.Fatalf("in-flight = %d, key = %d, want 2 and 2 (a refusal must not count)", total, counts["vk"])
	}

	tracker.add("vk", -1)
	if !tracker.acquire("vk", 2) {
		t.Fatal("request after a release was refused")
	}

	// limit 0 means unlimited.
	for range 10 {
		if !tracker.acquire("other", 0) {
			t.Fatal("unlimited key was refused")
		}
	}
}

// A request over its key's max_concurrency is answered 429 before reaching the
// handler, and the refusal leaves the in-flight count untouched.
func TestConcurrencyTrackerMiddlewareRejectsOverLimit(t *testing.T) {
	tracker := NewConcurrencyTracker(nil)
	const vk = "sk-bf-concurrency-test"
	tracker.limits[vk] = concurrencyLimitEntry{limit: 1, expires: time.Now().Add(time.Minute)}

	var reader *lib.SSEStreamReader
	streaming := tracker.Middleware()(func(ctx *fasthttp.RequestCtx) {
		reader = lib.NewTrackedSSEStreamReader(ctx)
		ctx.Response.SetBodyStream(reader, -1)
	})

	var first fasthttp.RequestCtx
	first.Request.Header.Set("x-bf-vk", vk)
	streaming(&first)
	if total, counts, _, _ := tracker.snapshot(time.Now()); total != 1 || counts[vk] != 1 {
		t.Fatalf("in-flight = %d, key = %d, want 1 and 1", total, counts[vk])
	}

	handlerCalled := false
	rejecting := tracker.Middleware()(func(*fasthttp.RequestCtx) { handlerCalled = true })

	var second fasthttp.RequestCtx
	second.Request.Header.Set("x-bf-vk", vk)
	rejecting(&second)

	if handlerCalled {
		t.Fatal("request above the limit reached the handler")
	}
	if second.Response.StatusCode() != fasthttp.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", second.Response.StatusCode())
	}
	if got := string(second.Response.Header.Peek("Retry-After")); got != "1" {
		t.Fatalf("Retry-After = %q, want 1", got)
	}
	if total, counts, _, _ := tracker.snapshot(time.Now()); total != 1 || counts[vk] != 1 {
		t.Fatalf("a refusal changed the count: total = %d, key = %d", total, counts[vk])
	}

	reader.Done()
	if total, _, _, _ := tracker.snapshot(time.Now()); total != 0 {
		t.Fatalf("in-flight after Done = %d, want 0", total)
	}
}
