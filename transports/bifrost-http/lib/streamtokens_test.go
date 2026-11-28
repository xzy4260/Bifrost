package lib

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestEstimateStreamOutputTokensChatDelta(t *testing.T) {
	content := "hello world" // 11 bytes -> 3 tokens at four bytes per token
	chunk := &schemas.BifrostStreamChunk{
		BifrostChatResponse: &schemas.BifrostChatResponse{
			Choices: []schemas.BifrostResponseChoice{{
				ChatStreamResponseChoice: &schemas.ChatStreamResponseChoice{
					Delta: &schemas.ChatStreamResponseChoiceDelta{Content: &content},
				},
			}},
		},
	}
	if got := EstimateStreamOutputTokens(chunk); got != 3 {
		t.Fatalf("tokens = %d, want 3", got)
	}
}

func TestEstimateStreamOutputTokensIgnoresNonText(t *testing.T) {
	role := "assistant"
	chunk := &schemas.BifrostStreamChunk{
		BifrostChatResponse: &schemas.BifrostChatResponse{
			Choices: []schemas.BifrostResponseChoice{{
				ChatStreamResponseChoice: &schemas.ChatStreamResponseChoice{
					Delta: &schemas.ChatStreamResponseChoiceDelta{Role: &role},
				},
			}},
		},
	}
	if got := EstimateStreamOutputTokens(chunk); got != 0 {
		t.Fatalf("tokens = %d, want 0", got)
	}
	if got := EstimateStreamOutputTokens(nil); got != 0 {
		t.Fatalf("nil chunk tokens = %d, want 0", got)
	}
}

func TestEstimateStreamOutputTokensResponsesDelta(t *testing.T) {
	delta := "abcdefgh" // 8 bytes -> 2 tokens
	chunk := &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:  schemas.ResponsesStreamResponseTypeOutputTextDelta,
			Delta: &delta,
		},
	}
	if got := EstimateStreamOutputTokens(chunk); got != 2 {
		t.Fatalf("tokens = %d, want 2", got)
	}
}
