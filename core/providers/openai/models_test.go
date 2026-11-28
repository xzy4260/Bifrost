package openai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestListModelsByKeyResponseShapes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		body        string
		wantID      string
		wantOwnedBy string
		wantContext int
	}{
		{
			name:        "OpenAI envelope",
			body:        `{"object":"list","data":[{"id":"gpt-5","owned_by":"openai","context_window":128000}]}`,
			wantID:      "test/gpt-5",
			wantOwnedBy: "openai",
			wantContext: 128000,
		},
		{
			name:        "Together array",
			body:        `[{"id":"zai-org/GLM-5.2","organization":"Z.ai","context_length":131072}]`,
			wantID:      "test/zai-org/GLM-5.2",
			wantOwnedBy: "Z.ai",
			wantContext: 131072,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()

			response, bifrostErr := ListModelsByKey(
				schemas.NewBifrostContext(context.Background(), schemas.NoDeadline),
				&fasthttp.Client{},
				server.URL,
				schemas.Key{Models: schemas.WhiteList{"*"}},
				false,
				nil,
				schemas.ModelProvider("test"),
				false,
				false,
			)

			require.Nil(t, bifrostErr)
			require.Len(t, response.Data, 1)
			require.Equal(t, test.wantID, response.Data[0].ID)
			require.Equal(t, schemas.Ptr(test.wantOwnedBy), response.Data[0].OwnedBy)
			require.Equal(t, schemas.Ptr(test.wantContext), response.Data[0].ContextLength)
		})
	}
}

func TestModelLimitFieldCompatibility(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		body        string
		wantContext *int
		wantOutput  *int
	}{
		{
			name:        "singular limit block with max_allowed_size",
			body:        `{"id":"m","limit":{"context":960000,"output":64000},"max_allowed_size":1000000,"max_output_tokens":64000}`,
			wantContext: schemas.Ptr(960000),
			wantOutput:  schemas.Ptr(64000),
		},
		{
			name:        "context_window object takes widest switchable window",
			body:        `{"id":"m","context_window":{"default":300000,"supported":[300000,600000,960000]},"max_output_tokens":64000}`,
			wantContext: schemas.Ptr(960000),
			wantOutput:  schemas.Ptr(64000),
		},
		{
			name:        "context_window object without default takes widest supported",
			body:        `{"id":"m","context_window":{"supported":[300000,600000,960000]}}`,
			wantContext: schemas.Ptr(960000),
		},
		{
			name:        "singular limit context wins over switchable windows",
			body:        `{"id":"m","context_window":{"default":300000,"supported":[300000,960000]},"limit":{"context":600000,"output":64000}}`,
			wantContext: schemas.Ptr(600000),
			wantOutput:  schemas.Ptr(64000),
		},
		{
			name:        "DeepSeek style int context_window",
			body:        `{"id":"deepseek-flash","context_window":1048576,"max_output_tokens":393216}`,
			wantContext: schemas.Ptr(1048576),
			wantOutput:  schemas.Ptr(393216),
		},
		{
			name:        "Alibaba style max_input_tokens alongside the window",
			body:        `{"id":"qwen","context_window":1000000,"max_input_tokens":991808,"max_output_tokens":131072}`,
			wantContext: schemas.Ptr(1000000),
			wantOutput:  schemas.Ptr(131072),
		},
		{
			name:        "OpenRouter style top_provider envelope",
			body:        `{"id":"x","context_length":200000,"top_provider":{"context_length":200000,"max_completion_tokens":64000}}`,
			wantContext: schemas.Ptr(200000),
			wantOutput:  schemas.Ptr(64000),
		},
		{
			name:        "vLLM style max_model_len",
			body:        `{"id":"x","max_model_len":32768}`,
			wantContext: schemas.Ptr(32768),
		},
		{
			name:        "LM Studio style max_context_length with max_tokens",
			body:        `{"id":"x","max_context_length":8192,"max_tokens":4096}`,
			wantContext: schemas.Ptr(8192),
			wantOutput:  schemas.Ptr(4096),
		},
		{
			name:        "llama.cpp style meta block",
			body:        `{"id":"x","meta":{"n_ctx_train":131072,"n_ctx":8192}}`,
			wantContext: schemas.Ptr(131072),
		},
		{
			name:        "Ollama style dotted model_info key",
			body:        `{"id":"x","model_info":{"qwen2.context_length":32768}}`,
			wantContext: schemas.Ptr(32768),
		},
		{
			name:        "plural limits block",
			body:        `{"id":"x","limits":{"context_window":200000,"max_output_tokens":32000}}`,
			wantContext: schemas.Ptr(200000),
			wantOutput:  schemas.Ptr(32000),
		},
		{
			name:        "numeric strings and fractions",
			body:        `{"id":"x","context_length":"128000","max_output_tokens":1048576.0}`,
			wantContext: schemas.Ptr(128000),
			wantOutput:  schemas.Ptr(1048576),
		},
		{
			name:        "shorthand and separated strings",
			body:        `{"id":"x","context_length":"128k","max_output_tokens":"32,000"}`,
			wantContext: schemas.Ptr(128000),
			wantOutput:  schemas.Ptr(32000),
		},
		{
			name:        "camelCase aliases",
			body:        `{"id":"x","maxInputTokens":64000,"maxOutputTokens":8000}`,
			wantContext: schemas.Ptr(64000),
			wantOutput:  schemas.Ptr(8000),
		},
		{
			name: "unreadable shapes are absent, not zero",
			body: `{"id":"x","context_window":{"unexpected":true},"max_output_tokens":"n/a"}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			var model OpenAIModel
			require.NoError(t, json.Unmarshal([]byte(test.body), &model))
			require.Equal(t, test.wantContext, model.EffectiveContextLength())
			require.Equal(t, test.wantOutput, model.EffectiveMaxOutputTokens())
		})
	}
}

func TestListModelsArrayKeepsOrganizationAndLimits(t *testing.T) {
	t.Parallel()

	var response OpenAIListModelsResponse
	require.NoError(t, json.Unmarshal([]byte(`[
		{"id":"zai-org/GLM-5.2","organization":"Z.ai","context_length":131072,"max_output_tokens":8192}
	]`), &response))

	require.Len(t, response.Data, 1)
	require.Equal(t, "Z.ai", response.Data[0].OwnedBy)
	require.Equal(t, schemas.Ptr(131072), response.Data[0].EffectiveContextLength())
	require.Equal(t, schemas.Ptr(8192), response.Data[0].EffectiveMaxOutputTokens())
}

func TestModelRetrieveResponseShape(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":"gpt-6-astra","object":"model","created":1686935002,"owned_by":"openai","shutdown_date":"2026-10-23"}`))
	}))
	defer server.Close()

	response, bifrostErr := HandleOpenAIModelRetrieveRequest(
		schemas.NewBifrostContext(context.Background(), schemas.NoDeadline),
		&fasthttp.Client{},
		server.URL+"/v1/models/gpt-6-astra",
		schemas.Key{},
		nil,
		schemas.ModelProvider("test"),
		false,
		false,
	)

	require.Nil(t, bifrostErr)
	require.Equal(t, "test/gpt-6-astra", response.ID)
	require.Equal(t, schemas.Ptr("openai"), response.OwnedBy)
	require.Equal(t, schemas.Ptr(int64(1686935002)), response.Created)
	require.Equal(t, schemas.Ptr("2026-10-23"), response.ShutdownDate)
}

func TestModelRetrieveUpstreamErrorIsPropagated(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"message":"The model 'nope' does not exist","type":"invalid_request_error","code":"model_not_found"}}`))
	}))
	defer server.Close()

	response, bifrostErr := HandleOpenAIModelRetrieveRequest(
		schemas.NewBifrostContext(context.Background(), schemas.NoDeadline),
		&fasthttp.Client{},
		server.URL+"/v1/models/nope",
		schemas.Key{},
		nil,
		schemas.ModelProvider("test"),
		false,
		false,
	)

	require.Nil(t, response)
	require.NotNil(t, bifrostErr)
	require.Equal(t, schemas.Ptr(http.StatusNotFound), bifrostErr.StatusCode)
	require.Contains(t, bifrostErr.Error.Message, "does not exist")
}
