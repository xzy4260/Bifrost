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
	tracker := NewConcurrencyTracker()
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
	tracker := NewConcurrencyTracker()
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
	tracker := NewConcurrencyTracker()
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
	tracker := NewConcurrencyTracker()
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
