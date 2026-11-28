package lib

import "github.com/maximhq/bifrost/core/schemas"

// EstimateStreamOutputTokens estimates how many output tokens a streamed chunk
// added to the visible response. Streams carry only delta text, not per-chunk
// usage, so this is a live gauge rather than billing data: one token per four
// bytes of generated text, the usual English approximation. Tool-call arguments
// count too — they are generated tokens the client pays for.
func EstimateStreamOutputTokens(chunk *schemas.BifrostStreamChunk) int {
	if chunk == nil {
		return 0
	}
	var chars int
	switch {
	case chunk.BifrostChatResponse != nil:
		for _, choice := range chunk.BifrostChatResponse.Choices {
			if choice.ChatStreamResponseChoice == nil || choice.Delta == nil {
				continue
			}
			delta := choice.Delta
			chars += textSize(delta.Content) + textSize(delta.Refusal) + textSize(delta.Reasoning)
			for _, call := range delta.ToolCalls {
				chars += textSize(call.Function.Name) + len(call.Function.Arguments)
			}
		}
	case chunk.BifrostTextCompletionResponse != nil:
		for _, choice := range chunk.BifrostTextCompletionResponse.Choices {
			if choice.TextCompletionResponseChoice != nil {
				chars += textSize(choice.Text)
			}
		}
	case chunk.BifrostResponsesStreamResponse != nil:
		response := chunk.BifrostResponsesStreamResponse
		if responsesTextDelta(response.Type) {
			chars += textSize(response.Delta)
		}
	}
	if chars <= 0 {
		return 0
	}
	return (chars + 3) / 4
}

func textSize(value *string) int {
	if value == nil {
		return 0
	}
	return len(*value)
}

func responsesTextDelta(event schemas.ResponsesStreamResponseType) bool {
	switch event {
	case schemas.ResponsesStreamResponseTypeOutputTextDelta,
		schemas.ResponsesStreamResponseTypeRefusalDelta,
		schemas.ResponsesStreamResponseTypeFunctionCallArgumentsDelta,
		schemas.ResponsesStreamResponseTypeReasoningSummaryTextDelta,
		schemas.ResponsesStreamResponseTypeReasoningTextDelta,
		schemas.ResponsesStreamResponseTypeMCPCallArgumentsDelta,
		schemas.ResponsesStreamResponseTypeCodeInterpreterCallCodeDelta,
		schemas.ResponsesStreamResponseTypeCustomToolCallInputDelta:
		return true
	}
	return false
}
