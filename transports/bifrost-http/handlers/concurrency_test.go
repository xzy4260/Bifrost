package handlers

import (
	"io"
	"testing"

	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

// A response written without a body stream is counted only while the handler
// runs.
func TestConcurrencyTrackerCountsHandlerLifetime(t *testing.T) {
	tracker := NewConcurrencyTracker()
	handler := tracker.Middleware()(func(ctx *fasthttp.RequestCtx) {
		if total, _ := tracker.snapshot(); total != 1 {
			t.Fatalf("in-flight during handler = %d, want 1", total)
		}
		ctx.SetBodyString("ok")
	})

	var ctx fasthttp.RequestCtx
	handler(&ctx)

	if total, _ := tracker.snapshot(); total != 0 {
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

	if total, _ := tracker.snapshot(); total != 1 {
		t.Fatalf("in-flight after handler returned = %d, want 1", total)
	}

	reader.Send([]byte("data: {}\n\n"))
	reader.Done()

	if total, _ := tracker.snapshot(); total != 0 {
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
	if total, _ := tracker.snapshot(); total != 0 {
		t.Fatalf("in-flight after Close = %d, want 0", total)
	}
}
